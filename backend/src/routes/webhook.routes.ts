/**
 * Webhook Routes
 *
 * External API endpoints for n8n and other integrations.
 * Uses API key authentication instead of JWT.
 *
 * POST /api/webhooks/invoice - Smart invoice upload endpoint
 *   - PDF only → Standard multi-model AI extraction
 *   - PDF + CSV/XLSX → Hybrid mode (AI header + parsed line items)
 *   - MRW/DPD/Eurosender PDFs → Specialized extractors
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { extractWithMultipleModels, extractInvoiceData } from '../services/invoice-ocr';
import { normalizeVendorName } from '../services/invoice-ocr/vendor-mappings';
import { normalizeDocumentType } from '../services/invoice-ocr/utils';
import { isDPDInvoice, extractDPDLineItems } from '../services/invoice-ocr/extractors/dpd-line-items';
import { extractMRWLineItems } from '../services/invoice-ocr/extractors/mrw-pdf';
import { parseUPSCSV, parseDHLCSV, parseEurosenderCSV, parseSendcloudCSV, parseGLSCSV, parseHiveCSV, parseS2CCSV } from '../services/invoice-ocr/parsers/csv-parser';
import { parseRedStagShippingXLSX, parseEurosenderXLSX, parseS2CXLSX } from '../services/invoice-ocr/parsers/xlsx-parser';
import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';
import { requireApiKey } from '../middleware/api-key';
import { OCRLineItem } from '@shared/types';
import { checkForDuplicate, calculateFileHash } from '../services/duplicate-detector.service';

const router = Router();

/**
 * Parse date string to ISO format (YYYY-MM-DD) for PostgreSQL
 * Handles various formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD
 */
function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Already ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY format
  const match = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try parsing as Date object (fallback)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null; // Return null if unparseable
}

// All webhook routes require API key
router.use(requireApiKey);

// Upload path configuration
const uploadPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/invoices`
  : (process.env.INVOICE_UPLOAD_PATH || '/tmp/uploads/invoices');

const maxFileSize = parseInt(process.env.INVOICE_MAX_FILE_SIZE || '52428800', 10);

// Ensure upload directory exists
let uploadDirInitialized = false;
async function ensureUploadDir(): Promise<void> {
  if (!uploadDirInitialized) {
    if (!existsSync(uploadPath)) {
      await mkdir(uploadPath, { recursive: true });
    }
    uploadDirInitialized = true;
  }
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await ensureUploadDir();
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${sanitizedName}`);
  },
});

const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Check MIME type first
  if (ALLOWED_FILE_TYPES.includes(file.mimetype as typeof ALLOWED_FILE_TYPES[number])) {
    cb(null, true);
    return;
  }

  // For CSV/XLSX files, also check by extension (some clients send application/octet-stream)
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
    cb(null, true);
    return;
  }

  cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PDF, PNG, JPG, CSV, XLSX.`));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxFileSize },
});

/**
 * Detect vendor from filename patterns
 */
function detectVendorFromFilename(filename: string): string | null {
  const lowerName = filename.toLowerCase();

  // UPS patterns: "invoice_000000eg5322525_122725.csv" or contains "ups"
  if (lowerName.startsWith('invoice_') || lowerName.includes('ups')) return 'UPS';

  // DHL patterns: "mucir00169682.csv", "MUCR000438452.pdf" or contains "dhl"
  // MUC = Munich, IR = Invoice Regular, R = Regular/Credit
  if (lowerName.includes('dhl') || /^muc(ir|r|i)?\d+/i.test(lowerName)) return 'DHL';

  // Eurosender patterns
  if (lowerName.includes('eurosender') || lowerName.includes('euro-sender') || lowerName.includes('euro_sender')) return 'Eurosender';

  // GLS patterns
  if (lowerName.includes('gls')) return 'GLS';

  // Hive patterns
  if (lowerName.includes('hive')) return 'Hive';

  // Sendcloud patterns
  if (lowerName.includes('sendcloud')) return 'Sendcloud';

  // MRW patterns: "_bb" followed by digits
  if (/_bb\d+/i.test(lowerName)) return 'MRW';

  // Red Stag patterns: "Shipping Invoice_BCL" or "shipping_invoice_bcl" or "red stag"
  if (lowerName.includes('red_stag') || lowerName.includes('redstag') || lowerName.includes('red stag') ||
      lowerName.includes('shipping_invoice_bcl') || lowerName.includes('shipping invoice_bcl')) return 'Red Stag';

  // S2C patterns
  if (lowerName.includes('s2c') || lowerName.includes('ship_to_cycle') || lowerName.includes('shiptocycle')) return 'S2C';

  // DPD patterns
  if (lowerName.includes('dpd')) return 'DPD';

  return null;
}

/**
 * Detect vendor from CSV content (first line headers)
 */
function detectVendorFromCSVHeaders(csvPath: string): string | null {
  try {
    const content = readFileSync(csvPath, 'utf-8');
    const firstLine = content.split('\n')[0].toLowerCase();

    // GLS: semicolon-delimited with specific headers
    if (firstLine.includes('gepard customer id') && firstLine.includes('parcel number')) return 'GLS';

    // Hive: specific column headers
    if (firstLine.includes('shipment reference') && firstLine.includes('shop order id') && firstLine.includes('hive order id')) return 'Hive';

    // Eurosender: specific column headers
    if (firstLine.includes('document name') && firstLine.includes('order code') && firstLine.includes('packages net total')) return 'Eurosender';

    // DHL: specific column headers (check BEFORE Sendcloud - DHL has more specific headers)
    if (firstLine.includes('shipment number') && firstLine.includes('shipment date') && firstLine.includes('origin')) return 'DHL';

    // Sendcloud: specific column headers - must include "order number" to distinguish from DHL
    // Sendcloud headers: Description, Date, Reference, Amount, Type, Order number, From Country, To Country
    if (firstLine.includes('order number') && firstLine.includes('reference') && firstLine.includes('type') && firstLine.includes('amount')) return 'Sendcloud';

    // UPS: either with headers or headerless (detect by pattern)
    if (firstLine.includes('record type') && firstLine.includes('net amount')) return 'UPS';

    // S2C: specific column headers
    if (firstLine.includes('invoice month') && firstLine.includes('reference number') && firstLine.includes('tracking 1')) return 'S2C';

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse CSV/XLSX file based on detected vendor
 */
async function parseLineItemsFile(
  filePath: string,
  vendor: string,
  originalFilename: string
): Promise<OCRLineItem[]> {
  const ext = path.extname(originalFilename).toLowerCase();
  const vendorLower = vendor.toLowerCase();

  logger.info({ filePath, vendor, ext }, 'Parsing line items file');

  // XLSX handling
  if (ext === '.xlsx') {
    if (vendorLower.includes('red') && vendorLower.includes('stag')) {
      return await parseRedStagShippingXLSX(filePath);
    }
    if (vendorLower.includes('eurosender')) {
      return await parseEurosenderXLSX(filePath);
    }
    if (vendorLower.includes('s2c')) {
      // Check if it's a credit note
      const isCredit = originalFilename.toLowerCase().includes('credit');
      return await parseS2CXLSX(filePath, isCredit);
    }
    throw new Error(`No XLSX parser for vendor: ${vendor}`);
  }

  // CSV handling
  if (vendorLower.includes('ups')) {
    return await parseUPSCSV(filePath);
  }
  if (vendorLower.includes('dhl')) {
    return await parseDHLCSV(filePath);
  }
  if (vendorLower.includes('eurosender')) {
    return await parseEurosenderCSV(filePath);
  }
  if (vendorLower.includes('gls')) {
    return await parseGLSCSV(filePath);
  }
  if (vendorLower.includes('hive')) {
    return await parseHiveCSV(filePath);
  }
  if (vendorLower.includes('sendcloud')) {
    return await parseSendcloudCSV(filePath);
  }
  if (vendorLower.includes('s2c')) {
    return await parseS2CCSV(filePath);
  }

  throw new Error(`No CSV parser for vendor: ${vendor}`);
}

/**
 * POST /api/webhooks/invoice
 *
 * Smart invoice upload endpoint for n8n and external integrations.
 *
 * Headers:
 *   X-API-Key: <your-api-key>
 *
 * Body (multipart/form-data):
 *   - invoice: PDF file (required)
 *   - csv: CSV/XLSX file (optional - enables hybrid mode)
 *   - vendor: string (optional - auto-detected if not provided)
 *   - notes: string (optional)
 *
 * Processing modes:
 *   1. PDF + CSV/XLSX → Hybrid mode (AI header extraction + CSV/XLSX line items)
 *   2. MRW PDF → Specialized Gemini Vision extractor for header + line items
 *   3. DPD PDF → AI header + regex-based line item extraction
 *   4. Eurosender PDF → AI extraction (credit notes/surcharges)
 *   5. Standard PDF → Multi-model AI extraction (Gemini, DeepSeek, Mistral)
 */
// Wrap multer to catch errors
const handleMulterError = (req: Request, res: Response, next: (err?: Error) => void) => {
  upload.fields([
    { name: 'invoice', maxCount: 1 },
    { name: 'csv', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      logger.error({ error: err.message, code: (err as NodeJS.ErrnoException).code }, 'Multer error');
      res.status(400).json({
        success: false,
        error: 'File upload error',
        message: err.message,
      });
      return;
    }
    next();
  });
};

router.post(
  '/invoice',
  handleMulterError,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pgPool = getPgPool();

      if (!pgPool) {
        res.status(503).json({
          error: 'Database unavailable',
          message: 'PostgreSQL database is required for invoice storage.',
        });
        return;
      }

      // Get uploaded files
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const invoiceFile = files?.['invoice']?.[0];
      const csvFile = files?.['csv']?.[0];

      if (!invoiceFile) {
        res.status(400).json({
          error: 'No invoice file provided',
          message: 'Upload a PDF file with field name "invoice"',
        });
        return;
      }

      const { vendor: vendorHint, notes } = req.body;

      logger.info({
        invoiceFileName: invoiceFile.originalname,
        invoiceFileSize: invoiceFile.size,
        invoiceMimeType: invoiceFile.mimetype,
        csvFileName: csvFile?.originalname,
        csvFileSize: csvFile?.size,
        vendorHint,
        source: 'webhook',
      }, 'Webhook invoice upload started');

      // Calculate file hash for duplicate detection
      const invoiceBuffer = readFileSync(invoiceFile.path);
      const fileHash = calculateFileHash(invoiceBuffer);

      // Check for duplicates by file hash (Layer 1)
      const duplicateCheck = await checkForDuplicate({
        fileHash,
      });

      if (duplicateCheck.isDuplicate) {
        logger.info({
          reason: duplicateCheck.reason,
          existingId: duplicateCheck.existingId,
          fileName: invoiceFile.originalname,
        }, 'Duplicate invoice detected - skipping');

        res.status(409).json({
          error: 'Duplicate invoice',
          reason: duplicateCheck.reason,
          existingInvoiceId: duplicateCheck.existingId,
          message: `Invoice already exists (detected by ${duplicateCheck.reason})`,
        });
        return;
      }

      // Get API keys
      const mistralApiKey = process.env.MISTRAL_API_KEY;
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      const replicateApiKey = process.env.REPLICATE_API_KEY;

      if (!mistralApiKey && !geminiApiKey && !openRouterApiKey && !replicateApiKey) {
        res.status(500).json({ error: 'No OCR API keys configured' });
        return;
      }

      const config = {
        mistralApiKey,
        geminiApiKey,
        openRouterApiKey,
        replicateApiKey,
        models: ['gemini', 'deepseek', 'mistral'],
      };

      // Determine vendor (priority: explicit hint > filename detection > CSV headers > AI detection)
      let detectedVendor = vendorHint || null;

      if (!detectedVendor) {
        // Try filename detection
        detectedVendor = detectVendorFromFilename(invoiceFile.originalname);

        // Try CSV filename if no match
        if (!detectedVendor && csvFile) {
          detectedVendor = detectVendorFromFilename(csvFile.originalname);
        }

        // Try CSV headers if still no match
        if (!detectedVendor && csvFile) {
          detectedVendor = detectVendorFromCSVHeaders(csvFile.path);
        }
      }

      logger.info({ detectedVendor, source: vendorHint ? 'hint' : 'auto' }, 'Vendor detection complete');

      // Determine processing mode and extract data
      let extraction;
      let lineItems: OCRLineItem[] = [];
      let processingMode: 'hybrid' | 'mrw_pdf' | 'dpd_pdf' | 'eurosender_pdf' | 'standard' = 'standard';
      const vendorLower = (detectedVendor || '').toLowerCase();
      const isMRW = vendorLower.includes('mrw') || /_bb\d+/i.test(invoiceFile.originalname);
      const isEurosender = vendorLower.includes('eurosender');

      // Mode 1: Hybrid (PDF + CSV/XLSX)
      if (csvFile) {
        processingMode = 'hybrid';
        logger.info({ vendor: detectedVendor }, 'Using hybrid mode (PDF header + CSV/XLSX line items)');

        if (!detectedVendor) {
          res.status(400).json({
            error: 'Vendor required for hybrid mode',
            message: 'Please provide vendor parameter or use recognizable filenames',
          });
          return;
        }

        const csvExt = path.extname(csvFile.originalname).toLowerCase();

        // XLSX files need separate handling (binary format, not text)
        if (csvExt === '.xlsx') {
          logger.info({ vendor: detectedVendor, file: csvFile.originalname }, 'Using XLSX parser for line items');

          // Parse XLSX for line items
          lineItems = await parseLineItemsFile(csvFile.path, detectedVendor, csvFile.originalname);

          // Extract PDF header with AI
          extraction = await extractWithMultipleModels(invoiceFile.path, config);

          // Merge line items into extraction result
          extraction.analysis.consensus.line_items = lineItems;
        } else {
          // CSV files: use same approach as manual upload
          // 1. Parse CSV for line items using vendor-specific parser
          logger.info({ vendor: detectedVendor, file: csvFile.originalname }, 'Using CSV parser for line items');
          lineItems = await parseLineItemsFile(csvFile.path, detectedVendor, csvFile.originalname);

          // 2. Extract PDF header with multi-model AI (same as manual upload)
          extraction = await extractWithMultipleModels(invoiceFile.path, config);

          // 3. Merge line items into extraction result
          extraction.analysis.consensus.line_items = lineItems;
        }
      }
      // Mode 2: MRW PDF (specialized Gemini Vision)
      else if (isMRW) {
        processingMode = 'mrw_pdf';
        logger.info({}, 'Using MRW specialized PDF extraction');

        if (!geminiApiKey) {
          res.status(500).json({ error: 'Gemini API key required for MRW extraction' });
          return;
        }

        const mrwResult = await extractMRWLineItems(invoiceFile.path, geminiApiKey);
        lineItems = mrwResult.line_items;

        // Build extraction result
        extraction = await extractInvoiceData(invoiceFile.path, config);
      }
      // Mode 3: DPD PDF (AI header + regex line items)
      else if (vendorLower.includes('dpd') || await isDPDInvoice(invoiceFile.path)) {
        processingMode = 'dpd_pdf';
        logger.info({}, 'Using DPD specialized PDF extraction');

        // First extract header with AI
        extraction = await extractWithMultipleModels(invoiceFile.path, config);

        // Then extract line items with regex
        const invoiceNumber = (extraction.analysis.consensus.invoice_number as string) || '';
        try {
          lineItems = await extractDPDLineItems(invoiceFile.path, invoiceNumber);
        } catch (e) {
          logger.error({ error: e }, 'Failed to extract DPD line items');
        }
      }
      // Mode 4: Eurosender PDF (AI extraction with line items)
      else if (isEurosender) {
        processingMode = 'eurosender_pdf';
        logger.info({}, 'Using Eurosender PDF extraction');

        extraction = await extractInvoiceData(invoiceFile.path, config);
        lineItems = (extraction.analysis.consensus.line_items as OCRLineItem[]) || [];
      }
      // Mode 5: Standard multi-model AI extraction
      else {
        processingMode = 'standard';
        logger.info({}, 'Using standard multi-model AI extraction');

        extraction = await extractWithMultipleModels(invoiceFile.path, config);
      }

      // Normalize vendor name
      const extractedVendor = (extraction.analysis.consensus.vendor as string) || detectedVendor || '';
      const standardizedVendor = normalizeVendorName(extractedVendor);
      extraction.analysis.consensus.vendor = standardizedVendor;

      // Calculate due date for Red Stag invoices (invoice_date + 3 business days)
      // Red Stag invoices don't have an explicit due date in the PDF - only Payment Terms
      if (standardizedVendor === 'Red Stag') {
        const invoiceDate = (extraction.analysis.consensus.invoice_date as string) || '';
        if (invoiceDate && !extraction.analysis.consensus.due_date) {
          const { calculateRedStagDueDate } = await import('../services/invoice-ocr/utils');
          const calculatedDueDate = calculateRedStagDueDate(invoiceDate);
          if (calculatedDueDate) {
            extraction.analysis.consensus.due_date = calculatedDueDate;
            logger.info(
              { invoiceDate, dueDate: calculatedDueDate },
              'Calculated Red Stag due date (invoice_date + 3 business days)'
            );
          }
        }
      }

      // Normalize document type
      const rawDocumentType = (extraction.analysis.consensus.document_type as string) || '';
      const netAmount = (extraction.analysis.consensus.net_amount as number) || 0;
      const invoiceNumber = (extraction.analysis.consensus.invoice_number as string) || null;
      const normalizedDocumentType = normalizeDocumentType(rawDocumentType, netAmount, invoiceNumber || '');
      extraction.analysis.consensus.document_type = normalizedDocumentType;

      // Handle parent invoice linking
      const parentInvoiceNumber = (extraction.analysis.consensus.parent_invoice_number as string) || null;
      let parentInvoiceId: number | null = null;

      if (parentInvoiceNumber) {
        const parentLookup = await pgPool.query(
          'SELECT id FROM invoice_extractions WHERE invoice_number = $1 LIMIT 1',
          [parentInvoiceNumber]
        );
        if (parentLookup.rows.length > 0) {
          parentInvoiceId = parentLookup.rows[0].id;
        }
      }

      // Determine if we have line items
      const hasLineItems = lineItems.length > 0;

      // Post-extraction duplicate check (Layer 3 - invoice number + vendor)
      if (invoiceNumber) {
        const postExtractionCheck = await checkForDuplicate({
          invoiceNumber,
          vendor: standardizedVendor,
        });

        if (postExtractionCheck.isDuplicate) {
          logger.info({
            reason: postExtractionCheck.reason,
            existingId: postExtractionCheck.existingId,
            invoiceNumber,
            vendor: standardizedVendor,
          }, 'Duplicate invoice detected by invoice number - skipping');

          res.status(409).json({
            error: 'Duplicate invoice',
            reason: 'invoice_number',
            existingInvoiceId: postExtractionCheck.existingId,
            message: `Invoice ${invoiceNumber} from ${standardizedVendor} already exists`,
          });
          return;
        }
      }

      // Database transaction (same pattern as auto-ingest.service.ts)
      const client = await pgPool.connect();
      let insertResult: { invoiceId: number; fileId: number };

      try {
        await client.query('BEGIN');

        // Step 1: Insert file record with file_hash for duplicate detection
        const fileResult = await client.query(
          `INSERT INTO invoice_files (
            file_type, file_name, file_size, mime_type, local_path, source, status, file_hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
          [
            path.extname(invoiceFile.originalname).slice(1) || 'pdf',
            invoiceFile.originalname,
            invoiceFile.size,
            invoiceFile.mimetype,
            invoiceFile.path,
            'api',  // Valid values: 'api', 'auto_ingest', etc.
            'completed',
            fileHash,
          ]
        );
        const fileId = fileResult.rows[0].id;

        // Step 2: Insert extraction record
        const extractionResult = await client.query(
          `INSERT INTO invoice_extractions (
            file_id, invoice_number, vendor, document_type,
            net_amount, gross_amount, models_used, confidence_score,
            consensus_data, conflicts_data, raw_results, status,
            parent_invoice_id, has_line_items
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id`,
          [
            fileId,
            invoiceNumber,
            standardizedVendor,
            normalizedDocumentType,
            extraction.analysis.consensus.net_amount || null,
            extraction.analysis.consensus.gross_amount || null,
            JSON.stringify(config.models),
            extraction.analysis.confidence_score,
            JSON.stringify(extraction.analysis.consensus),
            JSON.stringify(extraction.analysis.conflicts),
            JSON.stringify(extraction.raw_results),
            'review',
            parentInvoiceId,
            hasLineItems,
          ]
        );
        const invoiceId = extractionResult.rows[0].id;

        // Step 3: Insert line items if any
        if (hasLineItems) {
          for (const item of lineItems) {
            await client.query(
              `INSERT INTO invoice_line_items (
                invoice_id, vendor, invoice_number, shipment_number, shipment_date,
                shipment_reference_1, shipment_reference_2, product_name, pieces, weight_kg,
                origin_country, origin_city, destination_country, destination_city,
                net_amount, gross_amount, extraction_source, line_item_type,
                base_price, total_surcharges, currency
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
              [
                invoiceId,
                standardizedVendor,
                invoiceNumber,
                item.shipment_number || null,
                parseDate(item.shipment_date),
                item.shipment_reference_1 || null,
                item.shipment_reference_2 || null,
                item.product_name || null,
                item.pieces || null,
                item.weight_kg || null,
                item.origin_country || null,
                item.origin_city || null,
                item.destination_country || null,
                item.destination_city || null,
                item.net_amount || null,
                item.gross_amount || null,
                // Map processing mode to valid extraction_source ('pdf_ocr', 'csv_parser', 'manual', or NULL)
                processingMode === 'hybrid' ? 'csv_parser' : 'pdf_ocr',
                item.line_item_type || 'shipment',
                item.base_price || null,
                item.total_surcharges || null,
                item.currency || 'EUR',
              ]
            );
          }
        }

        await client.query('COMMIT');
        insertResult = { invoiceId, fileId };
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

      logger.info({
        invoiceId: insertResult.invoiceId,
        fileId: insertResult.fileId,
        invoiceNumber,
        vendor: standardizedVendor,
        processingMode,
        lineItemCount: lineItems.length,
        source: 'webhook',
      }, 'Webhook invoice upload completed');

      // Return n8n-compatible response
      res.status(201).json({
        success: true,
        id: insertResult.invoiceId,
        file_id: insertResult.fileId,
        invoice_number: invoiceNumber,
        vendor: standardizedVendor,
        document_type: normalizedDocumentType,
        net_amount: extraction.analysis.consensus.net_amount || null,
        gross_amount: extraction.analysis.consensus.gross_amount || null,
        currency: extraction.analysis.consensus.currency || null,
        invoice_date: extraction.analysis.consensus.invoice_date || null,
        due_date: extraction.analysis.consensus.due_date || null,
        confidence_score: extraction.analysis.confidence_score,
        has_line_items: hasLineItems,
        line_items_count: lineItems.length,
        processing_mode: processingMode,
        models_used: config.models,
        parent_invoice_id: parentInvoiceId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Get file info from request if available
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const invoiceFileName = files?.['invoice']?.[0]?.originalname || 'unknown';
      const csvFileName = files?.['csv']?.[0]?.originalname;

      logger.error({
        error: errorMessage,
        stack: errorStack,
        invoiceFileName,
        csvFileName,
        detectedVendor: req.body?.vendor || 'auto-detected',
      }, 'Webhook invoice upload failed');

      res.status(500).json({
        success: false,
        error: 'Extraction failed',
        message: errorMessage,
        details: process.env.NODE_ENV !== 'production' ? errorStack : undefined,
      });
    }
  }
);

/**
 * GET /api/webhooks/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'webhooks' });
});

export default router;
