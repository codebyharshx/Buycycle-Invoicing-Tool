import { MistralExtractor } from './extractors/mistral';
import { GeminiExtractor } from './extractors/gemini';
import { ClaudeExtractor } from './extractors/claude';
import { OpenRouterExtractor } from './extractors/openrouter';
import { DeepSeekReplicateExtractor } from './extractors/deepseek-replicate';
import { extractWithDeepSeek } from './extractors/deepseek'; // Local microservice (advanced)
import {
  MultiPassConsensusAnalyzer,
  logMultiPassConsensusReport,
  ModelMultiPassResult,
} from './consensus-multipass';
import {
  InvoiceData,
  MultiModelResult,
  ExtractionConfig,
  OCRLineItem,
} from '@shared/types';
import { logger } from '../../utils/logger';
import { getVendorExtractionHints, getAllVendorNames } from './vendor-mappings';
import { normalizeInvoiceData } from './utils';
import { readFileSync } from 'fs';
// Import pdf-parse - it's a CommonJS module with default export
import pdfParse from 'pdf-parse';

/**
 * Quick vendor detection from PDF text
 * Scans first page for known vendor names
 */
async function detectVendorFromPDF(filePath: string): Promise<string | null> {
  try {
    const dataBuffer = readFileSync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdf-parse is CJS module with incompatible types
    const pdfData = await (pdfParse as any)(dataBuffer, {
      max: 1, // Only parse first page for speed
    });

    const text = pdfData.text.toLowerCase();
    const vendorNames = getAllVendorNames();

    // Check for each known vendor
    for (const vendorName of vendorNames) {
      const vendorLower = vendorName.toLowerCase();
      const vendorKeywords = vendorLower.split(' ');

      // Match if we find the first 2-3 words of vendor name
      const significantKeywords = vendorKeywords.slice(0, Math.min(3, vendorKeywords.length));
      const matchCount = significantKeywords.filter(keyword =>
        keyword.length > 3 && text.includes(keyword)
      ).length;

      if (matchCount >= 2 || text.includes(vendorLower)) {
        logger.info({ detectedVendor: vendorName, filePath }, 'Vendor detected from PDF');
        return vendorName;
      }
    }

    logger.info({ filePath }, 'No known vendor detected from PDF');
    return null;
  } catch (error) {
    logger.warn({ error: (error as Error).message, filePath }, 'Failed to detect vendor from PDF');
    return null;
  }
}

/**
 * Extract invoice data using multiple models with multi-pass consensus analysis
 *
 * @param filePath - Path to the invoice file (PDF or image)
 * @param config - Configuration including API keys and models to use
 * @param numRuns - Number of extraction runs per model (default 1)
 * @returns Multi-model extraction result with enhanced consensus analysis
 */
export async function extractWithMultipleModels(
  filePath: string,
  config: ExtractionConfig,
  numRuns: number = 1
): Promise<MultiModelResult> {
  // Default model priority: Gemini → DeepSeek → Mistral (max 3 models)
  // Gemini first: Fast, native PDF support, optimized vendor-specific prompt
  // DeepSeek second: Specialized OCR for poor quality/handwritten invoices
  // Mistral third: Last resort fallback
  const defaultModels = ['gemini', 'deepseek', 'mistral'];
  const models = (config.models || defaultModels).slice(0, 3); // Limit to max 3 models
  const CONFIDENCE_THRESHOLD = 0.90; // 90% confidence threshold to stop calling more models

  // Detect vendor from PDF for vendor-specific extraction hints
  const detectedVendor = await detectVendorFromPDF(filePath);
  const vendorHints = detectedVendor ? getVendorExtractionHints(detectedVendor) : undefined;

  logger.info(
    {
      filePath,
      models,
      numRuns,
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      detectedVendor: detectedVendor || 'none',
      hasVendorHints: !!vendorHints,
    },
    'Starting smart fallback multi-model invoice extraction'
  );

  const modelResults: ModelMultiPassResult[] = [];
  let shouldContinue = true;

  // Extract with each model (smart fallback - stop when confidence >= 90%)
  for (const modelName of models) {
    if (!shouldContinue) {
      logger.info(
        { model: modelName },
        `Skipping ${modelName} - confidence threshold already met by previous model(s)`
      );
      break;
    }

    const runs: (InvoiceData | null)[] = [];
    let successfulRuns = 0;

    logger.info({ model: modelName, numRuns }, `Running ${numRuns} extraction passes`);

    for (let i = 0; i < numRuns; i++) {
      try {
        let data: InvoiceData | null = null;

        if (modelName === 'mistral') {
          if (!config.mistralApiKey) {
            logger.warn('Mistral API key not provided, skipping');
            break; // Skip all runs for this model
          }
          const extractor = new MistralExtractor(config.mistralApiKey);
          data = await extractor.extract(filePath);
        } else if (modelName === 'gemini') {
          if (!config.geminiApiKey) {
            logger.warn('Gemini API key not provided, skipping');
            break; // Skip all runs for this model
          }
          const extractor = new GeminiExtractor(config.geminiApiKey);
          data = await extractor.extract(filePath);
        } else if (modelName === 'claude') {
          if (!config.openRouterApiKey) {
            logger.warn('OpenRouter API key not provided, skipping Claude');
            break; // Skip all runs for this model
          }
          const extractor = new ClaudeExtractor(config.openRouterApiKey);
          data = await extractor.extract(filePath);
        } else if (
          ['qwen3-8b', 'qwen3-30b', 'qwen3-235b'].includes(modelName)
        ) {
          if (!config.openRouterApiKey) {
            logger.warn(
              { model: modelName },
              `OpenRouter API key not provided, skipping ${modelName}`
            );
            break; // Skip all runs for this model
          }
          const extractor = new OpenRouterExtractor(
            config.openRouterApiKey,
            modelName
          );
          data = await extractor.extract(filePath);
        } else if (modelName === 'deepseek') {
          // DeepSeek-OCR: Two-Stage Pipeline (DeepSeek OCR + Gemini LLM)
          if (config.replicateApiKey) {
            // Use Replicate API for DeepSeek + Gemini for structuring
            const extractor = new DeepSeekReplicateExtractor(
              config.replicateApiKey,
              config.geminiApiKey  // Pass Gemini key for two-stage pipeline
            );
            data = await extractor.extract(filePath);
          } else {
            // Fall back to local microservice (advanced users with GPU)
            try {
              data = await extractWithDeepSeek(filePath);
            } catch (error) {
              const err = error as Error;
              logger.warn(
                { model: modelName, error: err.message },
                'DeepSeek local service failed. Set REPLICATE_API_KEY to use Replicate API instead.'
              );
              break; // Skip all runs for this model
            }
          }
        } else {
          logger.warn({ model: modelName }, `Unknown model: ${modelName}`);
          break; // Skip all runs for this model
        }

        runs.push(data);
        if (data !== null) {
          successfulRuns++;
          logger.info({ model: modelName, pass: i + 1 }, '✓ Pass successful');
        } else {
          logger.warn({ model: modelName, pass: i + 1 }, '✗ Pass returned null');
        }
      } catch (error) {
        const err = error as Error;
        logger.error(
          { error: err.message, model: modelName, pass: i + 1 },
          `Failed extraction pass`
        );
        runs.push(null);
      }
    }

    if (runs.length > 0) {
      modelResults.push({
        modelName,
        runs,
        successfulRuns,
      });

      logger.info({
        model: modelName,
        successfulRuns,
        totalRuns: runs.length,
        successRate: `${((successfulRuns / runs.length) * 100).toFixed(1)}%`,
      });

      // Check if we should stop calling more models (smart fallback)
      if (successfulRuns > 0) {
        // Calculate confidence from the current models called so far
        const analyzer = new MultiPassConsensusAnalyzer(modelResults);
        const analysis = analyzer.analyze();
        const currentConfidence = analysis.confidence_score / 100; // Convert to 0-1 range

        logger.info({
          model: modelName,
          currentConfidence: `${(currentConfidence * 100).toFixed(1)}%`,
          threshold: `${(CONFIDENCE_THRESHOLD * 100).toFixed(1)}%`,
          modelsCalledSoFar: modelResults.length,
        });

        if (currentConfidence >= CONFIDENCE_THRESHOLD) {
          shouldContinue = false;
          logger.info(
            {
              finalConfidence: `${(currentConfidence * 100).toFixed(1)}%`,
              modelsCalled: modelResults.map(m => m.modelName),
            },
            `✅ Confidence threshold met! Stopping model calls.`
          );
        } else {
          logger.info(
            { currentConfidence: `${(currentConfidence * 100).toFixed(1)}%` },
            `⚠️ Confidence below threshold, will try next model...`
          );
        }
      }
    }
  }

  // Analyze consensus with multi-pass approach
  const analyzer = new MultiPassConsensusAnalyzer(modelResults);
  const analysis = analyzer.analyze();

  // Log detailed report
  logMultiPassConsensusReport(modelResults, analysis);

  // Convert modelResults to legacy format for compatibility
  const rawResults: Record<string, InvoiceData | null> = {};
  for (const modelResult of modelResults) {
    // Use first successful run for legacy compatibility
    const firstSuccess = modelResult.runs.find((r) => r !== null);
    rawResults[modelResult.modelName] = firstSuccess || null;
  }

  const result: MultiModelResult = {
    file: filePath,
    timestamp: new Date().toISOString(),
    raw_results: rawResults,
    analysis,
  };

  const totalSuccessfulRuns = modelResults.reduce((sum, m) => sum + m.successfulRuns, 0);

  logger.info(
    {
      confidenceScore: analysis.confidence_score,
      consensusFields: Object.keys(analysis.consensus).length,
      conflictFields: Object.keys(analysis.conflicts).length,
      totalRuns: modelResults.reduce((sum, m) => sum + m.runs.length, 0),
      successfulRuns: totalSuccessfulRuns,
    },
    'Multi-pass multi-model extraction complete'
  );

  // Validate that at least one model succeeded
  if (totalSuccessfulRuns === 0) {
    logger.error(
      { filePath, models, attempts: modelResults.reduce((sum, m) => sum + m.runs.length, 0) },
      'All extraction models failed - no valid data extracted'
    );
    throw new Error(
      'Invoice extraction failed: All AI models were unable to extract data from the document. ' +
      'Please ensure the document is a valid invoice with clear, readable text.'
    );
  }

  return result;
}

/**
 * Hybrid PDF+CSV extraction for logistics invoices
 * Extracts header from PDF (first + last page) and line items from CSV
 */
export async function hybridPdfCsvExtraction(
  pdfPath: string,
  csvPath: string,
  vendor: string,
  config: ExtractionConfig
): Promise<MultiModelResult> {
  const startTime = Date.now();

  logger.info(
    { pdfPath, csvPath, vendor },
    'Starting hybrid PDF+CSV extraction'
  );

  try {
    // Step 1: Detect CSV format and parse accordingly
    logger.info({ csvPath, vendor }, 'Parsing CSV for line items');

    // Read first line to detect format
    const { readFileSync } = await import('fs');
    const fileContent = readFileSync(csvPath, 'utf-8');
    const firstLine = fileContent.split('\n')[0];

    let lineItems: OCRLineItem[];

    // Detect format based on headers
    if (firstLine.includes('Gepard Customer ID') && firstLine.includes('Parcel Number') && firstLine.includes('Document No.')) {
      // GLS CSV format (semicolon-delimited)
      logger.info('Detected GLS CSV format');
      const { parseLogisticsCSV } = await import('./parsers/csv-parser');
      lineItems = await parseLogisticsCSV(csvPath, {
        vendor: 'gls',
        hasHeader: true,
        delimiter: ';',
      });
    } else if (firstLine.includes('Shipment Reference') && firstLine.includes('Shop Order ID') && firstLine.includes('Hive Order ID')) {
      // Hive CSV format
      logger.info('Detected Hive CSV format');
      const { parseLogisticsCSV } = await import('./parsers/csv-parser');
      lineItems = await parseLogisticsCSV(csvPath, {
        vendor: 'hive',
        hasHeader: true,
        delimiter: ',',
      });
    } else if (firstLine.includes('Document name') && firstLine.includes('Order code') && firstLine.includes('Packages NET total')) {
      // Eurosender CSV format
      logger.info('Detected Eurosender CSV format');
      const { parseLogisticsCSV } = await import('./parsers/csv-parser');
      lineItems = await parseLogisticsCSV(csvPath, {
        vendor: 'eurosender',
        hasHeader: true,
        delimiter: ',',
      });
    } else if (firstLine.includes('Record Type') && firstLine.includes('Net Amount') && firstLine.includes('Shipment Number')) {
      // UPS Simplified format (with headers)
      logger.info('Detected UPS Simplified format (with headers)');
      const { parseInvoiceCSV } = await import('../invoice-csv-parser');
      lineItems = parseInvoiceCSV(csvPath) as OCRLineItem[];
    } else if (vendor.toLowerCase().includes('dhl')) {
      // DHL CSV format (RAW or Template)
      logger.info('Detected DHL CSV format');
      const { parseLogisticsCSV } = await import('./parsers/csv-parser');
      lineItems = await parseLogisticsCSV(csvPath, {
        vendor: 'dhl',
        hasHeader: true,
        delimiter: ',',
      });
    } else {
      // Default to UPS RAW format (headerless)
      logger.info('Assuming UPS RAW format (headerless)');
      const { parseLogisticsCSV } = await import('./parsers/csv-parser');
      lineItems = await parseLogisticsCSV(csvPath, {
        vendor: 'ups',
        hasHeader: false,
        delimiter: ',',
      });
    }

    // Step 2: Extract PDF header (minimal extraction from first page only)
    logger.info({ pdfPath }, 'Extracting header data from PDF');
    const pdfHeaderData = await extractPdfHeaderOnly(pdfPath, config, vendor);

    // Step 3: Merge data and normalize
    const combinedData = normalizeInvoiceData({
      ...pdfHeaderData,
      line_items: lineItems, // Replace with CSV data
    });

    // Step 4: Build result
    const endTime = Date.now();
    const extractionTime = (endTime - startTime) / 1000;

    const result: MultiModelResult = {
      file: pdfPath,
      timestamp: new Date().toISOString(),
      raw_results: {
        hybrid: combinedData, // Store the combined result
      },
      analysis: {
        consensus: combinedData as unknown as Record<string, string | number | string[] | OCRLineItem[]>,
        conflicts: {},
        missing: {},
        confidence_score: 95, // Higher confidence with CSV
        review_needed: [],
        field_confidence_scores: {
          vendor: 1,
          invoice_number: 1,
          gross_amount: 1,
          currency: 1,
          line_items: 1, // CSV data is 100% accurate
        },
        field_consistency: {
          vendor: 1,
          invoice_number: 1,
          gross_amount: 1,
          currency: 1,
        },
        validation_issues: [],
        low_confidence_fields: [],
      },
    };

    logger.info(
      {
        pdfPath,
        csvPath,
        lineItemCount: lineItems.length,
        extractionTime: `${extractionTime.toFixed(2)}s`,
        confidence: result.analysis.confidence_score,
      },
      'Hybrid PDF+CSV extraction complete'
    );

    return result;
  } catch (error) {
    logger.error(
      { error: (error as Error).message, pdfPath, csvPath },
      'Hybrid PDF+CSV extraction failed'
    );
    throw error;
  }
}

/**
 * Extract only header information from PDF (first page only)
 * Used in hybrid mode when line items come from CSV
 */
async function extractPdfHeaderOnly(
  filePath: string,
  config: ExtractionConfig,
  vendor: string
): Promise<Partial<InvoiceData>> {
  logger.info({ filePath, vendor }, 'Extracting PDF header (first page only)');

  // Use Gemini to extract header data only
  if (!config.geminiApiKey) {
    throw new Error('Gemini API key required for PDF header extraction');
  }

  const gemini = new GeminiExtractor(config.geminiApiKey);

  // Extract header data (line items will be empty)
  const headerData = await gemini.extract(filePath);

  // Handle null response
  if (!headerData) {
    logger.warn({ filePath }, 'PDF header extraction returned null, using defaults');
    return {
      line_items: [],
    };
  }

  // Ensure line_items is empty (will be populated from CSV)
  return {
    ...headerData,
    line_items: [],
  };
}

/**
 * Find companion CSV file for a given PDF invoice
 */
export async function findCompanionCSV(
  pdfPath: string,
  vendor?: string
): Promise<string | null> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const dir = path.dirname(pdfPath);
  const pdfBaseName = path.basename(pdfPath, '.pdf');

  logger.info({ pdfPath, vendor }, 'Searching for companion CSV file');

  try {
    const files = await fs.readdir(dir);

    // Pattern 1: UPS-specific naming
    // PDF: invoice_pdf_20251229_141517_1.pdf
    // CSV: invoice_000000eg5322525_122725.csv
    if (vendor === 'UPS' || vendor === 'ups' || pdfBaseName.startsWith('invoice_pdf_')) {
      const csvFiles = files.filter((f) => f.startsWith('invoice_') && f.endsWith('.csv'));
      if (csvFiles.length > 0) {
        const csvPath = path.join(dir, csvFiles[0]);
        logger.info({ csvPath }, 'Found UPS companion CSV');
        return csvPath;
      }
    }

    // Pattern 2: Same base name with .csv extension
    const sameNameCsv = `${pdfBaseName}.csv`;
    if (files.includes(sameNameCsv)) {
      const csvPath = path.join(dir, sameNameCsv);
      logger.info({ csvPath }, 'Found companion CSV (same name)');
      return csvPath;
    }

    // Pattern 3: Extract invoice number and search for matching CSV
    const invoiceNumMatch = pdfBaseName.match(/\d{10,}/); // 10+ digit invoice number
    if (invoiceNumMatch) {
      const invoiceNum = invoiceNumMatch[0];
      const matchingCsv = files.find(
        (f) => f.endsWith('.csv') && f.includes(invoiceNum)
      );
      if (matchingCsv) {
        const csvPath = path.join(dir, matchingCsv);
        logger.info({ csvPath, invoiceNum }, 'Found companion CSV (by invoice number)');
        return csvPath;
      }
    }

    logger.info({ pdfPath }, 'No companion CSV file found');
    return null;
  } catch (error) {
    logger.warn(
      { error: (error as Error).message, pdfPath },
      'Error searching for companion CSV'
    );
    return null;
  }
}

/**
 * MRW PDF-only extraction with line items
 * Extracts both header and line items directly from PDF (no CSV available)
 */
export async function extractMRWPdfWithLineItems(
  pdfPath: string,
  config: ExtractionConfig
): Promise<MultiModelResult> {
  const startTime = Date.now();

  logger.info({ pdfPath }, 'Starting MRW PDF-only extraction with line items');

  try {
    if (!config.geminiApiKey) {
      throw new Error('Gemini API key is required for MRW PDF extraction');
    }

    // Use the specialized MRW extractor
    const { extractMRWLineItems } = await import('./extractors/mrw-pdf');
    const extractionResult = await extractMRWLineItems(pdfPath, config.geminiApiKey);

    // Build invoice data
    const invoiceData = normalizeInvoiceData({
      vendor: 'MRW',
      invoice_number: extractionResult.invoice_number,
      invoice_date: extractionResult.invoice_date,
      line_items: extractionResult.line_items,
      currency: 'EUR',
      // Calculate totals from line items
      gross_amount: extractionResult.line_items.reduce(
        (sum, item) => sum + (item.net_amount || 0),
        0
      ),
    } as unknown as InvoiceData);

    const endTime = Date.now();
    const extractionTime = (endTime - startTime) / 1000;

    const result: MultiModelResult = {
      file: pdfPath,
      timestamp: new Date().toISOString(),
      raw_results: {
        mrw_pdf: invoiceData,
      },
      analysis: {
        consensus: invoiceData as unknown as Record<string, string | number | string[] | OCRLineItem[]>,
        conflicts: {},
        missing: {},
        confidence_score: 90, // High confidence for structured MRW extraction
        review_needed: [],
        field_confidence_scores: {
          vendor: 1,
          invoice_number: 1,
          line_items: 0.9, // Slightly lower for PDF extraction vs CSV
        },
        field_consistency: {
          vendor: 1,
          invoice_number: 1,
          line_items: 0.9,
        },
        validation_issues: [],
        low_confidence_fields: [],
      },
    };

    logger.info(
      {
        pdfPath,
        lineItemCount: extractionResult.line_items.length,
        extractionTime: `${extractionTime.toFixed(2)}s`,
        confidence: 90,
      },
      'MRW PDF extraction complete'
    );

    return result;
  } catch (error) {
    logger.error({ error, pdfPath }, 'MRW PDF extraction failed');
    throw error;
  }
}

/**
 * Smart invoice extraction - automatically detects CSV and uses hybrid mode
 */
export async function extractInvoiceData(
  pdfPath: string,
  config: ExtractionConfig,
  csvPath?: string,
  csvOriginalName?: string // Original filename before multer renames it
): Promise<MultiModelResult> {
  // Vendors known to provide CSV companions
  const VENDORS_WITH_CSV = ['ups', 'dhl', 'eurosender', 'sendcloud', 'gls', 'hive'];

  logger.info(
    { pdfPath, csvPath, csvProvided: !!csvPath, csvOriginalName },
    'extractInvoiceData called'
  );

  // Check if this is an MRW invoice from filename pattern (e.g., 001259_bb0013275-3.pdf)
  const pdfFilename = pdfPath.split('/').pop() || '';
  const isMRWFilename = /_bb\d+/i.test(pdfFilename);

  // Detect vendor from PDF (may fail if pdfParse doesn't work)
  let detectedVendor = isMRWFilename ? 'MRW' : await detectVendorFromPDF(pdfPath);

  logger.info(
    { detectedVendorFromPDF: detectedVendor },
    'Vendor detection from PDF complete'
  );

  // Check if CSV exists (provided or auto-detected)
  const resolvedCsvPath = csvPath || (await findCompanionCSV(pdfPath, detectedVendor || undefined));

  logger.info(
    { resolvedCsvPath, csvPathParam: csvPath, autoDetected: !csvPath && !!resolvedCsvPath },
    'CSV path resolution complete'
  );

  // If CSV exists but vendor not detected, try to detect from CSV filename
  if (resolvedCsvPath && !detectedVendor) {
    // Use original filename if provided (before multer timestamp prefix), otherwise use path
    const csvFilename = csvOriginalName || resolvedCsvPath.split('/').pop() || '';
    const csvBaseName = csvFilename.toLowerCase();

    logger.info(
      { csvBaseName, csvOriginalName, resolvedCsvPath },
      'Attempting vendor detection from CSV filename'
    );

    if (csvBaseName.startsWith('invoice')) detectedVendor = 'UPS'; // UPS CSVs start with "invoice_"
    else if (csvBaseName.includes('ups')) detectedVendor = 'UPS';
    else if (csvBaseName.includes('dhl')) detectedVendor = 'DHL';
    else if (csvBaseName.includes('eurosender') || csvBaseName.includes('euro-sender') || csvBaseName.includes('euro_sender')) detectedVendor = 'EuroSender';
    else if (csvBaseName.includes('mrw')) detectedVendor = 'MRW';
    else if (csvBaseName.includes('sendcloud')) detectedVendor = 'Sendcloud';
    else if (csvBaseName.includes('gls')) detectedVendor = 'GLS';
    else if (csvBaseName.includes('hive')) detectedVendor = 'Hive';

    logger.info(
      { detectedVendorFromCSV: detectedVendor, csvBaseName },
      'Vendor detection from CSV filename complete'
    );
  }

  const vendorKey = detectedVendor?.toLowerCase() || '';

  logger.info(
    {
      resolvedCsvPath,
      detectedVendor,
      vendorKey,
      vendorsWithCSV: VENDORS_WITH_CSV,
      vendorMatch: VENDORS_WITH_CSV.some((v) => vendorKey.includes(v)),
    },
    'Determining extraction mode'
  );

  // MRW: Use specialized PDF-only extraction (no CSV available)
  if (vendorKey.includes('mrw')) {
    logger.info(
      { pdfPath, vendor: detectedVendor },
      'MRW invoice detected - using specialized PDF line item extraction'
    );
    return await extractMRWPdfWithLineItems(pdfPath, config);
  }

  // Use hybrid mode if CSV is available and vendor supports it
  if (resolvedCsvPath && VENDORS_WITH_CSV.some((v) => vendorKey.includes(v))) {
    logger.info(
      { pdfPath, csvPath: resolvedCsvPath, vendor: detectedVendor },
      'CSV detected - using hybrid extraction mode'
    );
    return await hybridPdfCsvExtraction(pdfPath, resolvedCsvPath, vendorKey, config);
  } else {
    logger.info(
      { pdfPath, csvPath: resolvedCsvPath, vendor: detectedVendor, reason: !resolvedCsvPath ? 'no_csv' : 'vendor_not_supported' },
      'No CSV or vendor does not support CSV - using standard PDF extraction'
    );
    return await extractWithMultipleModels(pdfPath, config);
  }
}

// Export types and utilities
export * from '@shared/types';
export { ConsensusAnalyzer, logConsensusReport } from './consensus';
export {
  MultiPassConsensusAnalyzer,
  logMultiPassConsensusReport,
} from './consensus-multipass';
export { MistralExtractor } from './extractors/mistral';
export { GeminiExtractor } from './extractors/gemini';
export { ClaudeExtractor } from './extractors/claude';
export { OpenRouterExtractor } from './extractors/openrouter';
export { extractWithDeepSeek, checkDeepSeekHealth } from './extractors/deepseek';
export { normalizeInvoiceData } from './utils';
export * from './validation';
