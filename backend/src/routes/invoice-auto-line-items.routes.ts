import { Router, Request, Response } from 'express';
import multer from 'multer';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { extractWithMultipleModels } from '../services/invoice-ocr';
import { isDPDInvoice, extractDPDLineItems } from '../services/invoice-ocr/extractors/dpd-line-items';
import { normalizeVendorName } from '../services/invoice-ocr/vendor-mappings';
import { getPgPool } from '../utils/db';
import {
  InvoiceExtractionRequest,
  InvoiceExtractionResponse,
  InvoiceExtractionRecord,
  OCRLineItem,
} from '@shared/types';

const router = Router();

// Configure file upload (same as main invoice routes)
const uploadPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/invoices`
  : (process.env.INVOICE_UPLOAD_PATH || '/tmp/uploads/invoices');

const maxFileSize = parseInt(process.env.INVOICE_MAX_FILE_SIZE || '52428800', 10); // 50MB

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    if (!existsSync(uploadPath)) {
      await mkdir(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${sanitizedName}`);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF files are allowed.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxFileSize },
});

/**
 * Vendor-specific line item extractors registry
 * Allows easy addition of new vendors in the future
 */
interface VendorExtractor {
  name: string;
  detect: (filePath: string) => Promise<boolean>;
  extract: (filePath: string, invoiceNumber: string) => Promise<OCRLineItem[]>;
}

const VENDOR_EXTRACTORS: VendorExtractor[] = [
  {
    name: 'DPD',
    detect: isDPDInvoice,
    extract: extractDPDLineItems,
  },
  // Future vendors can be added here:
  // {
  //   name: 'DHL',
  //   detect: isDHLInvoice,
  //   extract: extractDHLLineItems,
  // },
];

/**
 * Transform PostgreSQL row to InvoiceExtractionRecord
 */
function transformDatabaseRow(row: Record<string, unknown>): InvoiceExtractionRecord {
  const consensusData = (row.consensus_data || {}) as Record<string, unknown>;

  // Build consensus_data with dedicated columns merged in
  const mergedConsensus: Record<string, string | number | string[]> = {
    ...(typeof consensusData === 'object' ? consensusData as Record<string, string | number | string[]> : {}),
  };

  // Merge dedicated columns into consensus (using new DB-aligned field names)
  if (row.vendor) mergedConsensus.vendor = row.vendor as string;
  if (row.net_amount) mergedConsensus.net_amount = row.net_amount as number;
  if (row.gross_amount) mergedConsensus.gross_amount = row.gross_amount as number;
  if (row.invoice_date) mergedConsensus.invoice_date = String(row.invoice_date);

  // Determine created_via with proper typing
  const createdViaValue = (row.created_via as string) || 'api';
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
    file_path: (row.file_path as string) || '',
    file_size: (row.file_size as number) || 0,
    models_used: row.models_used as string[] || [],
    confidence_score: parseFloat(String(row.confidence_score)) || 0,
    consensus_data: mergedConsensus,
    conflicts_data: row.conflicts_data as import('@shared/types').InvoiceExtractionRecord['conflicts_data'],
    missing_data: row.missing_data as import('@shared/types').InvoiceExtractionRecord['missing_data'],
    raw_results: (row.raw_results || {}) as import('@shared/types').InvoiceExtractionRecord['raw_results'],
    review_needed: row.review_needed as string[] | null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at as string),
    created_by: row.created_by as number | null,
    created_via: createdVia,
    notes: (row.notes as string) || null,
    status: status,
    has_line_items: Boolean(row.has_line_items),
    csv_file_path: (row.csv_file_path as string) || null,
    csv_file_name: (row.csv_file_name as string) || null,
    assigned_agent_id: (row.assigned_to as number) || null,
    payment_date: row.payment_date ? String(row.payment_date) : null,
    payment_status: (row.payment_status as import('@shared/types').InvoicePaymentStatus) || 'unpaid',
    payment_method: paymentMethod,
    approved_by: (row.approved_by as number) || null,
    approved_at: row.approved_at instanceof Date ? row.approved_at.toISOString() : (row.approved_at as string) || null,
    viewed_by: (row.viewed_by as number[]) || [],
  };
}

/**
 * POST /api/invoice-ocr/extract-auto-line-items
 *
 * Dedicated endpoint for invoices with auto-extractable line items (DPD, etc.)
 *
 * Flow:
 * 1. Upload PDF
 * 2. Auto-detect vendor (DPD, DHL, etc.)
 * 3. Extract line items from PDF structure
 * 4. Run OCR for header data (invoice #, totals, dates)
 * 5. Save invoice header + line items to database
 * 6. Return complete invoice with line items
 *
 * Use this endpoint for:
 * - DPD invoices (auto-extracts shipment table)
 * - Future logistics vendors with extractable line items
 *
 * Do NOT use for:
 * - Invoices without line items (use /extract)
 * - Invoices with pre-extracted CSV (use /extract-with-line-items)
 */
router.post(
  '/extract',
  upload.single('invoice'),
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    const body = req.body as Partial<Record<keyof InvoiceExtractionRequest, string | string[]>>;

    if (!file) {
      res.status(400).json({ error: 'No PDF file provided' });
      return;
    }

    const pgPool = getPgPool();
    if (!pgPool) {
      res.status(503).json({
        error: 'Database unavailable',
        details: 'PostgreSQL database is required for invoice storage.',
      });
      return;
    }

    req.log.info(
      {
        fileName: file.originalname,
        fileSize: file.size,
      },
      'Starting auto line items extraction'
    );

    try {
      // STEP 1: Detect vendor and check if line items extraction is supported
      req.log.info('Step 1: Detecting vendor for line items extraction');

      let detectedVendor: VendorExtractor | null = null;
      for (const vendor of VENDOR_EXTRACTORS) {
        const isMatch = await vendor.detect(file.path);
        if (isMatch) {
          detectedVendor = vendor;
          req.log.info({ vendorName: vendor.name }, 'Vendor detected');
          break;
        }
      }

      if (!detectedVendor) {
        req.log.warn('No supported vendor detected for auto line items extraction');
        res.status(400).json({
          error: 'Unsupported invoice type',
          message: 'This invoice does not match any supported vendor for automatic line items extraction (DPD, etc.)',
          supportedVendors: VENDOR_EXTRACTORS.map(v => v.name),
        });
        return;
      }

      // STEP 2: Run OCR extraction for header data
      req.log.info('Step 2: Running OCR for invoice header data');

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
          try {
            models = JSON.parse(body.models);
          } catch {
            models = body.models.split(',').map((m: string) => m.trim());
          }
        } else if (Array.isArray(body.models)) {
          models = body.models;
        }
      }
      models = models.slice(0, 3);

      const extraction = await extractWithMultipleModels(file.path, {
        mistralApiKey,
        geminiApiKey,
        openRouterApiKey,
        replicateApiKey,
        models,
      });

      const invoiceNumber = (extraction.analysis.consensus.invoice_number as string) || null;

      if (!invoiceNumber) {
        req.log.warn('Invoice number could not be extracted');
        if (!extraction.analysis.review_needed.includes('invoice_number')) {
          extraction.analysis.review_needed.push('invoice_number');
        }
      }

      // Normalize vendor name
      const standardizedVendor = normalizeVendorName(detectedVendor.name);

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

      // Extract parent invoice number for credit notes
      const parentInvoiceNumber = (extraction.analysis.consensus.parent_invoice_number as string) || null;
      let parentInvoiceId: number | null = null;

      // If this is a credit note and we have a parent invoice number, try to find the parent
      if (normalizedDocumentType === 'credit_note' && parentInvoiceNumber) {
        req.log.info(
          { parentInvoiceNumber, documentType: normalizedDocumentType },
          'Credit note detected (auto-line-items), looking up parent invoice'
        );

        const parentLookup = await pgPool.query(
          'SELECT id FROM invoice_extractions WHERE invoice_number = $1 LIMIT 1',
          [parentInvoiceNumber]
        );
        if (parentLookup.rows.length > 0) {
          parentInvoiceId = parentLookup.rows[0].id;
          req.log.info(
            { parentInvoiceNumber, parentInvoiceId },
            'Found parent invoice for credit note'
          );
        } else {
          req.log.warn(
            { parentInvoiceNumber },
            'Parent invoice not found in database - credit note will be saved without link'
          );
        }
      }

      // STEP 3: Extract line items from PDF using vendor-specific extractor
      req.log.info({ vendor: detectedVendor.name }, 'Step 3: Extracting line items from PDF');

      const lineItems = await detectedVendor.extract(file.path, invoiceNumber || '');

      if (lineItems.length === 0) {
        req.log.warn({ vendor: detectedVendor.name }, 'No line items extracted from PDF');
        res.status(400).json({
          error: 'Line items extraction failed',
          message: `No line items could be extracted from this ${detectedVendor.name} invoice. The PDF may not contain a valid shipments table.`,
        });
        return;
      }

      req.log.info(
        { vendor: detectedVendor.name, lineItemCount: lineItems.length },
        'Line items extracted successfully'
      );

      // STEP 4: Save invoice header + line items to database (PostgreSQL)
      req.log.info('Step 4: Saving invoice and line items to database');

      const client = await pgPool.connect();
      let invoiceExtractionId: number;

      try {
        await client.query('BEGIN');

        // Save invoice header (PostgreSQL with RETURNING)
        const insertQuery = `
          INSERT INTO invoice_extractions (
            file_name,
            invoice_number,
            file_path,
            file_size,
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
            created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING id
        `;

        const result = await client.query(insertQuery, [
          file.originalname,
          invoiceNumber,
          file.path,
          file.size,
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
          true, // has_line_items
          body.created_by || null,
        ]);

        invoiceExtractionId = result.rows[0].id;

        // Save line items (PostgreSQL schema with vendor_raw_data JSONB)
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

        await client.query('COMMIT');

        req.log.info(
          { invoiceId: invoiceExtractionId, lineItemsSaved: lineItems.length },
          'Invoice and line items saved successfully'
        );
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // STEP 5: Fetch and return complete invoice
      const fetchResult = await pgPool.query(
        'SELECT * FROM invoice_extractions WHERE id = $1',
        [invoiceExtractionId]
      );

      const record = transformDatabaseRow(fetchResult.rows[0]);

      const response: InvoiceExtractionResponse = {
        id: record.id,
        extraction,
        database_record: record,
      };

      req.log.info(
        {
          id: record.id,
          vendor: detectedVendor.name,
          lineItemCount: lineItems.length,
          confidenceScore: extraction.analysis.confidence_score,
        },
        'Auto line items extraction completed successfully'
      );

      res.status(201).json(response);
    } catch (error) {
      req.log.error({ error, fileName: file?.originalname }, 'Auto line items extraction failed');
      res.status(500).json({
        error: 'Failed to extract invoice with auto line items',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /api/invoice-ocr/auto-line-items/vendors
 * Returns list of supported vendors for auto line items extraction
 */
router.get('/vendors', (_req: Request, res: Response): void => {
  res.json({
    vendors: VENDOR_EXTRACTORS.map(v => v.name),
    count: VENDOR_EXTRACTORS.length,
  });
});

export default router;
