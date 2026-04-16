import { Router, Request, Response } from 'express';
import multer from 'multer';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { extractWithMultipleModels, extractInvoiceData } from '../services/invoice-ocr';
import { parseInvoiceCSV, validateInvoiceCSV } from '../services/invoice-csv-parser';
import { parseUPSCSV, parseDHLCSV, parseEurosenderCSV, parseSendcloudCSV, parseS2CCSV } from '../services/invoice-ocr/parsers/csv-parser';
import { parseS2COvermaxXLSX, parseS2CCreditNoteXLSX, parseEurosenderXLSX, parseRedStagShippingXLSX } from '../services/invoice-ocr/parsers/xlsx-parser';
import { isDPDInvoice, extractDPDLineItems } from '../services/invoice-ocr/extractors/dpd-line-items';
import { normalizeVendorName } from '../services/invoice-ocr/vendor-mappings';
import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';
import { createAssignmentNotification } from '../services/notification.service';

// Helper to check if database is available (PostgreSQL)
function isDatabaseAvailable(): boolean {
  return getPgPool() !== null;
}
import {
  InvoiceExtractionRequest,
  InvoiceExtractionResponse,
  InvoiceExtractionRecord,
  InvoiceExtractionRecordWithLineItems,
  InvoiceLineItem,
  OCRLineItem,
  InvoiceStatusCounts,
  InvoiceViewFilter,
  InvoiceDashboardResponse,
  InvoiceDashboardTotals,
  InvoiceMonthlySummary,
  InvoiceVendorSummary,
  AccountingMonthBucket,
  AccountingInvoiceRow,
  AccountingVendorGroup,
  AccountingViewResponse,
} from '@shared/types';
import ExcelJS from 'exceljs';
// Known logistics vendors (keep lightweight and localized to avoid cross-package build requirements)
const KNOWN_LOGISTICS_VENDORS = [
  'Wiechert',
  'DS Smith',
  'Hive',
  'Karamac',
  'myGermany',
];

// PostgreSQL expressions for credit note exclusion (uses dedicated columns now)
const CREDIT_NOTE_EXCLUSION = `
  COALESCE(LOWER(document_type), '') NOT LIKE '%credit%'
  AND COALESCE(LOWER(document_type), '') NOT LIKE '%correction%'
`;

// PostgreSQL uses dedicated numeric columns instead of JSON extraction
const NET_AMOUNT_EXPR = "COALESCE(net_amount, 0)";
const GROSS_AMOUNT_EXPR = "COALESCE(gross_amount, 0)";

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Allowed file types for invoice uploads
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
] as const;

const router = Router();

/**
 * Safely parse models_used field which may be:
 * - JSON array string: '["deepseek","mistral","gemini"]'
 * - Comma-separated string: 'deepseek,mistral,gemini'
 * - Already an array
 */
function parseModelsUsed(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  if (value.startsWith('[')) {
    try {
      return JSON.parse(value);
    } catch {
      // Fall through to comma-separated handling
    }
  }
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Safely convert a date value to ISO string
 * Handles MySQL Date objects, strings, and invalid dates
 */
function safeToISOString(dateVal: Date | string | null | undefined): string | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    // Check if the Date is valid (MySQL can return Invalid Date for 0000-00-00)
    if (isNaN(dateVal.getTime())) return null;
    return dateVal.toISOString();
  }
  return String(dateVal);
}

/**
 * Safely convert a date value to YYYY-MM-DD string
 */
function safeToDateString(dateVal: Date | string | null | undefined): string | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return null;
    return dateVal.toISOString().split('T')[0];
  }
  return String(dateVal);
}

async function getDashboardTotals(statuses: string[], extraCondition: string = ''): Promise<InvoiceDashboardTotals> {
  // Guard clause: return zero totals if no statuses provided or database unavailable
  if (statuses.length === 0 || !isDatabaseAvailable()) {
    return { count: 0, totalNet: 0, totalGross: 0 };
  }

  const pgPool = getPgPool()!;

  // Build PostgreSQL placeholders: $1, $2, etc.
  const placeholders = statuses.map((_, i) => `$${i + 1}`).join(',');
  const whereClause = [
    `status IN (${placeholders})`,
    CREDIT_NOTE_EXCLUSION,
    extraCondition ? extraCondition : '',
  ]
    .filter(Boolean)
    .join(' AND ');

  const query = `
    SELECT
      COUNT(*) AS invoice_count,
      COALESCE(SUM(${NET_AMOUNT_EXPR}), 0) AS total_net,
      COALESCE(SUM(${GROSS_AMOUNT_EXPR}), 0) AS total_gross
    FROM invoice_extractions
    WHERE ${whereClause}
  `;

  const result = await pgPool.query(query, statuses);
  const row = result.rows[0] || { invoice_count: 0, total_net: 0, total_gross: 0 };

  return {
    count: toNumber(row.invoice_count),
    totalNet: toNumber(row.total_net),
    totalGross: toNumber(row.total_gross),
  };
}

/**
 * Format a date value from the database to DD/MM/YYYY string
 * PostgreSQL DATE columns are returned as JavaScript Date objects by the pg driver
 */
function formatDatabaseDate(value: unknown): string {
  if (!value) return '';

  // If it's already a string in correct format, return it
  if (typeof value === 'string') {
    // Check if it's already in DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      return value;
    }
    // Handle YYYY-MM-DD format (ISO)
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return `${day}/${month}/${year}`;
    }
    // For other string formats, try to parse and format
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    }
    return value;
  }

  // If it's a Date object (from PostgreSQL DATE column), format it
  if (value instanceof Date) {
    const day = value.getDate().toString().padStart(2, '0');
    const month = (value.getMonth() + 1).toString().padStart(2, '0');
    const year = value.getFullYear();
    return `${day}/${month}/${year}`;
  }

  return String(value);
}

/**
 * Transform raw database row to properly typed InvoiceExtractionRecord
 * PostgreSQL returns JSONB as objects directly (no JSON.parse needed)
 * Maps new PostgreSQL column names to existing TypeScript interface
 */
function transformDatabaseRow(row: Record<string, unknown>): InvoiceExtractionRecord {
  // PostgreSQL returns JSONB as objects, so no JSON.parse needed
  const consensusData = (row.consensus_data || {}) as Record<string, unknown>;
  const conflictsData = row.conflicts_data as Record<string, unknown> | null;
  const missingData = row.missing_data as Record<string, unknown> | null;
  const rawResults = (row.raw_results || {}) as Record<string, unknown>;
  const reviewNeeded = row.review_needed as string[] | null;

  // Build consensus_data with dedicated columns merged in
  // This ensures backward compatibility with code expecting data in consensus_data
  const mergedConsensus: Record<string, string | number | string[]> = {
    ...(typeof consensusData === 'object' ? consensusData as Record<string, string | number | string[]> : {}),
  };

  // Merge dedicated columns into consensus (prefer dedicated column values)
  // Use new field names (DB-aligned)
  if (row.vendor) mergedConsensus.vendor = row.vendor as string;
  if (row.net_amount) mergedConsensus.net_amount = row.net_amount as number;
  if (row.gross_amount) mergedConsensus.gross_amount = row.gross_amount as number;
  if (row.invoice_date) mergedConsensus.invoice_date = String(row.invoice_date);
  if (row.due_date) mergedConsensus.due_date = String(row.due_date);
  if (row.vat_amount) mergedConsensus.vat_amount = row.vat_amount as number;
  if (row.vat_percentage) mergedConsensus.vat_percentage = row.vat_percentage as number;
  if (row.currency) mergedConsensus.currency = row.currency as string;
  if (row.account_number) mergedConsensus.account_number = row.account_number as string;
  if (row.document_type) mergedConsensus.document_type = row.document_type as string;
  if (row.performance_period_start) mergedConsensus.performance_period_start = formatDatabaseDate(row.performance_period_start);
  if (row.performance_period_end) mergedConsensus.performance_period_end = formatDatabaseDate(row.performance_period_end);

  // Determine created_via with proper typing
  const createdViaValue = (row.created_via as string) || (row.source as string) || 'api';
  const validCreatedVia = ['api', 'frontend'] as const;
  type ValidCreatedVia = typeof validCreatedVia[number];
  const createdVia: ValidCreatedVia = validCreatedVia.includes(createdViaValue as ValidCreatedVia)
    ? (createdViaValue as ValidCreatedVia)
    : 'api';

  // Determine status with proper typing
  const statusValue = (row.status as string) || 'pending';
  const validStatuses = ['pending', 'approved', 'on_hold', 'rejected', 'paid'] as const;
  const status = validStatuses.includes(statusValue as typeof validStatuses[number])
    ? (statusValue as typeof validStatuses[number])
    : 'pending';

  // Determine payment_method with proper typing
  const paymentMethodValue = row.payment_method as string | null;
  const validPaymentMethods = ['Mercury', 'Bank Transfer', 'PayPal', 'Credit Card', 'Direct Debit', 'Other'] as const;
  const paymentMethod = paymentMethodValue && validPaymentMethods.includes(paymentMethodValue as typeof validPaymentMethods[number])
    ? (paymentMethodValue as typeof validPaymentMethods[number])
    : null;

  return {
    id: row.id as number,
    file_name: (row.file_name as string) || '',
    invoice_number: (row.invoice_number as string) || null,
    file_path: (row.file_path as string) || (row.local_path as string) || '',
    file_size: (row.file_size as number) || 0,
    models_used: parseModelsUsed(row.models_used),
    confidence_score: parseFloat(String(row.confidence_score)) || 0,
    consensus_data: mergedConsensus,
    conflicts_data: conflictsData as import('@shared/types').InvoiceExtractionRecord['conflicts_data'],
    missing_data: missingData as import('@shared/types').InvoiceExtractionRecord['missing_data'],
    raw_results: rawResults as import('@shared/types').InvoiceExtractionRecord['raw_results'],
    review_needed: reviewNeeded,
    created_at: safeToISOString(row.created_at as Date | string) || (row.created_at as string),
    created_by: row.created_by as number | null,
    created_via: createdVia,
    notes: (row.notes as string) || null,
    status: status,
    has_line_items: Boolean(row.has_line_items),
    // CSV info may be stored in notes field as JSON (PostgreSQL schema doesn't have dedicated columns)
    csv_file_path: (() => {
      if (row.csv_file_path) return row.csv_file_path as string;
      try {
        const notesData = typeof row.notes === 'string' ? JSON.parse(row.notes) : row.notes;
        return notesData?.csv_file_path || null;
      } catch { return null; }
    })(),
    csv_file_name: (() => {
      if (row.csv_file_name) return row.csv_file_name as string;
      try {
        const notesData = typeof row.notes === 'string' ? JSON.parse(row.notes) : row.notes;
        return notesData?.csv_file_name || null;
      } catch { return null; }
    })(),
    assigned_agent_id: (row.assigned_to as number) || (row.assigned_agent_id as number) || null,
    payment_date: safeToDateString(row.payment_date as Date | string),
    payment_method: paymentMethod,
    payment_status: (row.payment_status as import('@shared/types').InvoicePaymentStatus) || 'unpaid',
    approved_by: (row.approved_by as number) || null,
    approved_at: safeToISOString(row.approved_at as Date | string),
    viewed_by: (row.viewed_by as number[]) || [],
  };
}

// Configure file upload storage
// Railway provides RAILWAY_VOLUME_MOUNT_PATH automatically when a volume is attached
// Priority: Railway volume > Local dev path > Fallback temp directory
const uploadPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/invoices`
  : (process.env.INVOICE_UPLOAD_PATH || '/tmp/uploads/invoices');

const maxFileSize = parseInt(process.env.INVOICE_MAX_FILE_SIZE || '52428800', 10); // 50MB default

logger.info({ uploadPath, usingRailwayVolume: !!process.env.RAILWAY_VOLUME_MOUNT_PATH }, 'Invoice upload path configured');

// Lazy initialization of upload directory (only created when first upload happens)
let uploadDirInitialized = false;
async function ensureUploadDir(): Promise<void> {
  if (!uploadDirInitialized) {
    try {
      if (!existsSync(uploadPath)) {
        await mkdir(uploadPath, { recursive: true });
      }
      uploadDirInitialized = true;
    } catch (error) {
      logger.error({ err: error, uploadPath }, 'Failed to create upload directory');
      throw error;
    }
  }
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await ensureUploadDir();
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename: timestamp-originalname
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${sanitizedName}`);
  },
});

// File filter - allow PDF, PNG, JPG, CSV
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Strict mimetype validation - don't fallback to extension check
  // Some applications send CSV as text/csv, others as application/vnd.ms-excel
  const isValidType = ALLOWED_FILE_TYPES.includes(file.mimetype as typeof ALLOWED_FILE_TYPES[number]);

  if (isValidType) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Only PDF, PNG, JPG, CSV, and XLSX files are allowed.`
      )
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxFileSize },
});

/**
 * POST /api/invoice-ocr/extract
 * Upload and extract invoice data using multi-model OCR
 */
router.post(
  '/extract',
  upload.single('invoice'),
  async (req: Request, res: Response): Promise<void> => {
    // Check database availability first
    if (!isDatabaseAvailable()) {
      res.status(503).json({
        error: 'Database unavailable',
        details: 'PostgreSQL database is required for invoice storage. Please configure NEON_POSTGRES_URL in .env file.',
      });
      return;
    }

    const file = req.file;
    // Note: When using multer, req.body fields are strings from form data
    // We can't directly cast to InvoiceExtractionRequest
    const body = req.body as Partial<Record<keyof InvoiceExtractionRequest, string | string[]>>;

    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    req.log.info(
      {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
      'Starting invoice OCR extraction'
    );

    try {
      // Get API keys from environment
      const mistralApiKey = process.env.MISTRAL_API_KEY;
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      const replicateApiKey = process.env.REPLICATE_API_KEY;

      if (!mistralApiKey && !geminiApiKey && !openRouterApiKey && !replicateApiKey) {
        res.status(500).json({
          error: 'Server configuration error: No OCR API keys configured',
        });
        return;
      }

      // Determine models to use (default: DeepSeek → Mistral → Gemini, max 3)
      // Note: multer parses form data fields as strings, so we need to parse JSON if it's a string
      let models: string[] = ['deepseek', 'mistral', 'gemini'];
      if (body.models) {
        if (typeof body.models === 'string') {
          const modelsString = body.models;
          try {
            models = JSON.parse(modelsString);
          } catch {
            // If not valid JSON, try comma-separated
            models = modelsString.split(',').map((m: string) => m.trim());
          }
        } else if (Array.isArray(body.models)) {
          models = body.models;
        }
      }
      // Limit to maximum 3 models per invoice
      models = models.slice(0, 3);

      // Check if this is an MRW invoice (filename pattern: _bb\d+)
      const isMRWInvoice = /_bb\d+/i.test(file.originalname || '');

      let extraction;
      if (isMRWInvoice) {
        // MRW: Use specialized PDF-only line item extraction
        req.log.info({ fileName: file.originalname }, 'MRW invoice detected - using specialized extractor');
        extraction = await extractInvoiceData(file.path, {
          mistralApiKey,
          geminiApiKey,
          openRouterApiKey,
          replicateApiKey,
          models,
        });
      } else {
        // Standard extraction for all other vendors (DHL, UPS, etc.)
        extraction = await extractWithMultipleModels(file.path, {
          mistralApiKey,
          geminiApiKey,
          openRouterApiKey, // Used for Claude via OpenRouter
          replicateApiKey, // Used for DeepSeek via Replicate
          models,
        });
      }

      // Normalize vendor name to standard format BEFORE saving to database
      const extractedVendor = (extraction.analysis.consensus.vendor as string) || '';
      const standardizedVendor = normalizeVendorName(extractedVendor);

      // Update consensus data with standardized vendor name
      extraction.analysis.consensus.vendor = standardizedVendor;

      // Normalize document type (detect credit notes, corrections, etc.)
      const { normalizeDocumentType } = await import('../services/invoice-ocr/utils');
      const rawDocumentType = (extraction.analysis.consensus.document_type as string) || '';
      const netAmount = (extraction.analysis.consensus.net_amount as number) || 0;
      const normalizedDocumentType = normalizeDocumentType(
        rawDocumentType,
        netAmount,
        (extraction.analysis.consensus.invoice_number as string) || ''
      );

      // Update consensus data with normalized document type
      extraction.analysis.consensus.document_type = normalizedDocumentType;

      // Extract parent invoice number for linked invoices (credit notes, surcharges, oversize, etc.)
      const parentInvoiceNumber = (extraction.analysis.consensus.parent_invoice_number as string) || null;
      let parentInvoiceId: number | null = null;

      // If we have a parent invoice number, try to find the parent invoice
      // This works for ALL document types: credit_note, surcharge_invoice, oversize, correction, etc.
      if (parentInvoiceNumber) {
        req.log.info(
          { parentInvoiceNumber, documentType: normalizedDocumentType },
          'Looking up parent invoice for linked document'
        );

        const pgPool = getPgPool();
        if (pgPool) {
          // First, try to match by invoice_number
          let parentLookup = await pgPool.query(
            'SELECT id FROM invoice_extractions WHERE invoice_number = $1 LIMIT 1',
            [parentInvoiceNumber]
          );

          if (parentLookup.rows.length > 0) {
            parentInvoiceId = parentLookup.rows[0].id;
            req.log.info(
              { parentInvoiceNumber, parentInvoiceId, matchedBy: 'invoice_number' },
              'Found parent invoice by invoice_number'
            );
          } else {
            // If not found by invoice_number, try to find by shipment_reference_1 in line items
            req.log.info(
              { parentInvoiceNumber },
              'Parent not found by invoice_number, searching by shipment_reference_1 in line items'
            );

            parentLookup = await pgPool.query(
              `SELECT DISTINCT ie.id
               FROM invoice_extractions ie
               JOIN invoice_line_items ili ON ili.invoice_id = ie.id
               WHERE ili.shipment_reference_1 = $1
               LIMIT 1`,
              [parentInvoiceNumber]
            );

            if (parentLookup.rows.length > 0) {
              parentInvoiceId = parentLookup.rows[0].id;
              req.log.info(
                { parentInvoiceNumber, parentInvoiceId, matchedBy: 'shipment_reference_1' },
                'Found parent invoice by shipment_reference_1'
              );
            } else {
              req.log.warn(
                { parentInvoiceNumber },
                'Parent invoice not found in database - document will be saved without link'
              );
            }
          }
        }
      }

      req.log.info(
        {
          originalVendor: extractedVendor,
          standardizedVendor: standardizedVendor,
          documentType: normalizedDocumentType,
          parentInvoiceNumber,
          parentInvoiceId,
        },
        'Vendor and document type normalized'
      );

      // Extract invoice number from consensus data for deduplication
      const invoiceNumber = (extraction.analysis.consensus.invoice_number as string) || null;

      // Handle missing invoice number
      if (!invoiceNumber) {
        req.log.warn(
          { fileName: file.originalname },
          'Invoice number could not be extracted - deduplication will not be possible'
        );
        // Add to review_needed if not already present
        if (!extraction.analysis.review_needed.includes('invoice_number')) {
          extraction.analysis.review_needed.push('invoice_number');
        }
      }

      // DUPLICATE CHECK DISABLED - Allow duplicate invoices for now
      // } else {
      //   // Check for duplicate invoice number (if provided)
      //   const [existingRows] = await logsPool!.execute(
      //     'SELECT id, file_name FROM support_logistics_invoice_extractions WHERE invoice_number = ?',
      //     [invoiceNumber]
      //   );
      //   const existing = existingRows as any[];
      //   if (existing.length > 0) {
      //     req.log.warn(
      //       { invoiceNumber, existingId: existing[0].id, existingFileName: existing[0].file_name },
      //       'Duplicate invoice number detected'
      //     );
      //     res.status(409).json({
      //       error: 'Duplicate invoice',
      //       message: `Invoice number ${invoiceNumber} already exists`,
      //       existing: {
      //         id: existing[0].id,
      //         file_name: existing[0].file_name,
      //       },
      //     });
      //     return;
      //   }
      // }

      // IMPORTANT: Only extract/save line items for specific invoice types
      // Line items should ONLY be saved for:
      // 1. MRW invoices (filename pattern _bb\d+) - extracted from PDF via AI
      // 2. Invoices with CSV provided - extracted from CSV (handled in /extract-with-line-items)
      // 3. DPD invoices - extracted using specialized PDF parser
      // 4. Eurosender invoices (credit notes, surcharges) - extracted from PDF via AI
      //
      // For all other invoices (Wiechert, KARAMAC, Hive, etc.), ignore any line items
      // that the OCR model might extract, as they're unreliable for header-only invoices.

      let lineItemsFromOCR: OCRLineItem[] = [];

      // Check if this is a Eurosender invoice (credit notes/surcharges come as PDF only)
      const vendorLower = (extraction.analysis.consensus.vendor as string || '').toLowerCase();
      const isEurosender = vendorLower.includes('eurosender');

      if (isMRWInvoice) {
        // MRW invoices: Line items were already extracted in extractInvoiceData()
        lineItemsFromOCR = (extraction.analysis.consensus.line_items as OCRLineItem[]) || [];
        req.log.info({ lineItemCount: lineItemsFromOCR.length }, 'MRW invoice - line items extracted from AI');
      } else if (isEurosender) {
        // Eurosender credit notes and surcharge invoices: Use AI-extracted line items
        lineItemsFromOCR = (extraction.analysis.consensus.line_items as OCRLineItem[]) || [];
        req.log.info(
          { lineItemCount: lineItemsFromOCR.length, vendor: 'Eurosender' },
          'Eurosender invoice - line items extracted from AI'
        );
      } else {
        // Check if this is a DPD invoice (DPD has specialized line item extraction)
        const isDPD = await isDPDInvoice(file.path);

        if (isDPD) {
          req.log.info('DPD invoice detected, extracting line items from PDF');
          try {
            lineItemsFromOCR = await extractDPDLineItems(file.path, invoiceNumber || '');
            req.log.info(
              { lineItemCount: lineItemsFromOCR.length },
              'DPD line items extracted successfully'
            );
          } catch (dpdError) {
            req.log.error({ error: dpdError }, 'Failed to extract DPD line items');
            // Continue without line items rather than failing the whole extraction
          }
        } else {
          // For all other invoices, do NOT save line items from OCR
          // Even if Gemini extracted some line items, ignore them
          req.log.info(
            { vendor: extraction.analysis.consensus.vendor },
            'Non-inline invoice - ignoring any line items from OCR'
          );
          lineItemsFromOCR = [];
        }
      }

      const hasLineItems = lineItemsFromOCR.length > 0;

      req.log.info(
        { hasLineItems, lineItemCount: lineItemsFromOCR.length },
        'Final line items count for invoice extraction'
      );

      // Save to database (PostgreSQL) - Two-table insert pattern
      const pgPool = getPgPool()!;
      const client = await pgPool.connect();

      try {
        await client.query('BEGIN');

        // Step 1: Insert file record
        const fileQuery = `
          INSERT INTO invoice_files (
            file_type,
            file_name,
            file_size,
            mime_type,
            local_path,
            source,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `;

        const fileResult = await client.query(fileQuery, [
          'pdf',
          file.originalname,
          file.size,
          'application/pdf',
          file.path,
          'api',
          'completed',
        ]);

        const fileId = fileResult.rows[0].id;

        // Step 2: Insert extraction record with file_id reference
        const query = `
          INSERT INTO invoice_extractions (
            file_id,
            invoice_number,
            vendor,
            document_type,
            parent_invoice_id,
            parent_invoice_number,
            net_amount,
            gross_amount,
            models_used,
            confidence_score,
            consensus_data,
            conflicts_data,
            raw_results,
            has_line_items,
            line_items_source,
            notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING id
        `;

        const result = await client.query(query, [
          fileId,
          invoiceNumber,
          standardizedVendor,
          normalizedDocumentType,
          parentInvoiceId,
          parentInvoiceNumber,
          extraction.analysis.consensus.net_amount || null,
          extraction.analysis.consensus.gross_amount || null,
          JSON.stringify(models),
          extraction.analysis.confidence_score,
          JSON.stringify(extraction.analysis.consensus),
          JSON.stringify(extraction.analysis.conflicts),
          JSON.stringify(extraction.raw_results),
          hasLineItems,
          hasLineItems ? 'pdf_ocr' : null,
          body.notes || null,
        ]);

        await client.query('COMMIT');

        var insertResult = { insertId: result.rows[0].id, fileId };
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

      // Post-commit operations - wrapped in separate try-catch so failures don't cause 500
      // The invoice is already saved at this point, so we should return success even if these fail
      let record: InvoiceExtractionRecord | null = null;
      let postCommitWarning: string | undefined;

      try {
        // If line items were extracted, save them to the line_items table (PostgreSQL schema)
        if (hasLineItems && lineItemsFromOCR.length > 0) {
          req.log.info(
            { invoiceId: insertResult.insertId, lineItemCount: lineItemsFromOCR.length },
            'Saving OCR-extracted line items to database'
          );

          for (const item of lineItemsFromOCR) {
            // Store extra charges in vendor_raw_data JSONB
            const vendorRawData = {
              total_surcharges_tax: item.total_surcharges_tax,
              xc1_code: item.xc1_code, xc1_name: item.xc1_name, xc1_charge: item.xc1_charge,
              xc2_code: item.xc2_code, xc2_name: item.xc2_name, xc2_charge: item.xc2_charge,
              xc3_code: item.xc3_code, xc3_name: item.xc3_name, xc3_charge: item.xc3_charge,
              xc4_code: item.xc4_code, xc4_name: item.xc4_name, xc4_charge: item.xc4_charge,
              xc5_code: item.xc5_code, xc5_name: item.xc5_name, xc5_charge: item.xc5_charge,
              xc6_code: item.xc6_code, xc6_name: item.xc6_name, xc6_charge: item.xc6_charge,
              xc7_code: item.xc7_code, xc7_name: item.xc7_name, xc7_charge: item.xc7_charge,
              xc8_code: item.xc8_code, xc8_name: item.xc8_name, xc8_charge: item.xc8_charge,
              xc9_code: item.xc9_code, xc9_name: item.xc9_name, xc9_charge: item.xc9_charge,
            };

            const lineItemQuery = `
              INSERT INTO invoice_line_items (
                invoice_id,
                vendor,
                invoice_number,
                shipment_number,
                shipment_date,
                booking_date,
                shipment_reference_1,
                shipment_reference_2,
                product_name,
                pieces,
                weight_kg,
                weight_flag,
                origin_country,
                origin_city,
                origin_postal_code,
                destination_country,
                destination_city,
                destination_postal_code,
                net_amount,
                gross_amount,
                base_price,
                total_tax,
                total_surcharges,
                vendor_raw_data,
                extraction_source
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
            `;

            await pgPool.query(lineItemQuery, [
              insertResult.insertId,
              standardizedVendor,
              invoiceNumber,
              item.shipment_number || null,
              item.shipment_date || null,
              item.booking_date || null,
              item.shipment_reference_1 || null,
              item.shipment_reference_2 || null,
              item.product_name || null,
              item.pieces || null,
              item.weight_kg || null,
              item.weight_flag || null,
              item.origin_country || null,
              item.origin_city || null,
              item.origin_postal_code || null,
              item.destination_country || null,
              item.destination_city || null,
              item.destination_postal_code || null,
              item.net_amount || null,
              item.gross_amount || null,
              item.base_price || null,
              item.total_tax || null,
              item.total_surcharges || null,
              JSON.stringify(vendorRawData),
              'pdf_ocr',
            ]);
          }

          req.log.info(
            { invoiceId: insertResult.insertId, lineItemsSaved: lineItemsFromOCR.length },
            'Line items saved successfully'
          );

          // If no parent was found via parent_invoice_number, try to link by shipment_reference_1
          // Only do this for child document types (not shipping_invoice - those are parents, not children)
          if (!parentInvoiceId && normalizedDocumentType !== 'shipping_invoice') {
            // Collect unique shipment_reference_1 values from line items
            const shipmentRefs = lineItemsFromOCR
              .map(item => item.shipment_reference_1)
              .filter((ref): ref is string => !!ref && ref.trim() !== '');

            if (shipmentRefs.length > 0) {
              req.log.info(
                { invoiceId: insertResult.insertId, shipmentRefs, documentType: normalizedDocumentType },
                'Attempting to link invoice by shipment_reference_1'
              );

              // Find another invoice that has any of these shipment_reference_1 values
              // Exclude the current invoice from the search
              const parentByRefQuery = await pgPool.query(
                `SELECT DISTINCT ie.id
                 FROM invoice_extractions ie
                 JOIN invoice_line_items ili ON ili.invoice_id = ie.id
                 WHERE ili.shipment_reference_1 = ANY($1)
                   AND ie.id != $2
                 ORDER BY ie.id ASC
                 LIMIT 1`,
                [shipmentRefs, insertResult.insertId]
              );

              if (parentByRefQuery.rows.length > 0) {
                const foundParentId = parentByRefQuery.rows[0].id;

                // Update the invoice with the parent_invoice_id
                await pgPool.query(
                  'UPDATE invoice_extractions SET parent_invoice_id = $1 WHERE id = $2',
                  [foundParentId, insertResult.insertId]
                );

                req.log.info(
                  { invoiceId: insertResult.insertId, parentInvoiceId: foundParentId, matchedBy: 'shipment_reference_1' },
                  'Linked invoice to parent by shipment_reference_1'
                );
              } else {
                req.log.info(
                  { invoiceId: insertResult.insertId },
                  'No parent invoice found by shipment_reference_1'
                );
              }
            }
          }
        }

        // Fetch the created record
        const fetchResult = await pgPool.query(
          'SELECT * FROM invoice_extractions WHERE id = $1',
          [insertResult.insertId]
        );

        const rawRecord = fetchResult.rows[0];
        if (!rawRecord) {
          req.log.warn(
            { invoiceId: insertResult.insertId },
            'Could not fetch invoice record after commit - record may not be immediately visible'
          );
        } else {
          record = transformDatabaseRow(rawRecord);
        }

        req.log.info(
          {
            id: record?.id ?? insertResult.insertId,
            confidenceScore: extraction.analysis.confidence_score,
            fileName: file.originalname,
          },
          'Invoice extraction saved successfully'
        );
      } catch (postCommitError) {
        // Log the error but don't fail - invoice is already saved
        const errorMessage = postCommitError instanceof Error ? postCommitError.message : String(postCommitError);
        const errorStack = postCommitError instanceof Error ? postCommitError.stack : undefined;
        req.log.error(
          {
            error: errorMessage,
            stack: errorStack,
            invoiceId: insertResult.insertId,
            fileName: file.originalname
          },
          'Post-commit processing failed but invoice was saved successfully'
        );
        postCommitWarning = `Invoice saved but post-processing failed: ${errorMessage}`;
      }

      const response: InvoiceExtractionResponse = {
        id: record?.id ?? insertResult.insertId,
        extraction,
        ...(record && { database_record: record }),
        ...(postCommitWarning && { warning: postCommitWarning }),
      };

      res.status(201).json(response);
    } catch (error) {
      req.log.error({ error, fileName: file.originalname }, 'Invoice extraction failed');
      res.status(500).json({
        error: 'Failed to extract invoice',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /api/invoice-ocr/analytics
 * Aggregated dashboard metrics for invoices (counts, totals, vendor list, monthly heatmap)
 */
router.get('/analytics', async (req: Request, res: Response): Promise<void> => {
  try {
    // Return empty data if database is not available
    if (!isDatabaseAvailable()) {
      const emptyTotals = { count: 0, totalNet: 0, totalGross: 0 };
      const response: InvoiceDashboardResponse = {
        stats: {
          open: emptyTotals,
          onHold: emptyTotals,
          readyForPayment: emptyTotals,
          discrepancies: emptyTotals,
        },
        vendors: [],
        monthly: [],
        lastUpdated: new Date().toISOString(),
      };
      res.json(response);
      return;
    }

    const monthsParam = req.query.months ? parseInt(req.query.months as string, 10) : 6;
    const months = Number.isFinite(monthsParam) && monthsParam > 0 && monthsParam <= 12 ? monthsParam : 6;

    const startDate = new Date();
    startDate.setUTCDate(1);
    startDate.setUTCHours(0, 0, 0, 0);
    startDate.setUTCMonth(startDate.getUTCMonth() - (months - 1));
    const startDateStr = startDate.toISOString().split('T')[0];

    const pgPool = getPgPool()!;

    // PostgreSQL: Use JSONB array length functions
    const [openTotals, onHoldTotals, readyForPaymentTotals, discrepanciesTotals] = await Promise.all([
      getDashboardTotals(['pending', 'on_hold']),
      getDashboardTotals(['on_hold']),
      getDashboardTotals(['approved']),
      getDashboardTotals(
        ['pending', 'on_hold', 'approved'],
        // Discrepancies: invoices with conflicts_data that has at least one key
        'COALESCE((SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(conflicts_data, \'{}\'::jsonb))), 0) > 0'
      ),
    ]);

    // PostgreSQL: Use dedicated vendor column
    const vendorResult = await pgPool.query(
      `
        SELECT
          COALESCE(NULLIF(vendor, ''), 'Unknown') AS vendor,
          COUNT(*) AS invoice_count,
          COALESCE(SUM(${NET_AMOUNT_EXPR}), 0) AS total_net,
          COALESCE(SUM(${GROSS_AMOUNT_EXPR}), 0) AS total_gross
        FROM invoice_extractions
        WHERE status IN ('pending', 'on_hold')
          AND ${CREDIT_NOTE_EXCLUSION}
        GROUP BY vendor
        ORDER BY total_net DESC, invoice_count DESC
      `
    );

    const vendors: InvoiceVendorSummary[] = vendorResult.rows.map((row) => ({
      vendor: row.vendor || 'Unknown',
      invoiceCount: toNumber(row.invoice_count),
      totalNet: toNumber(row.total_net),
      totalGross: toNumber(row.total_gross),
    }));

    // PostgreSQL: Use dedicated invoice_date column with TO_CHAR
    const monthlyResult = await pgPool.query(
      `
        SELECT
          TO_CHAR(
            COALESCE(invoice_date, created_at::date),
            'YYYY-MM-01'
          ) AS month,
          COALESCE(NULLIF(vendor, ''), 'Unknown') AS vendor,
          COUNT(*) AS invoice_count,
          COALESCE(SUM(${NET_AMOUNT_EXPR}), 0) AS total_net,
          COALESCE(SUM(${GROSS_AMOUNT_EXPR}), 0) AS total_gross
        FROM invoice_extractions
        WHERE status != 'rejected'
          AND ${CREDIT_NOTE_EXCLUSION}
          AND COALESCE(invoice_date, created_at::date) >= $1
        GROUP BY month, vendor
        ORDER BY month ASC, vendor ASC
      `,
      [startDateStr]
    );

    const monthly: InvoiceMonthlySummary[] = monthlyResult.rows.map((row) => ({
      month: row.month,
      vendor: row.vendor || 'Unknown',
      invoiceCount: toNumber(row.invoice_count),
      totalNet: toNumber(row.total_net),
      totalGross: toNumber(row.total_gross),
    }));

    const response: InvoiceDashboardResponse = {
      stats: {
        open: openTotals,
        onHold: onHoldTotals,
        readyForPayment: readyForPaymentTotals,
        discrepancies: discrepanciesTotals,
      },
      vendors,
      monthly,
      lastUpdated: new Date().toISOString(),
    };

    res.json(response);
  } catch (error) {
    req.log.error({ error }, 'Failed to fetch invoice analytics');
    res.status(500).json({
      error: 'Failed to fetch invoice analytics',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/invoice-ocr/extractions/counts
 * Get invoice counts by status with unread tracking
 */
router.get('/extractions/counts', async (req: Request, res: Response): Promise<void> => {
  try {
    // Return empty counts if database is not available
    if (!isDatabaseAvailable()) {
      const emptyCounts: InvoiceStatusCounts = {
        active: { total: 0, unread: 0 },
        approved: { total: 0, unread: 0 },
        paid: { total: 0, unread: 0 },
        all: { total: 0, unread: 0 },
        myAssignments: { total: 0, unread: 0 },
        unassigned: { total: 0 },
      };
      res.json(emptyCounts);
      return;
    }

    const pgPool = getPgPool()!;
    const userId = req.query.user_id ? parseInt(req.query.user_id as string, 10) : null;

    // Get counts for each status category
    // Active = pending status (invoices that need review)
    // Approved = approved status (ready to pay)
    // Paid = paid status
    // All = all non-rejected invoices

    // PostgreSQL: Use @> operator for JSONB array contains check
    const result = await pgPool.query(`
      SELECT
        status,
        COUNT(*) as total,
        SUM(CASE WHEN viewed_by IS NULL OR NOT (COALESCE(viewed_by, '[]'::jsonb) @> $1::jsonb) THEN 1 ELSE 0 END) as unread
      FROM invoice_extractions
      WHERE status != 'rejected'
      GROUP BY status
    `, [JSON.stringify([userId || 0])]);

    const statusCounts = result.rows as { status: string; total: number; unread: number }[];

    // Build counts object
    const counts: InvoiceStatusCounts = {
      active: { total: 0, unread: 0 },
      approved: { total: 0, unread: 0 },
      paid: { total: 0, unread: 0 },
      all: { total: 0, unread: 0 },
      myAssignments: { total: 0, unread: 0 },
      unassigned: { total: 0 },
    };

    for (const row of statusCounts) {
      const total = Number(row.total);
      const unread = Number(row.unread);
      counts.all.total += total;
      counts.all.unread += unread;

      if (row.status === 'pending' || row.status === 'on_hold') {
        counts.active.total += total;
        counts.active.unread += unread;
      } else if (row.status === 'approved') {
        counts.approved.total += total;
        counts.approved.unread += unread;
      } else if (row.status === 'paid') {
        counts.paid.total += total;
        counts.paid.unread += unread;
      }
    }

    // Get assignment-based counts (PostgreSQL: assigned_to column instead of assigned_agent_id)
    if (userId) {
      const assignmentResult = await pgPool.query(`
        SELECT
          CASE
            WHEN assigned_to = $1 THEN 'mine'
            WHEN assigned_to IS NULL THEN 'unassigned'
          END as assignment_type,
          COUNT(*) as total,
          SUM(CASE WHEN viewed_by IS NULL OR NOT (COALESCE(viewed_by, '[]'::jsonb) @> $2::jsonb) THEN 1 ELSE 0 END) as unread
        FROM invoice_extractions
        WHERE status != 'rejected'
          AND (assigned_to = $1 OR assigned_to IS NULL)
        GROUP BY assignment_type
      `, [userId, JSON.stringify([userId])]);

      const assignmentCounts = assignmentResult.rows as { assignment_type: string; total: number; unread: number }[];
      for (const row of assignmentCounts) {
        if (row.assignment_type === 'mine') {
          counts.myAssignments.total = Number(row.total);
          counts.myAssignments.unread = Number(row.unread);
        } else if (row.assignment_type === 'unassigned') {
          counts.unassigned.total = Number(row.total);
        }
      }
    } else {
      const unassignedResult = await pgPool.query(`
        SELECT COUNT(*) as total
        FROM invoice_extractions
        WHERE status != 'rejected' AND assigned_to IS NULL
      `);
      counts.unassigned.total = Number(unassignedResult.rows[0]?.total || 0);
    }

    res.json(counts);
  } catch (error) {
    req.log.error({ error }, 'Failed to fetch invoice counts');
    res.status(500).json({
      error: 'Failed to fetch invoice counts',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/invoice-ocr/extractions
 * List all invoice extractions (paginated) with optional filtering
 */
router.get('/extractions', async (req: Request, res: Response): Promise<void> => {
  try {
    // Return empty list if database is not available
    if (!isDatabaseAvailable()) {
      res.json({ extractions: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } });
      return;
    }

    const limit = parseInt((req.query.limit as string) || '20', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const view = (req.query.view as InvoiceViewFilter) || 'all';
    const unreadOnly = req.query.unread_only === 'true';
    const userId = req.query.user_id ? parseInt(req.query.user_id as string, 10) : null;

    // Validate that limit and offset are valid positive integers
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      res.status(400).json({ error: 'Invalid limit parameter' });
      return;
    }
    if (isNaN(offset) || offset < 0) {
      res.status(400).json({ error: 'Invalid offset parameter' });
      return;
    }
    // Validate userId if provided
    if (userId !== null && isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user_id parameter' });
      return;
    }

    // Build WHERE clause based on view filter
    let statusCondition = "status != 'rejected'";
    if (view === 'active') {
      statusCondition = "status IN ('pending', 'on_hold')";
    } else if (view === 'approved') {
      statusCondition = "status = 'approved'";
    } else if (view === 'paid') {
      statusCondition = "status = 'paid'";
    }

    const pgPool = getPgPool()!;

    // Build PostgreSQL query with $N placeholders
    const queryParams: (string | number)[] = [];
    let paramIndex = 1;

    // Add unread filter if requested
    let unreadCondition = '';
    if (unreadOnly && userId !== null) {
      unreadCondition = ` AND (viewed_by IS NULL OR NOT (COALESCE(viewed_by, '[]'::jsonb) @> $${paramIndex}::jsonb))`;
      queryParams.push(JSON.stringify([userId]));
      paramIndex++;
    }

    // PostgreSQL supports LIMIT/OFFSET as placeholders
    const query = `
      SELECT * FROM invoice_extractions
      WHERE ${statusCondition}${unreadCondition}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);

    const result = await pgPool.query(query, queryParams);

    // Get total count with same filters
    const countParams: (string | number)[] = [];
    let countParamIndex = 1;
    let countUnreadCondition = '';
    if (unreadOnly && userId !== null) {
      countUnreadCondition = ` AND (viewed_by IS NULL OR NOT (COALESCE(viewed_by, '[]'::jsonb) @> $${countParamIndex}::jsonb))`;
      countParams.push(JSON.stringify([userId]));
    }
    const countQuery = `
      SELECT COUNT(*) as total FROM invoice_extractions
      WHERE ${statusCondition}${countUnreadCondition}
    `;
    const countResult = await pgPool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total, 10);

    // Transform all records to proper types
    const transformedRows = result.rows.map(transformDatabaseRow);

    req.log.info({ count: transformedRows.length, total, view, unreadOnly }, 'Fetched invoice extractions');

    res.json({
      extractions: transformedRows,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    req.log.error({ error }, 'Failed to fetch invoice extractions');
    res.status(500).json({
      error: 'Failed to fetch invoice extractions',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/invoice-ocr/extractions/:id
 * Get a specific invoice extraction by ID (optionally with line items)
 */
router.get('/extractions/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const includeLineItems = req.query.include_line_items === 'true';

  try {
    const pgPool = getPgPool()!;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      res.status(400).json({ error: 'Invalid invoice ID' });
      return;
    }

    const result = await pgPool.query(
      'SELECT * FROM invoice_extractions WHERE id = $1',
      [parsedId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Invoice extraction not found' });
      return;
    }

    const transformedRecord = transformDatabaseRow(result.rows[0]);

    // If invoice has line items and user wants them, fetch them
    if (includeLineItems && transformedRecord.has_line_items) {
      // Sort by shipment_date ASC so oldest items come first (for performance period calculation)
      // PostgreSQL uses invoice_id instead of invoice_extraction_id
      const lineItemResult = await pgPool.query(
        'SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY shipment_date ASC, id ASC',
        [parsedId]
      );

      const items = lineItemResult.rows as unknown as InvoiceLineItem[];

      // Auto-calculate performance period from line items (always use actual shipment dates when CSV is present)
      // The first item's date = performance_period_start, last item's date = performance_period_end
      let updatedRecord = transformedRecord;
      if (items.length > 0) {
        // Filter items with valid dates and find min/max
        const itemsWithDates = items.filter((item): item is InvoiceLineItem & { shipment_date: string } => !!item.shipment_date);
        if (itemsWithDates.length > 0) {
          const firstDate = itemsWithDates[0].shipment_date;
          const lastDate = itemsWithDates[itemsWithDates.length - 1].shipment_date;

          // Always use line items dates for performance period when CSV data exists
          // This ensures accuracy over AI-extracted dates from PDF header
          const currentStart = transformedRecord.consensus_data.performance_period_start as string;
          const currentEnd = transformedRecord.consensus_data.performance_period_end as string;
          const isEmpty = (val: string | undefined | null) => !val || val === '-' || val === '';

          // Always update when line items exist (CSV was uploaded)
          if (true) {
            // Format dates to DD/MM/YYYY if needed
            // Handle timezone: dates like "2026-03-31T22:00:00.000Z" are actually April 1st at midnight CET
            const formatDateForStorage = (dateVal: string | Date | null | undefined): string => {
              if (!dateVal) return '';

              // Handle Date objects (PostgreSQL returns timestamps as Date objects)
              let date: Date;
              if (dateVal instanceof Date) {
                date = dateVal;
              } else {
                const dateStr = String(dateVal);
                // Already in DD/MM/YYYY format
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
                // Handle DD.MM.YYYY format
                const euMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
                if (euMatch) {
                  const [, day, month, year] = euMatch;
                  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
                }
                // Handle YYYY-MM-DD format (without time)
                const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (isoMatch) {
                  const [, year, month, day] = isoMatch;
                  return `${day}/${month}/${year}`;
                }
                // Parse as date
                date = new Date(dateStr);
              }

              // Apply timezone correction: if UTC hour >= 22, it's the next day in CET
              const utcHour = date.getUTCHours();
              let day = date.getUTCDate();
              let month = date.getUTCMonth();
              let year = date.getUTCFullYear();

              if (utcHour >= 22) {
                const adjusted = new Date(Date.UTC(year, month, day + 1));
                day = adjusted.getUTCDate();
                month = adjusted.getUTCMonth();
                year = adjusted.getUTCFullYear();
              }

              return `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
            };

            const newStart = formatDateForStorage(firstDate);
            const newEnd = formatDateForStorage(lastDate);

            // Update consensus_data with calculated performance period from actual shipments
            const updatedConsensus = {
              ...transformedRecord.consensus_data,
              performance_period_start: newStart,  // Always use line items dates
              performance_period_end: newEnd,      // Always use line items dates
            };

            // Save the updated performance period to database (PostgreSQL)
            // Convert DD/MM/YYYY to YYYY-MM-DD for PostgreSQL DATE columns
            const toIsoDate = (ddmmyyyy: string): string | null => {
              const match = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
              if (match) {
                const [, day, month, year] = match;
                return `${year}-${month}-${day}`;
              }
              return null;
            };
            await pgPool.query(
              'UPDATE invoice_extractions SET consensus_data = $1, performance_period_start = $2, performance_period_end = $3 WHERE id = $4',
              [JSON.stringify(updatedConsensus), toIsoDate(newStart), toIsoDate(newEnd), id]
            );

            updatedRecord = {
              ...transformedRecord,
              consensus_data: updatedConsensus,
            };

            req.log.info(
              { id, firstDate: newStart, lastDate: newEnd },
              'Auto-calculated performance period from line items'
            );
          }
        }
      }

      const recordWithLineItems: InvoiceExtractionRecordWithLineItems = {
        ...updatedRecord,
        line_items: items,
      };

      req.log.info({ id, lineItemCount: items.length }, 'Fetched invoice extraction with line items');
      res.json(recordWithLineItems);
    } else {
      req.log.info({ id }, 'Fetched invoice extraction');
      res.json(transformedRecord);
    }
  } catch (error) {
    req.log.error({ error, id }, 'Failed to fetch invoice extraction');
    res.status(500).json({
      error: 'Failed to fetch invoice extraction',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/invoice-ocr/extractions/:id/linked
 * Get all invoices linked to this invoice (credit notes, surcharges, etc.)
 * Returns child invoices where parent_invoice_id = this invoice's id
 */
router.get('/extractions/:id/linked', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const pgPool = getPgPool()!;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      res.status(400).json({ error: 'Invalid invoice ID' });
      return;
    }

    // Fetch all invoices where parent_invoice_id matches this invoice
    const result = await pgPool.query(
      `SELECT
        id,
        invoice_number,
        vendor,
        document_type,
        net_amount,
        gross_amount,
        currency,
        invoice_date,
        status,
        created_at
      FROM invoice_extractions
      WHERE parent_invoice_id = $1
      ORDER BY created_at DESC`,
      [parsedId]
    );

    // Also check if this invoice itself has a parent (for reverse lookup)
    const parentResult = await pgPool.query(
      `SELECT
        id,
        invoice_number,
        vendor,
        document_type,
        net_amount,
        gross_amount,
        currency,
        invoice_date,
        status,
        created_at
      FROM invoice_extractions
      WHERE id = (SELECT parent_invoice_id FROM invoice_extractions WHERE id = $1)`,
      [parsedId]
    );

    req.log.info(
      { id, childCount: result.rows.length, hasParent: parentResult.rows.length > 0 },
      'Fetched linked invoices'
    );

    res.json({
      children: result.rows,
      parent: parentResult.rows.length > 0 ? parentResult.rows[0] : null,
    });
  } catch (error) {
    req.log.error({ error, id }, 'Failed to fetch linked invoices');
    res.status(500).json({
      error: 'Failed to fetch linked invoices',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/invoice-ocr/fix-unlinked-invoices
 * Retroactively link invoices by shipment_reference_1
 * This fixes invoices that have line items with matching shipment references but no parent_invoice_id
 * Only links "child" document types (credit_note, surcharge_invoice, correction, etc.) - NOT shipping_invoice
 */
router.post('/fix-unlinked-invoices', async (req: Request, res: Response): Promise<void> => {
  try {
    const pgPool = getPgPool()!;

    // Find all invoices without a parent_invoice_id that have line items
    // Only consider "child" document types that should be linked to a parent
    // shipping_invoice documents are the parents, not children
    const unlinkedResult = await pgPool.query(`
      SELECT DISTINCT ie.id, ie.invoice_number, ie.document_type
      FROM invoice_extractions ie
      JOIN invoice_line_items ili ON ili.invoice_id = ie.id
      WHERE ie.parent_invoice_id IS NULL
        AND ili.shipment_reference_1 IS NOT NULL
        AND ili.shipment_reference_1 != ''
        AND ie.document_type != 'shipping_invoice'
    `);

    req.log.info({ count: unlinkedResult.rows.length }, 'Found invoices to check for linking by shipment_reference_1');

    const results = {
      total: unlinkedResult.rows.length,
      linked: 0,
      notFound: 0,
      details: [] as Array<{
        id: number;
        invoice_number: string;
        status: 'linked' | 'not_found';
        parent_id?: number;
        matched_ref?: string;
      }>,
    };

    for (const row of unlinkedResult.rows) {
      // Get all shipment_reference_1 values for this invoice
      const refsResult = await pgPool.query(
        `SELECT DISTINCT shipment_reference_1 FROM invoice_line_items
         WHERE invoice_id = $1 AND shipment_reference_1 IS NOT NULL AND shipment_reference_1 != ''`,
        [row.id]
      );

      const shipmentRefs = refsResult.rows.map(r => r.shipment_reference_1);

      if (shipmentRefs.length === 0) {
        results.notFound++;
        results.details.push({
          id: row.id,
          invoice_number: row.invoice_number,
          status: 'not_found',
        });
        continue;
      }

      // Find another invoice that has any of these shipment_reference_1 values
      const parentLookup = await pgPool.query(
        `SELECT DISTINCT ie.id, ili.shipment_reference_1
         FROM invoice_extractions ie
         JOIN invoice_line_items ili ON ili.invoice_id = ie.id
         WHERE ili.shipment_reference_1 = ANY($1)
           AND ie.id != $2
         ORDER BY ie.id ASC
         LIMIT 1`,
        [shipmentRefs, row.id]
      );

      if (parentLookup.rows.length > 0) {
        const parentId = parentLookup.rows[0].id;
        const matchedRef = parentLookup.rows[0].shipment_reference_1;

        // Update the invoice with the parent_invoice_id
        await pgPool.query(
          'UPDATE invoice_extractions SET parent_invoice_id = $1 WHERE id = $2',
          [parentId, row.id]
        );

        results.linked++;
        results.details.push({
          id: row.id,
          invoice_number: row.invoice_number,
          status: 'linked',
          parent_id: parentId,
          matched_ref: matchedRef,
        });

        req.log.info(
          { invoiceId: row.id, parentId, matchedRef },
          'Linked invoice to parent by shipment_reference_1'
        );
      } else {
        results.notFound++;
        results.details.push({
          id: row.id,
          invoice_number: row.invoice_number,
          status: 'not_found',
        });
      }
    }

    req.log.info(results, 'Completed fixing unlinked invoices');

    res.json({
      success: true,
      message: `Linked ${results.linked} of ${results.total} invoices by shipment_reference_1`,
      ...results,
    });
  } catch (error) {
    req.log.error({ error }, 'Failed to fix unlinked invoices');
    res.status(500).json({
      error: 'Failed to fix unlinked invoices',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/invoice-ocr/extractions/:id/mark-read
 * Mark an invoice as read by a specific user
 */
router.post('/extractions/:id/mark-read', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { user_id } = req.body;

  if (!user_id || typeof user_id !== 'number') {
    res.status(400).json({ error: 'user_id is required and must be a number' });
    return;
  }

  try {
    const pgPool = getPgPool()!;

    // Fetch current record
    const result = await pgPool.query(
      'SELECT id, viewed_by FROM invoice_extractions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Invoice extraction not found' });
      return;
    }

    // Get current viewed_by array (PostgreSQL returns JSONB as object directly)
    const currentViewedBy: number[] = result.rows[0].viewed_by || [];

    // Add user if not already in the list
    if (!currentViewedBy.includes(user_id)) {
      currentViewedBy.push(user_id);

      await pgPool.query(
        'UPDATE invoice_extractions SET viewed_by = $1 WHERE id = $2',
        [JSON.stringify(currentViewedBy), id]
      );

      req.log.info({ id, user_id }, 'Marked invoice as read');
    }

    res.json({ success: true, viewed_by: currentViewedBy });
  } catch (error) {
    req.log.error({ error, id }, 'Failed to mark invoice as read');
    res.status(500).json({
      error: 'Failed to mark invoice as read',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/invoice-ocr/extractions/mark-all-read
 * Mark all invoices in a view as read by a specific user
 */
router.post('/extractions/mark-all-read', async (req: Request, res: Response): Promise<void> => {
  const { user_id, view } = req.body as { user_id: number; view?: InvoiceViewFilter };

  if (!user_id || typeof user_id !== 'number') {
    res.status(400).json({ error: 'user_id is required and must be a number' });
    return;
  }

  try {
    const pgPool = getPgPool()!;

    // Build status condition based on view
    let statusCondition = "status != 'rejected'";
    if (view === 'active') {
      statusCondition = "status IN ('pending', 'on_hold')";
    } else if (view === 'approved') {
      statusCondition = "status = 'approved'";
    } else if (view === 'paid') {
      statusCondition = "status = 'paid'";
    }

    // Update all unread invoices in this view to include this user in viewed_by
    // PostgreSQL: Use || to append to JSONB array
    const result = await pgPool.query(`
      UPDATE invoice_extractions
      SET viewed_by = COALESCE(viewed_by, '[]'::jsonb) || $1::jsonb
      WHERE ${statusCondition}
        AND (viewed_by IS NULL OR NOT (COALESCE(viewed_by, '[]'::jsonb) @> $2::jsonb))
    `, [JSON.stringify([user_id]), JSON.stringify([user_id])]);

    const affectedRows = result.rowCount || 0;
    req.log.info({ user_id, view, affectedRows }, 'Marked all invoices as read');

    res.json({ success: true, marked_count: affectedRows });
  } catch (error) {
    req.log.error({ error }, 'Failed to mark all invoices as read');
    res.status(500).json({
      error: 'Failed to mark all invoices as read',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PATCH /api/invoice-ocr/extractions/:id
 * Partially update consensus_data, status, and/or notes for an extraction
 */
router.patch('/extractions/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const pgPool = getPgPool()!;

    // Fetch current record
    const parsedPatchId = parseInt(id, 10);
    if (isNaN(parsedPatchId)) {
      res.status(400).json({ error: 'Invalid invoice ID' });
      return;
    }

    const result = await pgPool.query(
      'SELECT * FROM invoice_extractions WHERE id = $1',
      [parsedPatchId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Invoice extraction not found' });
      return;
    }

    const current = result.rows[0];
    // PostgreSQL returns JSONB as objects directly
    const currentConsensus = current.consensus_data || {};
    const currentConflicts = current.conflicts_data || {};
    const currentReviewNeeded = current.review_needed || [];

    const updates = req.body as {
      consensus_data?: Partial<import('@shared/types').InvoiceData>;
      notes?: string | null;
      status?: import('@shared/types').InvoiceExtractionStatus;
      assigned_agent_id?: number | null;
      payment_date?: string | null;
      payment_method?: import('@shared/types').InvoicePaymentMethod | null;
      payment_status?: import('@shared/types').InvoicePaymentStatus | null;
      approved_by?: number | null;
    };

    const mergedConsensus = {
      ...currentConsensus,
      ...(updates.consensus_data || {}),
    };

    // Remove manually edited fields from conflicts_data and review_needed
    const editedFields = updates.consensus_data ? Object.keys(updates.consensus_data).filter(k => k !== 'assigned_to') : [];
    const updatedConflicts = { ...currentConflicts };
    let updatedReviewNeeded = [...currentReviewNeeded];

    editedFields.forEach(field => {
      // Remove field from conflicts since user has manually resolved it
      if (field in updatedConflicts) {
        delete updatedConflicts[field];
      }
      // Remove field from review_needed since user has reviewed it
      updatedReviewNeeded = updatedReviewNeeded.filter((f: string) => f !== field);
    });

    // Check if invoice_number is being updated
    const newInvoiceNumber = updates.consensus_data?.invoice_number as string | undefined;
    if (newInvoiceNumber !== undefined) {
      // Check for duplicate invoice number (exclude current record)
      const existingResult = await pgPool.query(
        'SELECT id, file_name FROM invoice_extractions WHERE invoice_number = $1 AND id != $2',
        [newInvoiceNumber, id]
      );
      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        req.log.warn(
          { invoiceNumber: newInvoiceNumber, existingId: existing.id, existingFileName: existing.file_name, currentId: id },
          'Duplicate invoice number detected during update'
        );
        res.status(409).json({
          error: 'Duplicate invoice number',
          message: `Invoice number ${newInvoiceNumber} already exists in another record`,
          existing: {
            id: existing.id,
            file_name: existing.file_name,
          },
        });
        return;
      }
    }

    // Build dynamic UPDATE query based on provided fields (PostgreSQL: $N placeholders)
    const updateFields: string[] = [];
    const updateValues: (string | number | null)[] = [];
    let paramIndex = 1;

    if (updates.consensus_data) {
      updateFields.push(`consensus_data = $${paramIndex++}`);
      updateValues.push(JSON.stringify(mergedConsensus));

      // Update conflicts_data to remove manually edited fields
      updateFields.push(`conflicts_data = $${paramIndex++}`);
      updateValues.push(Object.keys(updatedConflicts).length > 0 ? JSON.stringify(updatedConflicts) : null);

      // Update review_needed to remove manually edited fields
      updateFields.push(`review_needed = $${paramIndex++}`);
      updateValues.push(updatedReviewNeeded.length > 0 ? JSON.stringify(updatedReviewNeeded) : null);

      // If invoice_number is being updated, also update invoice_number column in DB
      if (newInvoiceNumber !== undefined) {
        updateFields.push(`invoice_number = $${paramIndex++}`);
        updateValues.push(newInvoiceNumber || null);
      }

      // Also update dedicated columns from consensus_data for PostgreSQL
      if (updates.consensus_data.vendor !== undefined) {
        updateFields.push(`vendor = $${paramIndex++}`);
        updateValues.push(updates.consensus_data.vendor as string || null);
      }
      if (updates.consensus_data.net_amount !== undefined) {
        updateFields.push(`net_amount = $${paramIndex++}`);
        updateValues.push(updates.consensus_data.net_amount as number || null);
      }
      const grossAmount = updates.consensus_data.gross_amount;
      if (grossAmount !== undefined) {
        updateFields.push(`gross_amount = $${paramIndex++}`);
        updateValues.push(grossAmount as number || null);
      }
    }

    // notes field is deprecated — notes are now stored as threads with entity_type='invoice'

    if (updates.status) {
      // Validate status enum (paid is handled via payment_status field)
      const validStatuses = ['pending', 'processing', 'review', 'approved', 'on_hold', 'rejected'];
      if (!validStatuses.includes(updates.status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        return;
      }
      updateFields.push(`status = $${paramIndex++}`);
      updateValues.push(updates.status);

      // Track who approved and when
      if (updates.status === 'approved') {
        // Set approved_by if provided, and approved_at to current timestamp
        if (updates.approved_by) {
          updateFields.push(`approved_by = $${paramIndex++}`);
          updateValues.push(updates.approved_by);
        }
        updateFields.push(`approved_at = $${paramIndex++}`);
        updateValues.push(new Date().toISOString());
      } else if (updates.status === 'pending') {
        // Undo approval - clear approval tracking
        updateFields.push(`approved_by = $${paramIndex++}`);
        updateValues.push(null);
        updateFields.push(`approved_at = $${paramIndex++}`);
        updateValues.push(null);
      }
    }

    // Handle assignment update (PostgreSQL uses assigned_to column)
    if (updates.assigned_agent_id !== undefined) {
      updateFields.push(`assigned_to = $${paramIndex++}`);
      updateValues.push(updates.assigned_agent_id);
    }

    // Handle payment date update
    if (updates.payment_date !== undefined) {
      updateFields.push(`payment_date = $${paramIndex++}`);
      // Convert various date formats to YYYY-MM-DD for PostgreSQL DATE column
      let dbPaymentDate: string | null = updates.payment_date;
      if (updates.payment_date) {
        // DD/MM/YYYY format
        const ddmmyyyySlashMatch = updates.payment_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (ddmmyyyySlashMatch) {
          const [, day, month, year] = ddmmyyyySlashMatch;
          dbPaymentDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        // DD.MM.YYYY format
        else {
          const ddmmyyyyDotMatch = updates.payment_date.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
          if (ddmmyyyyDotMatch) {
            const [, day, month, year] = ddmmyyyyDotMatch;
            dbPaymentDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
          // YYYY-MM-DD format (already correct)
          else if (/^\d{4}-\d{2}-\d{2}$/.test(updates.payment_date)) {
            dbPaymentDate = updates.payment_date;
          }
          // Invalid format - log warning and use null
          else if (updates.payment_date) {
            req.log.warn({ payment_date: updates.payment_date }, 'Unrecognized payment date format, storing as-is');
          }
        }
      }
      updateValues.push(dbPaymentDate);
    }

    // Handle payment method update
    if (updates.payment_method !== undefined) {
      // Validate payment method enum
      const validPaymentMethods = ['Mercury', 'Bank Transfer', 'PayPal', 'Credit Card', 'Direct Debit', 'Other'];
      if (updates.payment_method !== null && !validPaymentMethods.includes(updates.payment_method)) {
        res.status(400).json({ error: `Invalid payment method. Must be one of: ${validPaymentMethods.join(', ')}` });
        return;
      }
      updateFields.push(`payment_method = $${paramIndex++}`);
      updateValues.push(updates.payment_method);
    }

    // Handle payment status update
    if (updates.payment_status !== undefined) {
      // Validate payment status enum
      const validPaymentStatuses = ['unpaid', 'partial', 'paid', 'refunded'];
      if (updates.payment_status !== null && !validPaymentStatuses.includes(updates.payment_status)) {
        res.status(400).json({ error: `Invalid payment status. Must be one of: ${validPaymentStatuses.join(', ')}` });
        return;
      }
      updateFields.push(`payment_status = $${paramIndex++}`);
      updateValues.push(updates.payment_status);
    }

    if (updateFields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Always update updated_at
    updateFields.push('updated_at = NOW()');

    updateValues.push(id);

    await pgPool.query(
      `UPDATE invoice_extractions SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
      updateValues
    );

    // Create notification if assignment changed
    if (updates.assigned_agent_id !== undefined && updates.assigned_agent_id !== null) {
      const previousAssignee = current.assigned_to as number | null;
      if (updates.assigned_agent_id !== previousAssignee && req.user) {
        // Create notification for the new assignee
        const invoiceNumber = (mergedConsensus.invoice_number as string) || `#${id}`;
        const vendor = (mergedConsensus.vendor as string) || 'Unknown';

        createAssignmentNotification({
          assigneeId: updates.assigned_agent_id,
          invoiceId: parsedPatchId,
          invoiceNumber,
          vendor,
          assignedById: req.user.id,
          assignedByName: req.user.name || req.user.email,
        }).catch(err => {
          req.log.error({ error: err }, 'Failed to create assignment notification');
        });
      }
    }

    // Return updated record
    const updatedResult = await pgPool.query(
      'SELECT * FROM invoice_extractions WHERE id = $1',
      [parsedPatchId]
    );
    const transformedRecord = transformDatabaseRow(updatedResult.rows[0]);

    req.log.info({ id, updates: Object.keys(updates) }, 'Invoice extraction updated');
    res.json(transformedRecord);
  } catch (error) {
    req.log.error({ error, id }, 'Failed to update invoice extraction');
    res.status(500).json({
      error: 'Failed to update invoice extraction',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
router.get('/file/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const pgPool = getPgPool()!;

    // Get file path from invoice_files table via file_id foreign key
    const result = await pgPool.query(
      `SELECT f.local_path, f.file_name
       FROM invoice_extractions e
       JOIN invoice_files f ON e.file_id = f.id
       WHERE e.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const { local_path: file_path, file_name } = result.rows[0];

    // Path traversal protection: ensure file is within allowed upload directories
    const path = await import('path');
    const { resolve, normalize, relative, sep } = path;
    const allowedBaseDirs = [
      resolve(uploadPath),
      resolve(process.cwd(), 'data/uploads'),
      resolve(process.cwd(), 'invoices'),
      process.env.RAILWAY_VOLUME_MOUNT_PATH ? resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'invoices') : null,
      process.env.INVOICE_UPLOAD_PATH ? resolve(process.env.INVOICE_UPLOAD_PATH) : null,
      resolve('/tmp/uploads/invoices'),
    ].filter(Boolean) as string[];

    const normalizedPath = normalize(resolve(file_path));
    const isAllowedPath = allowedBaseDirs.some((baseDir) => {
      const relativePath = relative(baseDir, normalizedPath);
      return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(`..${sep}`));
    });

    if (!isAllowedPath) {
      req.log.error({ id, file_path, normalizedPath }, 'Path traversal attempt detected');
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Check if file exists
    if (!existsSync(file_path)) {
      req.log.error({ id, file_path }, 'Invoice file not found on disk');
      res.status(404).json({ error: 'Invoice file not found' });
      return;
    }

    // Set headers for PDF viewing / download
    res.setHeader('Content-Type', 'application/pdf');
    const download = req.query.download === '1' || req.query.download === 'true';
    const disposition = download ? 'attachment' : 'inline';
    // Sanitize filename to prevent header injection
    const sanitizedFileName = file_name.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Disposition', `${disposition}; filename="${sanitizedFileName}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

    // Stream the file
    const { createReadStream } = await import('fs');
    const stream = createReadStream(file_path);

    stream.on('error', (err) => {
      req.log.error({ err, id, file_path }, 'Error streaming PDF file');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });

    stream.pipe(res);

    req.log.info({ id, file_name }, 'Serving PDF file');
  } catch (error) {
    req.log.error({ error, id }, 'Failed to serve invoice file');
    res.status(500).json({
      error: 'Failed to serve invoice file',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/invoice-ocr/extract-two-stage
 * DEPRECATED: Use /extract endpoint instead
 *
 * This endpoint has been replaced by the optimized vendor-specific Gemini extraction
 * with smart model fallback (Gemini → DeepSeek → Mistral).
 */
/* COMMENTED OUT - Use /extract endpoint instead
router.post(
  '/extract-two-stage',
  upload.single('invoice'),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    req.log.info(
      {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
      'Starting two-stage invoice OCR extraction'
    );

    try {
      // Get configuration from environment
      const primaryModel = process.env.PRIMARY_OCR_MODEL || 'mistral';
      const mistralApiKey = process.env.MISTRAL_API_KEY;
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const replicateApiKey = process.env.REPLICATE_API_KEY;

      // Validate required API keys based on primary model
      if (!geminiApiKey) {
        res.status(500).json({
          error: 'GEMINI_API_KEY is required for Stage 2 (structuring)',
        });
        return;
      }

      if (primaryModel === 'mistral' && !mistralApiKey) {
        res.status(500).json({
          error: 'MISTRAL_API_KEY is required when PRIMARY_OCR_MODEL=mistral',
        });
        return;
      }

      if (primaryModel === 'deepseek' && !replicateApiKey) {
        res.status(500).json({
          error: 'REPLICATE_API_KEY is required when PRIMARY_OCR_MODEL=deepseek',
        });
        return;
      }

      req.log.info(
        { primaryModel },
        'Two-stage pipeline configured'
      );

      // Initialize extractor
      const extractor = new FlexibleTwoStageExtractor({
        primaryModel,
        mistralApiKey,
        geminiApiKey,
        replicateApiKey,
      });

      // Run extraction
      const result = await extractor.extractInvoice(file.path);

      // Extract invoice number for deduplication
      const invoiceNumber = result.structured.invoiceData.invoice_number || null;

      // Build review_needed array based on confidence and ambiguities
      const reviewNeeded: string[] = [];
      if (result.structured.confidence < 0.7) {
        reviewNeeded.push('low_confidence');
      }
      if (result.structured.ambiguities && result.structured.ambiguities.length > 0) {
        reviewNeeded.push(...result.structured.ambiguities);
      }
      if (!invoiceNumber) {
        reviewNeeded.push('invoice_number');
      }

      // Auto-determine if this is a logistics invoice
      const isLogistics = KNOWN_LOGISTICS_VENDORS.some((vendor) =>
        result.structured.invoiceData.vendor.toLowerCase().includes(vendor.toLowerCase())
      );

      // Save to database (using actual table schema)
      const [insertResult] = await logsPool.execute<any>(
        `INSERT INTO support_logistics_invoice_extractions (
          file_name,
          invoice_number,
          file_path,
          file_size,
          models_used,
          confidence_score,
          consensus_data,
          conflicts_data,
          missing_data,
          raw_results,
          review_needed,
          created_by,
          created_via,
          notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          file.originalname,
          invoiceNumber,
          file.path,
          file.size,
          JSON.stringify([result.rawOCR.model, 'gemini-structuring']),
          result.structured.confidence,
          JSON.stringify(result.structured.invoiceData),
          JSON.stringify({}), // No conflicts in two-stage (single extraction)
          JSON.stringify(result.structured.ambiguities || []),
          JSON.stringify({
            [result.rawOCR.model]: result.structured.invoiceData,
            metadata: {
              primaryModel: result.rawOCR.model,
              stage1Time: result.rawOCR.extractionTime,
              stage2Time: result.totalTime - result.rawOCR.extractionTime,
              totalTime: result.totalTime,
              reasoning: result.structured.reasoning,
              rawTextLength: result.rawOCR.fullText.length,
            }
          }),
          JSON.stringify(reviewNeeded),
          null, // created_by (not set for API uploads)
          'api-two-stage', // created_via
          `Two-stage: ${result.rawOCR.model} OCR + Gemini structuring. Vendor: ${result.structured.invoiceData.vendor || 'Unknown'}`,
        ]
      );

      req.log.info(
        {
          extractionId: insertResult.insertId,
          invoiceNumber,
          vendor: result.structured.invoiceData.vendor,
          primaryModel: result.rawOCR.model,
          totalTime: result.totalTime,
          confidence: result.structured.confidence,
        },
        'Two-stage extraction completed and saved'
      );

      // Return response
      const response: InvoiceExtractionResponse = {
        success: true,
        extractionId: insertResult.insertId,
        invoiceNumber,
        vendor: result.structured.invoiceData.vendor || null,
        data: result.structured.invoiceData,
        metadata: {
          fileName: file.originalname,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          isLogistics,
        },
        analysis: {
          primaryModel: result.rawOCR.model,
          stage1Time: result.rawOCR.extractionTime,
          stage2Time: result.totalTime - result.rawOCR.extractionTime,
          totalTime: result.totalTime,
          confidence: result.structured.confidence,
          reasoning: result.structured.reasoning,
          reviewNeeded,
        },
        debug: {
          rawOCRText: result.rawOCR.fullText.substring(0, 500), // First 500 chars for debugging
          fullRawText: result.rawOCR.fullText, // Full text for reference
        },
      };

      res.status(201).json(response);
    } catch (error) {
      req.log.error({ error, fileName: file?.originalname }, 'Two-stage extraction failed');
      res.status(500).json({
        success: false,
        error: 'Extraction failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);
*/

/**
 * GET /api/invoice-ocr/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    service: 'Invoice OCR Service',
    models: {
      mistral: !!process.env.MISTRAL_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      deepseek: !!process.env.REPLICATE_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
    },
    primaryOcrModel: process.env.PRIMARY_OCR_MODEL || 'mistral',
    uploadPath,
    maxFileSize,
  });
});

/**
 * POST /api/invoice-ocr/extract-with-line-items
 * Upload invoice PDF + CSV with line items
 */
router.post(
  '/extract-with-line-items',
  upload.fields([
    { name: 'invoice', maxCount: 1 },
    { name: 'csv', maxCount: 1 }
  ]),
  async (req: Request, res: Response): Promise<void> => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const body = req.body as Partial<Record<keyof InvoiceExtractionRequest, string | string[]>>;

    if (!files || !files.invoice || !files.csv) {
      res.status(400).json({ error: 'Both invoice PDF and CSV/Excel files are required' });
      return;
    }

    const invoiceFile = files.invoice[0];
    const csvFile = files.csv[0];

    req.log.info(
      {
        invoiceFileName: invoiceFile.originalname,
        csvFileName: csvFile.originalname,
        invoiceSize: invoiceFile.size,
        csvSize: csvFile.size,
      },
      'Starting multi-file invoice extraction with line items'
    );

    try {
      // Validate CSV file first
      const validation = validateInvoiceCSV(csvFile.path);
      if (!validation.valid) {
        // Clean up uploaded files on validation failure
        const { unlink } = await import('fs/promises');
        try {
          if (existsSync(invoiceFile.path)) await unlink(invoiceFile.path);
          if (existsSync(csvFile.path)) await unlink(csvFile.path);
        } catch (cleanupErr) {
          req.log.error({ cleanupErr }, 'Failed to clean up files after validation error');
        }
        res.status(400).json({ error: validation.error });
        return;
      }

      req.log.info({ rowCount: validation.rowCount }, 'CSV validation passed');

      // Get API keys from environment
      const mistralApiKey = process.env.MISTRAL_API_KEY;
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      const replicateApiKey = process.env.REPLICATE_API_KEY;

      if (!mistralApiKey && !geminiApiKey && !openRouterApiKey && !replicateApiKey) {
        res.status(500).json({
          error: 'Server configuration error: No OCR API keys configured',
        });
        return;
      }

      // Determine models to use
      let models: string[] = ['deepseek', 'mistral', 'gemini'];
      if (body.models) {
        if (typeof body.models === 'string') {
          const modelsString = body.models;
          try {
            models = JSON.parse(modelsString);
          } catch {
            models = modelsString.split(',').map((m: string) => m.trim());
          }
        } else if (Array.isArray(body.models)) {
          models = body.models;
        }
      }
      models = models.slice(0, 3);

      // Extract invoice data from PDF
      const extraction = await extractWithMultipleModels(invoiceFile.path, {
        mistralApiKey,
        geminiApiKey,
        openRouterApiKey,
        replicateApiKey,
        models,
      });

      // Normalize vendor name to standard format
      let extractedVendor = (extraction.analysis.consensus.vendor as string) || '';

      // Fallback: If PDF extraction didn't get vendor, try CSV/PDF filename detection
      if (!extractedVendor) {
        const csvBaseName = csvFile?.originalname?.toLowerCase().replace(/\s+/g, '') || '';
        const pdfBaseName = invoiceFile?.originalname?.toLowerCase().replace(/\s+/g, '') || '';
        const combinedName = csvBaseName + pdfBaseName;

        if (combinedName.includes('ups')) {
          extractedVendor = 'UPS';
          req.log.info({ csvFileName: csvFile?.originalname, pdfFileName: invoiceFile?.originalname }, 'Detected UPS vendor from filename');
        } else if (combinedName.includes('dhl')) {
          extractedVendor = 'DHL';
          req.log.info({ csvFileName: csvFile?.originalname, pdfFileName: invoiceFile?.originalname }, 'Detected DHL vendor from filename');
        } else if (combinedName.includes('gls')) {
          extractedVendor = 'GLS';
          req.log.info({ csvFileName: csvFile?.originalname }, 'Detected GLS vendor from filename');
        } else if (combinedName.includes('hive')) {
          extractedVendor = 'Hive';
          req.log.info({ csvFileName: csvFile?.originalname }, 'Detected Hive vendor from filename');
        } else if (combinedName.includes('eurosender')) {
          extractedVendor = 'Eurosender';
          req.log.info({ csvFileName: csvFile?.originalname }, 'Detected Eurosender vendor from filename');
        } else if (combinedName.includes('sendcloud')) {
          extractedVendor = 'Sendcloud';
          req.log.info({ csvFileName: csvFile?.originalname }, 'Detected Sendcloud vendor from filename');
        } else if (
          combinedName.includes('s2c') ||
          combinedName.includes('buycycle_') ||
          combinedName.includes('overmax') ||
          (combinedName.includes('sport') && combinedName.includes('event')) ||
          /\d{6}_ve/.test(combinedName) // S2C invoice pattern like "000081_ve"
        ) {
          extractedVendor = 'S2C';
          req.log.info({ csvFileName: csvFile?.originalname, pdfFileName: invoiceFile?.originalname }, 'Detected S2C vendor from filename');
        } else if (
          combinedName.includes('redstag') ||
          combinedName.includes('red_stag') ||
          combinedName.includes('_bcl_') ||
          combinedName.includes('bcl_') ||
          (combinedName.includes('shipping_invoice') && combinedName.includes('client_detail'))
        ) {
          extractedVendor = 'Red Stag';
          req.log.info({ csvFileName: csvFile?.originalname, pdfFileName: invoiceFile?.originalname }, 'Detected Red Stag vendor from filename');
        }
      }

      const standardizedVendor = normalizeVendorName(extractedVendor);
      extraction.analysis.consensus.vendor = standardizedVendor;

      req.log.info(
        {
          originalVendor: extractedVendor,
          standardizedVendor: standardizedVendor,
        },
        'Vendor name normalized (CSV upload)'
      );

      const invoiceNumber = (extraction.analysis.consensus.invoice_number as string) || null;

      // Normalize document type (detect credit notes, corrections, etc.)
      const { normalizeDocumentType } = await import('../services/invoice-ocr/utils');
      const rawDocumentType = (extraction.analysis.consensus.document_type as string) || '';
      const netAmount = (extraction.analysis.consensus.net_amount as number) || 0;
      const normalizedDocumentType = normalizeDocumentType(
        rawDocumentType,
        netAmount,
        invoiceNumber || ''
      );

      // Update consensus data with normalized document type
      extraction.analysis.consensus.document_type = normalizedDocumentType;

      // Extract parent invoice number for linked invoices (credit notes, surcharges, oversize, etc.)
      const parentInvoiceNumber = (extraction.analysis.consensus.parent_invoice_number as string) || null;
      let parentInvoiceId: number | null = null;

      // If we have a parent invoice number, try to find the parent invoice
      // This works for ALL document types: credit_note, surcharge_invoice, oversize, correction, etc.
      if (parentInvoiceNumber) {
        req.log.info(
          { parentInvoiceNumber, documentType: normalizedDocumentType },
          'Looking up parent invoice for linked document (CSV upload)'
        );

        const pgPool = getPgPool();
        if (pgPool) {
          // First, try to match by invoice_number
          let parentLookup = await pgPool.query(
            'SELECT id FROM invoice_extractions WHERE invoice_number = $1 LIMIT 1',
            [parentInvoiceNumber]
          );

          if (parentLookup.rows.length > 0) {
            parentInvoiceId = parentLookup.rows[0].id;
            req.log.info(
              { parentInvoiceNumber, parentInvoiceId, matchedBy: 'invoice_number' },
              'Found parent invoice by invoice_number'
            );
          } else {
            // If not found by invoice_number, try to find by shipment_reference_1 in line items
            req.log.info(
              { parentInvoiceNumber },
              'Parent not found by invoice_number, searching by shipment_reference_1 in line items'
            );

            parentLookup = await pgPool.query(
              `SELECT DISTINCT ie.id
               FROM invoice_extractions ie
               JOIN invoice_line_items ili ON ili.invoice_id = ie.id
               WHERE ili.shipment_reference_1 = $1
               LIMIT 1`,
              [parentInvoiceNumber]
            );

            if (parentLookup.rows.length > 0) {
              parentInvoiceId = parentLookup.rows[0].id;
              req.log.info(
                { parentInvoiceNumber, parentInvoiceId, matchedBy: 'shipment_reference_1' },
                'Found parent invoice by shipment_reference_1'
              );
            } else {
              req.log.warn(
                { parentInvoiceNumber },
                'Parent invoice not found in database - document will be saved without link'
              );
            }
          }
        }
      }

      if (!invoiceNumber) {
        req.log.warn(
          { fileName: invoiceFile.originalname },
          'Invoice number could not be extracted'
        );
        if (!extraction.analysis.review_needed.includes('invoice_number')) {
          extraction.analysis.review_needed.push('invoice_number');
        }
      }

      // Check if this is a GLS or Hive vendor (these need hybrid extraction)
      const vendorLower = standardizedVendor.toLowerCase();
      const needsHybridExtraction = vendorLower === 'gls' || vendorLower === 'hive';

      let lineItems;

      if (needsHybridExtraction) {
        // Use hybrid extraction for GLS/Hive (combines PDF header + CSV line items)
        req.log.info({ vendor: standardizedVendor }, 'Using hybrid extraction for vendor with CSV line items');
        const { hybridPdfCsvExtraction } = await import('../services/invoice-ocr');
        const hybridResult = await hybridPdfCsvExtraction(
          invoiceFile.path,
          csvFile.path,
          standardizedVendor,
          {
            mistralApiKey,
            geminiApiKey,
            openRouterApiKey,
            replicateApiKey,
            models,
          }
        );
        lineItems = hybridResult.analysis.consensus.line_items as OCRLineItem[];
        req.log.info({ lineItemCount: lineItems.length }, 'Extracted line items via hybrid method');
      } else if (vendorLower === 'ups' || vendorLower.includes('ups')) {
        // UPS RAW format CSV - use specialized UPS parser
        req.log.info({ vendor: standardizedVendor }, 'Using UPS CSV parser');
        lineItems = await parseUPSCSV(csvFile.path);
        req.log.info({ lineItemCount: lineItems.length }, 'Parsed UPS CSV line items');
      } else if (vendorLower === 'dhl' || vendorLower.includes('dhl')) {
        // DHL format CSV - use specialized DHL parser
        req.log.info({ vendor: standardizedVendor }, 'Using DHL CSV parser');
        lineItems = await parseDHLCSV(csvFile.path);
        req.log.info({ lineItemCount: lineItems.length }, 'Parsed DHL CSV line items');
      } else if (vendorLower === 'eurosender' || vendorLower.includes('eurosender')) {
        // Eurosender - supports both CSV and XLSX
        const fileExt = csvFile.originalname.toLowerCase().split('.').pop();
        const isXlsx = fileExt === 'xlsx' || fileExt === 'xls';

        if (isXlsx) {
          req.log.info({ vendor: standardizedVendor, fileType: 'xlsx' }, 'Using Eurosender XLSX parser');
          lineItems = await parseEurosenderXLSX(csvFile.path);
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed Eurosender XLSX line items');
        } else {
          req.log.info({ vendor: standardizedVendor, fileType: 'csv' }, 'Using Eurosender CSV parser');
          lineItems = await parseEurosenderCSV(csvFile.path);
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed Eurosender CSV line items');
        }
      } else if (vendorLower === 'sendcloud' || vendorLower.includes('sendcloud')) {
        // Sendcloud format CSV
        req.log.info({ vendor: standardizedVendor }, 'Using Sendcloud CSV parser');
        lineItems = await parseSendcloudCSV(csvFile.path);
        req.log.info({ lineItemCount: lineItems.length }, 'Parsed Sendcloud CSV line items');
      } else if (vendorLower === 's2c' || vendorLower.includes('s2c') || vendorLower.includes('sport')) {
        // S2C (Ship to Cycle / Sport & Events) - supports both CSV and XLSX
        const fileExt = csvFile.originalname.toLowerCase().split('.').pop();
        const isXlsx = fileExt === 'xlsx' || fileExt === 'xls';

        if (isXlsx) {
          // XLSX file - detect overmax vs credit note from filename
          const fileName = csvFile.originalname.toLowerCase();
          const isCredit = fileName.includes('credit');
          req.log.info({ vendor: standardizedVendor, fileType: 'xlsx', isCredit }, 'Using S2C XLSX parser');

          if (isCredit) {
            lineItems = await parseS2CCreditNoteXLSX(csvFile.path);
          } else {
            lineItems = await parseS2COvermaxXLSX(csvFile.path);
          }
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed S2C XLSX line items');
        } else {
          // CSV file - regular shipment data
          req.log.info({ vendor: standardizedVendor, fileType: 'csv' }, 'Using S2C CSV parser');
          lineItems = await parseS2CCSV(csvFile.path);
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed S2C CSV line items');
        }
      } else if (vendorLower === 'red stag' || vendorLower.includes('red stag') || vendorLower.includes('redstag')) {
        // Red Stag Fulfillment - XLSX shipping details (FedEx)
        const fileExt = csvFile.originalname.toLowerCase().split('.').pop();
        const isXlsx = fileExt === 'xlsx' || fileExt === 'xls';

        if (isXlsx) {
          req.log.info({ vendor: standardizedVendor, fileType: 'xlsx' }, 'Using Red Stag Shipping XLSX parser');
          lineItems = await parseRedStagShippingXLSX(csvFile.path);
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed Red Stag XLSX line items');
        } else {
          // CSV fallback - use generic parser
          req.log.info({ vendor: standardizedVendor, fileType: 'csv' }, 'Red Stag CSV - using generic parser');
          lineItems = parseInvoiceCSV(csvFile.path);
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed Red Stag CSV line items');
        }
      } else {
        // Fallback - check file type
        const fileExt = csvFile.originalname.toLowerCase().split('.').pop();
        const isXlsx = fileExt === 'xlsx' || fileExt === 'xls';

        if (isXlsx) {
          // XLSX file without recognized vendor - try Eurosender as default for xlsx
          req.log.info({ vendor: standardizedVendor, fileType: 'xlsx' }, 'Unknown vendor XLSX - trying Eurosender parser');
          lineItems = await parseEurosenderXLSX(csvFile.path);
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed XLSX line items using Eurosender parser');
        } else {
          // Fallback to standard CSV parsing (DHL template format, etc.)
          lineItems = parseInvoiceCSV(csvFile.path);
          req.log.info({ lineItemCount: lineItems.length }, 'Parsed CSV line items');
        }
      }

      // Calculate performance period from line items (actual shipment dates)
      // This is more accurate than AI-extracted dates from PDF header
      if (lineItems.length > 0) {
        const itemsWithDates = lineItems
          .filter((item) => !!item.shipment_date)
          .sort((a, b) => new Date(a.shipment_date!).getTime() - new Date(b.shipment_date!).getTime());

        if (itemsWithDates.length > 0) {
          // Format date handling timezone correctly
          // Dates like "2026-03-31T22:00:00.000Z" are actually April 1st at midnight CET
          const formatDateForConsensus = (dateStr: string): string => {
            const date = new Date(dateStr);
            // Use UTC+1/+2 (CET/CEST) - add offset to get correct local date
            // If hour is >= 22 UTC, it's actually the next day in CET
            const utcHour = date.getUTCHours();
            let day = date.getUTCDate();
            let month = date.getUTCMonth();
            let year = date.getUTCFullYear();

            // Adjust for CET timezone (UTC+1 or UTC+2)
            // If stored as 22:00 UTC, it's midnight CET = next day
            if (utcHour >= 22) {
              const adjusted = new Date(Date.UTC(year, month, day + 1));
              day = adjusted.getUTCDate();
              month = adjusted.getUTCMonth();
              year = adjusted.getUTCFullYear();
            }

            return `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
          };

          const firstDate = formatDateForConsensus(itemsWithDates[0].shipment_date!);
          const lastDate = formatDateForConsensus(itemsWithDates[itemsWithDates.length - 1].shipment_date!);

          // Override AI-extracted performance period with actual shipment dates
          extraction.analysis.consensus.performance_period_start = firstDate;
          extraction.analysis.consensus.performance_period_end = lastDate;

          req.log.info(
            { firstDate, lastDate, lineItemCount: itemsWithDates.length },
            'Calculated performance period from CSV line items'
          );
        }
      }

      // PostgreSQL: Use transaction with client from pool
      const pgPool = getPgPool()!;
      const client = await pgPool.connect();
      let invoiceExtractionId: number;

      try {
        await client.query('BEGIN');

        // Step 1: Insert into invoice_files first
        const fileInsertQuery = `
          INSERT INTO invoice_files (
            file_type,
            file_name,
            file_size,
            mime_type,
            local_path,
            source,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `;

        const fileResult = await client.query(fileInsertQuery, [
          'pdf',
          invoiceFile.originalname,
          invoiceFile.size,
          'application/pdf',
          invoiceFile.path,
          'api',
          'completed',
        ]);

        const fileId = fileResult.rows[0].id;

        // Step 2: Insert into invoice_extractions with file_id reference
        // Note: csv_file_path/csv_file_name stored in notes field as JSON for reference
        // Performance period is calculated from line items when CSV is present
        const toIsoDate = (ddmmyyyy: string | undefined): string | null => {
          if (!ddmmyyyy) return null;
          const match = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          if (match) {
            const [, day, month, year] = match;
            return `${year}-${month}-${day}`;
          }
          return null;
        };

        const insertQuery = `
          INSERT INTO invoice_extractions (
            file_id,
            invoice_number,
            vendor,
            document_type,
            parent_invoice_id,
            parent_invoice_number,
            net_amount,
            gross_amount,
            performance_period_start,
            performance_period_end,
            models_used,
            confidence_score,
            consensus_data,
            conflicts_data,
            raw_results,
            has_line_items,
            line_items_source,
            notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING id
        `;

        const result = await client.query(insertQuery, [
          fileId,
          invoiceNumber,
          standardizedVendor,
          normalizedDocumentType,
          parentInvoiceId,
          parentInvoiceNumber,
          extraction.analysis.consensus.net_amount || null,
          extraction.analysis.consensus.gross_amount || null,
          toIsoDate(extraction.analysis.consensus.performance_period_start as string),
          toIsoDate(extraction.analysis.consensus.performance_period_end as string),
          JSON.stringify(models),
          extraction.analysis.confidence_score,
          JSON.stringify(extraction.analysis.consensus),
          JSON.stringify(extraction.analysis.conflicts),
          JSON.stringify(extraction.raw_results),
          true, // has_line_items
          'csv_parser',
          JSON.stringify({ csv_file_path: csvFile.path, csv_file_name: csvFile.originalname }),
        ]);

        invoiceExtractionId = result.rows[0].id;

        // Insert line items (PostgreSQL: uses invoice_id and vendor_raw_data JSONB)
        if (lineItems.length > 0) {
          // Helper to convert undefined to null for database insertion
          const toDbValue = (val: string | number | null | undefined) => (val === undefined ? null : val);
          // Helper for date fields - converts empty strings to null (PostgreSQL can't parse empty string as date)
          const toDbDate = (val: string | null | undefined) => (!val || val.trim() === '' ? null : val);

          const lineItemInsertQuery = `
            INSERT INTO invoice_line_items (
              invoice_id,
              vendor,
              invoice_number,
              shipment_number,
              shipment_date,
              booking_date,
              shipment_reference_1,
              shipment_reference_2,
              product_name,
              pieces,
              weight_kg,
              weight_flag,
              origin_country,
              origin_city,
              origin_postal_code,
              destination_country,
              destination_city,
              destination_postal_code,
              net_amount,
              gross_amount,
              base_price,
              total_tax,
              total_surcharges,
              vendor_raw_data,
              extraction_source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
          `;

          // Insert each line item individually
          for (const item of lineItems) {
            // Store extra charges in vendor_raw_data JSONB
            const vendorRawData = {
              total_surcharges_tax: item.total_surcharges_tax,
              xc1_code: item.xc1_code, xc1_name: item.xc1_name, xc1_charge: item.xc1_charge,
              xc2_code: item.xc2_code, xc2_name: item.xc2_name, xc2_charge: item.xc2_charge,
              xc3_code: item.xc3_code, xc3_name: item.xc3_name, xc3_charge: item.xc3_charge,
              xc4_code: item.xc4_code, xc4_name: item.xc4_name, xc4_charge: item.xc4_charge,
              xc5_code: item.xc5_code, xc5_name: item.xc5_name, xc5_charge: item.xc5_charge,
              xc6_code: item.xc6_code, xc6_name: item.xc6_name, xc6_charge: item.xc6_charge,
              xc7_code: item.xc7_code, xc7_name: item.xc7_name, xc7_charge: item.xc7_charge,
              xc8_code: item.xc8_code, xc8_name: item.xc8_name, xc8_charge: item.xc8_charge,
              xc9_code: item.xc9_code, xc9_name: item.xc9_name, xc9_charge: item.xc9_charge,
            };

            await client.query(lineItemInsertQuery, [
              invoiceExtractionId,
              standardizedVendor,
              toDbValue(item.invoice_number),
              toDbValue(item.shipment_number),
              toDbDate(item.shipment_date),
              toDbDate(item.booking_date),
              toDbValue(item.shipment_reference_1),
              toDbValue(item.shipment_reference_2),
              toDbValue(item.product_name),
              toDbValue(item.pieces),
              toDbValue(item.weight_kg),
              toDbValue(item.weight_flag),
              toDbValue(item.origin_country),
              toDbValue(item.origin_city),
              toDbValue(item.origin_postal_code),
              toDbValue(item.destination_country),
              toDbValue(item.destination_city),
              toDbValue(item.destination_postal_code),
              toDbValue(item.net_amount),
              toDbValue(item.gross_amount),
              toDbValue(item.base_price),
              toDbValue(item.total_tax),
              toDbValue(item.total_surcharges),
              JSON.stringify(vendorRawData),
              'csv_parser',
            ]);
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Post-commit operations - wrapped in separate try-catch so failures don't cause 500
      // The invoice is already saved at this point, so we should return success even if these fail
      let record: InvoiceExtractionRecord | null = null;
      let postCommitWarning: string | undefined;

      try {
        // If no parent was found via parent_invoice_number, try to link by shipment_reference_1
        // Only do this for child document types (not shipping_invoice - those are parents, not children)
        if (!parentInvoiceId && lineItems.length > 0 && normalizedDocumentType !== 'shipping_invoice') {
          // Collect unique shipment_reference_1 values from line items
          const shipmentRefs = lineItems
            .map(item => item.shipment_reference_1)
            .filter((ref): ref is string => !!ref && ref.trim() !== '');

          if (shipmentRefs.length > 0) {
            req.log.info(
              { invoiceId: invoiceExtractionId, shipmentRefs: shipmentRefs.slice(0, 5), documentType: normalizedDocumentType },
              'Attempting to link invoice by shipment_reference_1 (CSV upload)'
            );

            // Find another invoice that has any of these shipment_reference_1 values
            // Exclude the current invoice from the search
            const parentByRefQuery = await pgPool.query(
              `SELECT DISTINCT ie.id
               FROM invoice_extractions ie
               JOIN invoice_line_items ili ON ili.invoice_id = ie.id
               WHERE ili.shipment_reference_1 = ANY($1)
                 AND ie.id != $2
               ORDER BY ie.id ASC
               LIMIT 1`,
              [shipmentRefs, invoiceExtractionId]
            );

            if (parentByRefQuery.rows.length > 0) {
              const foundParentId = parentByRefQuery.rows[0].id;

              // Update the invoice with the parent_invoice_id
              await pgPool.query(
                'UPDATE invoice_extractions SET parent_invoice_id = $1 WHERE id = $2',
                [foundParentId, invoiceExtractionId]
              );

              req.log.info(
                { invoiceId: invoiceExtractionId, parentInvoiceId: foundParentId, matchedBy: 'shipment_reference_1' },
                'Linked invoice to parent by shipment_reference_1 (CSV upload)'
              );
            } else {
              req.log.info(
                { invoiceId: invoiceExtractionId },
                'No parent invoice found by shipment_reference_1 (CSV upload)'
              );
            }
          }
        }

        // Fetch the created record
        const fetchResult = await pgPool.query(
          'SELECT * FROM invoice_extractions WHERE id = $1',
          [invoiceExtractionId]
        );

        if (!fetchResult.rows[0]) {
          req.log.warn(
            { invoiceId: invoiceExtractionId },
            'Could not fetch invoice record after commit - record may not be immediately visible'
          );
        } else {
          record = transformDatabaseRow(fetchResult.rows[0]);
        }

        req.log.info(
          {
            id: record?.id ?? invoiceExtractionId,
            lineItemCount: lineItems.length,
            confidenceScore: extraction.analysis.confidence_score,
          },
          'Multi-file invoice extraction saved successfully'
        );
      } catch (postCommitError) {
        // Log the error but don't fail - invoice is already saved
        const errorMessage = postCommitError instanceof Error ? postCommitError.message : String(postCommitError);
        const errorStack = postCommitError instanceof Error ? postCommitError.stack : undefined;
        req.log.error(
          {
            error: errorMessage,
            stack: errorStack,
            invoiceId: invoiceExtractionId
          },
          'Post-commit processing failed but invoice was saved successfully'
        );
        postCommitWarning = `Invoice saved but post-processing failed: ${errorMessage}`;
      }

      const response: InvoiceExtractionResponse = {
        id: record?.id ?? invoiceExtractionId,
        extraction,
        ...(record && { database_record: record }),
        ...(postCommitWarning && { warning: postCommitWarning }),
      };

      res.status(201).json(response);
    } catch (error) {
      // Clean up uploaded files on error
      const { unlink } = await import('fs/promises');
      try {
        if (invoiceFile?.path && existsSync(invoiceFile.path)) await unlink(invoiceFile.path);
        if (csvFile?.path && existsSync(csvFile.path)) await unlink(csvFile.path);
      } catch (cleanupErr) {
        req.log.error({ cleanupErr }, 'Failed to clean up files after extraction error');
      }

      req.log.error(
        { error, invoiceFileName: invoiceFile?.originalname, csvFileName: csvFile?.originalname },
        'Multi-file invoice extraction failed'
      );
      res.status(500).json({
        error: 'Failed to extract invoice with line items',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /api/invoice-ocr/vendors
 * Returns known logistics vendors for structured selection
 */
router.get('/vendors', (_req: Request, res: Response): void => {
  res.json({ vendors: KNOWN_LOGISTICS_VENDORS });
});

/**
 * POST /api/invoice-ocr/migrate/add-viewed-by
 * One-time migration to add viewed_by column for read tracking
 * NOTE: PostgreSQL table already has this column in schema
 */
router.post('/migrate/add-viewed-by', async (req: Request, res: Response): Promise<void> => {
  try {
    const pgPool = getPgPool();
    if (!pgPool) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    // PostgreSQL: Check if column exists using information_schema
    const result = await pgPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'invoice_extractions' AND column_name = 'viewed_by'
    `);

    if (result.rows.length > 0) {
      res.json({ success: true, message: 'Column viewed_by already exists in invoice_extractions' });
      return;
    }

    // Add the viewed_by column if it doesn't exist
    await pgPool.query(`
      ALTER TABLE invoice_extractions
      ADD COLUMN IF NOT EXISTS viewed_by JSONB DEFAULT NULL
    `);

    req.log.info('Added viewed_by column to invoice_extractions');
    res.json({ success: true, message: 'Added viewed_by column successfully' });
  } catch (error) {
    req.log.error({ error }, 'Failed to add viewed_by column');
    res.status(500).json({
      error: 'Migration failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/invoice-ocr/migrate/normalize-vendors
 * One-time migration to normalize all existing vendor names in the database
 * Updates vendors in both the dedicated vendor column and consensus_data
 */
router.post('/migrate/normalize-vendors', async (req: Request, res: Response): Promise<void> => {
  try {
    const pgPool = getPgPool();
    if (!pgPool) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    // PostgreSQL: JSONB is returned as objects directly
    const result = await pgPool.query(
      `SELECT id, vendor, consensus_data, conflicts_data FROM invoice_extractions WHERE vendor IS NOT NULL OR consensus_data IS NOT NULL`
    );

    const updates: Array<{ id: number; field: string; oldVendor: string; newVendor: string }> = [];

    for (const row of result.rows) {
      let needsUpdate = false;
      const consensusData = row.consensus_data || {};
      const conflictsData = row.conflicts_data || {};
      let newVendorColumn = row.vendor;

      // Normalize vendor column
      if (row.vendor) {
        const oldVendor = row.vendor;
        const newVendor = normalizeVendorName(oldVendor);
        if (oldVendor !== newVendor) {
          newVendorColumn = newVendor;
          needsUpdate = true;
          updates.push({ id: row.id, field: 'vendor', oldVendor, newVendor });
        }
      }

      // Normalize consensus_data.vendor
      if (consensusData?.vendor) {
        const oldVendor = consensusData.vendor;
        const newVendor = normalizeVendorName(oldVendor);
        if (oldVendor !== newVendor) {
          consensusData.vendor = newVendor;
          needsUpdate = true;
          updates.push({ id: row.id, field: 'consensus_data', oldVendor, newVendor });
        }
      }

      // Normalize conflicts_data.vendor._final_value
      if (conflictsData?.vendor?._final_value) {
        const oldVendor = conflictsData.vendor._final_value;
        const newVendor = normalizeVendorName(oldVendor);
        if (oldVendor !== newVendor) {
          conflictsData.vendor._final_value = newVendor;
          needsUpdate = true;
          updates.push({ id: row.id, field: 'conflicts_data', oldVendor, newVendor });
        }
      }

      if (needsUpdate) {
        await pgPool.query(
          `UPDATE invoice_extractions SET vendor = $1, consensus_data = $2, conflicts_data = $3, updated_at = NOW() WHERE id = $4`,
          [newVendorColumn, JSON.stringify(consensusData), JSON.stringify(conflictsData), row.id]
        );
      }
    }

    req.log.info({ updatedCount: updates.length }, 'Vendor name normalization migration completed');

    res.json({
      success: true,
      message: `Normalized ${updates.length} vendor names`,
      updates,
    });
  } catch (error) {
    req.log.error({ error }, 'Vendor normalization migration failed');
    res.status(500).json({
      error: 'Migration failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================
// Consolidated Monthly Accounting View
// ============================================

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthKeyToLabel(key: string): string {
  const [yearStr, monthStr] = key.split('-');
  const monthIndex = parseInt(monthStr, 10) - 1;
  return `${MONTH_NAMES[monthIndex]} ${yearStr}`;
}

function buildColumnOrder(monthKeys: Set<string>, hasUnmapped: boolean): string[] {
  const sorted = Array.from(monthKeys).sort();
  if (sorted.length === 0) return hasUnmapped ? ['unmapped'] : [];

  const years = [...new Set(sorted.map(k => k.split('-')[0]))].sort();
  const columns: string[] = [];

  for (const year of years) {
    const yearMonths = sorted.filter(k => k.startsWith(year + '-'));
    columns.push(...yearMonths);
    if (year === years[years.length - 1] && hasUnmapped) {
      columns.push('unmapped');
    }
    columns.push(`${year}-total`);
  }

  if (hasUnmapped && !columns.includes('unmapped')) {
    columns.push('unmapped');
  }

  return columns;
}

function buildColumnLabels(columnKeys: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const key of columnKeys) {
    if (key === 'unmapped') {
      labels[key] = 'Unmapped';
    } else if (key.endsWith('-total')) {
      labels[key] = `${key.split('-')[0]} Total`;
    } else {
      labels[key] = monthKeyToLabel(key);
    }
  }
  return labels;
}

interface AccountingLineItemRow {
  invoice_id: number;
  vendor: string;
  invoice_number: string;
  invoice_date: string | null;
  net_invoice_amount: number;
  gross_invoice_amount: number;
  currency: string;
  booking_date: Date | string | null;
  li_net_amount: number;
}

async function getAccountingData(
  query: { dateFrom?: string; dateTo?: string; vendor?: string },
  _reqLog: { info: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void }
): Promise<AccountingViewResponse> {
  const pgPool = getPgPool()!;
  const { dateFrom, dateTo, vendor } = query;

  // PostgreSQL: Use dedicated columns and $N placeholders
  const conditions: string[] = [
    'e.has_line_items = true',
    "e.status != 'rejected'",
    CREDIT_NOTE_EXCLUSION,
  ];
  const params: (string | null)[] = [];
  let paramIndex = 1;

  if (dateFrom) {
    conditions.push(`COALESCE(e.invoice_date, e.created_at::date) >= $${paramIndex++}`);
    params.push(dateFrom);
  }

  if (dateTo) {
    conditions.push(`COALESCE(e.invoice_date, e.created_at::date) <= $${paramIndex++}`);
    params.push(dateTo);
  }

  if (vendor) {
    conditions.push(`COALESCE(NULLIF(e.vendor, ''), 'Unknown') = $${paramIndex++}`);
    params.push(vendor);
  }

  const whereClause = conditions.join(' AND ');

  // PostgreSQL: Use dedicated columns, invoice_id FK, booking_date column
  const sql = `
    SELECT
      e.id AS invoice_id,
      COALESCE(NULLIF(e.vendor, ''), 'Unknown') AS vendor,
      COALESCE(e.invoice_number, e.account_number, '') AS invoice_number,
      e.invoice_date::text AS invoice_date,
      COALESCE(e.net_amount, 0) AS net_invoice_amount,
      COALESCE(e.gross_amount, 0) AS gross_invoice_amount,
      COALESCE(e.currency, 'EUR') AS currency,
      li.booking_date AS booking_date,
      COALESCE(li.net_amount, 0) AS li_net_amount
    FROM invoice_extractions e
    INNER JOIN invoice_line_items li ON li.invoice_id = e.id
    WHERE ${whereClause}
    ORDER BY vendor ASC, e.id ASC, li.booking_date ASC
  `;

  const result = await pgPool.query(sql, params);
  const typedRows = result.rows as AccountingLineItemRow[];

  const invoiceMap = new Map<number, {
    vendor: string;
    invoiceNumber: string;
    invoiceDate: string | null;
    netInvoiceAmount: number;
    grossInvoiceAmount: number;
    currency: string;
    buckets: Map<string, { shipmentCount: number; netAmount: number }>;
  }>();

  const allMonthKeys = new Set<string>();
  let hasUnmapped = false;

  for (const row of typedRows) {
    if (!invoiceMap.has(row.invoice_id)) {
      invoiceMap.set(row.invoice_id, {
        vendor: row.vendor,
        invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date && row.invoice_date !== 'null' ? row.invoice_date : null,
        netInvoiceAmount: toNumber(row.net_invoice_amount),
        grossInvoiceAmount: toNumber(row.gross_invoice_amount),
        currency: row.currency,
        buckets: new Map(),
      });
    }

    const inv = invoiceMap.get(row.invoice_id)!;
    let monthKey: string;

    if (row.booking_date) {
      const d = row.booking_date instanceof Date
        ? row.booking_date
        : new Date(row.booking_date);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        monthKey = `${year}-${month}`;
        allMonthKeys.add(monthKey);
      } else {
        monthKey = 'unmapped';
        hasUnmapped = true;
      }
    } else {
      monthKey = 'unmapped';
      hasUnmapped = true;
    }

    const bucket = inv.buckets.get(monthKey) || { shipmentCount: 0, netAmount: 0 };
    bucket.shipmentCount += 1;
    bucket.netAmount += toNumber(row.li_net_amount);
    inv.buckets.set(monthKey, bucket);
  }

  const columnKeys = buildColumnOrder(allMonthKeys, hasUnmapped);
  const columnLabels = buildColumnLabels(columnKeys);

  function computeYearTotals(buckets: Map<string, { shipmentCount: number; netAmount: number }>): Map<string, { shipmentCount: number; netAmount: number }> {
    const yearTotals = new Map<string, { shipmentCount: number; netAmount: number }>();
    for (const [key, val] of buckets) {
      if (key === 'unmapped' || key.endsWith('-total')) continue;
      const year = key.split('-')[0];
      const totalKey = `${year}-total`;
      const existing = yearTotals.get(totalKey) || { shipmentCount: 0, netAmount: 0 };
      existing.shipmentCount += val.shipmentCount;
      existing.netAmount += val.netAmount;
      yearTotals.set(totalKey, existing);
    }
    return yearTotals;
  }

  const vendorGroupMap = new Map<string, AccountingInvoiceRow[]>();

  for (const [invoiceId, inv] of invoiceMap) {
    const yearTotals = computeYearTotals(inv.buckets);
    for (const [key, val] of yearTotals) {
      inv.buckets.set(key, val);
    }

    const months: AccountingMonthBucket[] = [];
    let totalShipmentCount = 0;
    let totalNetAmount = 0;

    for (const key of columnKeys) {
      const bucket = inv.buckets.get(key);
      if (bucket) {
        months.push({
          key,
          label: columnLabels[key],
          shipmentCount: bucket.shipmentCount,
          netAmount: Math.round(bucket.netAmount * 100) / 100,
        });
        if (!key.endsWith('-total')) {
          totalShipmentCount += bucket.shipmentCount;
          totalNetAmount += bucket.netAmount;
        }
      }
    }

    const row: AccountingInvoiceRow = {
      invoiceId,
      vendor: inv.vendor,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      netInvoiceAmount: inv.netInvoiceAmount,
      grossInvoiceAmount: inv.grossInvoiceAmount,
      currency: inv.currency,
      months,
      totalShipmentCount,
      totalNetAmount: Math.round(totalNetAmount * 100) / 100,
    };

    const existing = vendorGroupMap.get(inv.vendor) || [];
    existing.push(row);
    vendorGroupMap.set(inv.vendor, existing);
  }

  const vendors: AccountingVendorGroup[] = [];
  const grandBuckets = new Map<string, { shipmentCount: number; netAmount: number }>();
  let grandTotalShipmentCount = 0;
  let grandTotalNetAmount = 0;

  for (const [vendorName, invoices] of vendorGroupMap) {
    const vendorBuckets = new Map<string, { shipmentCount: number; netAmount: number }>();

    for (const inv of invoices) {
      for (const bucket of inv.months) {
        const existing = vendorBuckets.get(bucket.key) || { shipmentCount: 0, netAmount: 0 };
        existing.shipmentCount += bucket.shipmentCount;
        existing.netAmount += bucket.netAmount;
        vendorBuckets.set(bucket.key, existing);
      }
    }

    const monthTotals: AccountingMonthBucket[] = columnKeys
      .filter(key => vendorBuckets.has(key))
      .map(key => {
        const b = vendorBuckets.get(key)!;
        return {
          key,
          label: columnLabels[key],
          shipmentCount: b.shipmentCount,
          netAmount: Math.round(b.netAmount * 100) / 100,
        };
      });

    let vendorShipmentCount = 0;
    let vendorNetAmount = 0;
    for (const [key, val] of vendorBuckets) {
      if (!key.endsWith('-total')) {
        vendorShipmentCount += val.shipmentCount;
        vendorNetAmount += val.netAmount;
      }
      const grand = grandBuckets.get(key) || { shipmentCount: 0, netAmount: 0 };
      grand.shipmentCount += val.shipmentCount;
      grand.netAmount += val.netAmount;
      grandBuckets.set(key, grand);
    }

    vendors.push({
      vendor: vendorName,
      invoices,
      monthTotals,
      totalShipmentCount: vendorShipmentCount,
      totalNetAmount: Math.round(vendorNetAmount * 100) / 100,
    });

    grandTotalShipmentCount += vendorShipmentCount;
    grandTotalNetAmount += vendorNetAmount;
  }

  vendors.sort((a, b) => a.vendor.localeCompare(b.vendor));

  const grandTotals: AccountingMonthBucket[] = columnKeys
    .filter(key => grandBuckets.has(key))
    .map(key => {
      const b = grandBuckets.get(key)!;
      return {
        key,
        label: columnLabels[key],
        shipmentCount: b.shipmentCount,
        netAmount: Math.round(b.netAmount * 100) / 100,
      };
    });

  return {
    columnKeys,
    columnLabels,
    vendors,
    grandTotals,
    grandTotalShipmentCount,
    grandTotalNetAmount: Math.round(grandTotalNetAmount * 100) / 100,
  };
}

/**
 * GET /api/invoice-ocr/accounting
 * Consolidated monthly accounting view - line-item invoices grouped by booking month
 */
router.get('/accounting', async (req: Request, res: Response): Promise<void> => {
  try {
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const vendor = req.query.vendor as string | undefined;

    const data = await getAccountingData({ dateFrom, dateTo, vendor }, req.log);

    req.log.info(
      { dateFrom, dateTo, vendor, vendorCount: data.vendors.length },
      'Accounting view data fetched'
    );

    res.json(data);
  } catch (error) {
    req.log.error({ error }, 'Failed to fetch accounting data');
    res.status(500).json({
      error: 'Failed to fetch accounting data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/invoice-ocr/accounting/export
 * Export consolidated monthly accounting view as Excel file
 */
router.get('/accounting/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const vendor = req.query.vendor as string | undefined;

    const data = await getAccountingData({ dateFrom, dateTo, vendor }, req.log);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Monthly Accounting');

    const fixedHeaders = ['Carrier name', 'Invoice nr', 'Invoice date'];

    const row1Values: string[] = [...fixedHeaders];
    for (const key of data.columnKeys) {
      row1Values.push(data.columnLabels[key], '');
    }
    const headerRow1 = sheet.addRow(row1Values);
    headerRow1.font = { bold: true };
    headerRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    headerRow1.alignment = { horizontal: 'center' };

    for (let i = 0; i < data.columnKeys.length; i++) {
      const startCol = 4 + i * 2;
      sheet.mergeCells(1, startCol, 1, startCol + 1);
    }

    const row2Values: string[] = ['', '', ''];
    for (const key of data.columnKeys) {
      row2Values.push(`${data.columnLabels[key]} nr of shipments`, `${data.columnLabels[key]} Amount`);
    }
    const headerRow2 = sheet.addRow(row2Values);
    headerRow2.font = { bold: true, size: 9 };
    headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };

    for (const vendorGroup of data.vendors) {
      for (const inv of vendorGroup.invoices) {
        const rowValues: (string | number | null)[] = [
          inv.vendor,
          inv.invoiceNumber,
          inv.invoiceDate || '',
        ];

        for (const key of data.columnKeys) {
          const bucket = inv.months.find(m => m.key === key);
          rowValues.push(
            bucket?.shipmentCount || null,
            bucket?.netAmount || null,
          );
        }

        const dataRow = sheet.addRow(rowValues);

        for (let i = 0; i < data.columnKeys.length; i++) {
          const key = data.columnKeys[i];
          if (key.endsWith('-total')) {
            const countCol = 4 + i * 2;
            const amountCol = countCol + 1;
            dataRow.getCell(countCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
            dataRow.getCell(amountCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
          }
        }
      }

      const subtotalValues: (string | number | null)[] = [`${vendorGroup.vendor} Total`, '', ''];
      for (const key of data.columnKeys) {
        const bucket = vendorGroup.monthTotals.find(m => m.key === key);
        subtotalValues.push(
          bucket?.shipmentCount || null,
          bucket?.netAmount || null,
        );
      }
      const subtotalRow = sheet.addRow(subtotalValues);
      subtotalRow.font = { bold: true };
      subtotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
    }

    const grandValues: (string | number | null)[] = ['Total', '', ''];
    for (const key of data.columnKeys) {
      const bucket = data.grandTotals.find(m => m.key === key);
      grandValues.push(
        bucket?.shipmentCount || null,
        bucket?.netAmount || null,
      );
    }
    const totalRow = sheet.addRow(grandValues);
    totalRow.font = { bold: true, size: 12 };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };

    for (let i = 0; i < data.columnKeys.length; i++) {
      const amountCol = 5 + i * 2;
      sheet.getColumn(amountCol).numFmt = '#,##0.00';
    }

    sheet.getColumn(1).width = 18;
    sheet.getColumn(2).width = 22;
    sheet.getColumn(3).width = 14;
    for (let i = 0; i < data.columnKeys.length; i++) {
      sheet.getColumn(4 + i * 2).width = 14;
      sheet.getColumn(5 + i * 2).width = 14;
    }

    const safeDateFrom = (dateFrom || 'all').replace(/[^a-zA-Z0-9-]/g, '_');
    const safeDateTo = (dateTo || 'all').replace(/[^a-zA-Z0-9-]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="accounting_${safeDateFrom}_${safeDateTo}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();

    req.log.info(
      { dateFrom, dateTo, vendor, vendorCount: data.vendors.length },
      'Accounting Excel export generated'
    );
  } catch (error) {
    req.log.error({ error }, 'Failed to generate accounting export');
    res.status(500).json({
      error: 'Failed to generate accounting export',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/invoice-ocr/:id/reprocess-csv
 * Reprocess line items for an existing invoice using a CSV file
 * This allows fixing invoices that were uploaded without proper CSV parsing
 */
router.post(
  '/:id/reprocess-csv',
  multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        const path = process.env.RAILWAY_VOLUME_MOUNT_PATH
          ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/invoices`
          : (process.env.INVOICE_UPLOAD_PATH || '/tmp/uploads/invoices');
        if (!existsSync(path)) {
          await mkdir(path, { recursive: true });
        }
        cb(null, path);
      },
      filename: (_req, file, cb) => {
        const timestamp = Date.now();
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `reprocess-${timestamp}-${sanitizedName}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
        cb(null, true);
      } else {
        cb(new Error('Only CSV files are allowed'));
      }
    },
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  }).single('csv'),
  async (req: Request, res: Response): Promise<void> => {
    const invoiceId = parseInt(req.params.id, 10);
    const csvFile = req.file;
    const vendor = (req.body.vendor as string)?.toLowerCase() || '';

    if (isNaN(invoiceId)) {
      res.status(400).json({ error: 'Invalid invoice ID' });
      return;
    }

    if (!csvFile) {
      res.status(400).json({ error: 'CSV file is required' });
      return;
    }

    if (!vendor) {
      res.status(400).json({ error: 'Vendor is required (e.g., "ups", "dhl", "eurosender")' });
      return;
    }

    req.log.info(
      { invoiceId, vendor, csvFileName: csvFile.originalname },
      'Reprocessing invoice line items with CSV'
    );

    try {
      const pgPool = getPgPool()!;

      // Verify invoice exists
      const invoiceResult = await pgPool.query(
        'SELECT id, invoice_number, vendor FROM invoice_extractions WHERE id = $1',
        [invoiceId]
      );

      if (invoiceResult.rows.length === 0) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }

      const invoiceNumber = invoiceResult.rows[0].invoice_number;
      const invoiceVendor = invoiceResult.rows[0].vendor;

      // Parse CSV based on vendor
      let lineItems: OCRLineItem[] = [];

      if (vendor === 'ups' || vendor.includes('ups')) {
        lineItems = await parseUPSCSV(csvFile.path);
        req.log.info({ count: lineItems.length }, 'Parsed UPS CSV');
      } else if (vendor === 'dhl' || vendor.includes('dhl')) {
        lineItems = await parseDHLCSV(csvFile.path);
        req.log.info({ count: lineItems.length }, 'Parsed DHL CSV');
      } else if (vendor === 'eurosender' || vendor.includes('eurosender')) {
        lineItems = await parseEurosenderCSV(csvFile.path);
        req.log.info({ count: lineItems.length }, 'Parsed Eurosender CSV');
      } else {
        res.status(400).json({
          error: `Unsupported vendor: ${vendor}`,
          supportedVendors: ['ups', 'dhl', 'eurosender'],
        });
        return;
      }

      if (lineItems.length === 0) {
        res.status(400).json({ error: 'No line items found in CSV' });
        return;
      }

      // PostgreSQL: Start transaction with client
      const client = await pgPool.connect();

      try {
        await client.query('BEGIN');

        // Delete existing line items (PostgreSQL: invoice_id column)
        await client.query(
          'DELETE FROM invoice_line_items WHERE invoice_id = $1',
          [invoiceId]
        );

        req.log.info({ invoiceId }, 'Deleted existing line items');

        // Insert new line items (PostgreSQL schema with vendor_raw_data JSONB)
        const insertQuery = `
          INSERT INTO invoice_line_items (
            invoice_id,
            vendor,
            invoice_number,
            shipment_number,
            shipment_date,
            booking_date,
            shipment_reference_1,
            shipment_reference_2,
            product_name,
            pieces,
            weight_kg,
            weight_flag,
            origin_country,
            origin_city,
            origin_postal_code,
            destination_country,
            destination_city,
            destination_postal_code,
            net_amount,
            gross_amount,
            base_price,
            total_tax,
            total_surcharges,
            vendor_raw_data,
            extraction_source
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
        `;

        for (const item of lineItems) {
          // Store extra charges in vendor_raw_data JSONB
          const vendorRawData = {
            total_surcharges_tax: item.total_surcharges_tax,
            xc1_code: item.xc1_code, xc1_name: item.xc1_name, xc1_charge: item.xc1_charge,
            xc2_code: item.xc2_code, xc2_name: item.xc2_name, xc2_charge: item.xc2_charge,
            xc3_code: item.xc3_code, xc3_name: item.xc3_name, xc3_charge: item.xc3_charge,
            xc4_code: item.xc4_code, xc4_name: item.xc4_name, xc4_charge: item.xc4_charge,
            xc5_code: item.xc5_code, xc5_name: item.xc5_name, xc5_charge: item.xc5_charge,
            xc6_code: item.xc6_code, xc6_name: item.xc6_name, xc6_charge: item.xc6_charge,
            xc7_code: item.xc7_code, xc7_name: item.xc7_name, xc7_charge: item.xc7_charge,
            xc8_code: item.xc8_code, xc8_name: item.xc8_name, xc8_charge: item.xc8_charge,
            xc9_code: item.xc9_code, xc9_name: item.xc9_name, xc9_charge: item.xc9_charge,
          };

          await client.query(insertQuery, [
            invoiceId,
            invoiceVendor || vendor.toUpperCase(),
            invoiceNumber,
            item.shipment_number || null,
            item.shipment_date || null,
            item.booking_date || null,
            item.shipment_reference_1 || null,
            item.shipment_reference_2 || null,
            item.product_name || null,
            item.pieces || null,
            item.weight_kg || null,
            item.weight_flag || null,
            item.origin_country || null,
            item.origin_city || null,
            item.origin_postal_code || null,
            item.destination_country || null,
            item.destination_city || null,
            item.destination_postal_code || null,
            item.net_amount || null,
            item.gross_amount || null,
            item.base_price || null,
            item.total_tax || null,
            item.total_surcharges || null,
            JSON.stringify(vendorRawData),
            'csv_parser',
          ]);
        }

        // Update invoice to mark it has line items
        await client.query(
          'UPDATE invoice_extractions SET has_line_items = true, line_items_source = $1, updated_at = NOW() WHERE id = $2',
          ['csv_parser', invoiceId]
        );

        await client.query('COMMIT');

        req.log.info(
          { invoiceId, lineItemCount: lineItems.length, vendor },
          'Successfully reprocessed invoice line items'
        );

        res.json({
          success: true,
          message: `Reprocessed ${lineItems.length} line items for invoice ${invoiceId}`,
          lineItemCount: lineItems.length,
          vendor,
        });
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }
    } catch (error) {
      req.log.error({ error, invoiceId }, 'Failed to reprocess invoice line items');
      res.status(500).json({
        error: 'Failed to reprocess line items',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default router;
