/**
 * Webhook Routes
 *
 * External API endpoints for n8n and other integrations.
 * Uses API key authentication instead of JWT.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { extractWithMultipleModels, extractInvoiceData } from '../services/invoice-ocr';
import { normalizeVendorName } from '../services/invoice-ocr/vendor-mappings';
import { normalizeDocumentType } from '../services/invoice-ocr/utils';
import { isDPDInvoice, extractDPDLineItems } from '../services/invoice-ocr/extractors/dpd-line-items';
import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';
import { requireApiKey } from '../middleware/api-key';
import { OCRLineItem } from '@shared/types';

const router = Router();

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
  if (ALLOWED_FILE_TYPES.includes(file.mimetype as typeof ALLOWED_FILE_TYPES[number])) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PDF, PNG, JPG, CSV, XLSX.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxFileSize },
});

/**
 * POST /api/webhooks/invoice-upload
 *
 * Upload and extract invoice data via API key authentication.
 * Designed for n8n and external integrations.
 *
 * Headers:
 *   X-API-Key: <your-api-key>
 *
 * Body (multipart/form-data):
 *   - invoice: File (PDF, PNG, JPG)
 *   - vendor: (optional) Vendor hint for better extraction
 *   - notes: (optional) Notes to attach to the invoice
 *
 * Response:
 *   - id: Invoice ID
 *   - invoice_number: Extracted invoice number
 *   - vendor: Detected/normalized vendor
 *   - net_amount: Net amount
 *   - gross_amount: Gross amount
 *   - confidence_score: Extraction confidence
 */
router.post(
  '/invoice-upload',
  upload.single('invoice'),
  async (req: Request, res: Response): Promise<void> => {
    const pgPool = getPgPool();

    if (!pgPool) {
      res.status(503).json({
        error: 'Database unavailable',
        message: 'PostgreSQL database is required for invoice storage.',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided', message: 'Upload a file with field name "invoice"' });
      return;
    }

    const { vendor: vendorHint, notes } = req.body;

    logger.info({
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      source: 'n8n',
    }, 'n8n invoice upload started');

    try {
      // Get API keys
      const mistralApiKey = process.env.MISTRAL_API_KEY;
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      const replicateApiKey = process.env.REPLICATE_API_KEY;

      if (!mistralApiKey && !geminiApiKey && !openRouterApiKey && !replicateApiKey) {
        res.status(500).json({ error: 'No OCR API keys configured' });
        return;
      }

      const models = ['deepseek', 'mistral', 'gemini'];
      const isMRWInvoice = /_bb\d+/i.test(file.originalname || '');

      // Run extraction
      let extraction;
      if (isMRWInvoice) {
        extraction = await extractInvoiceData(file.path, {
          mistralApiKey,
          geminiApiKey,
          openRouterApiKey,
          replicateApiKey,
          models,
        });
      } else {
        extraction = await extractWithMultipleModels(file.path, {
          mistralApiKey,
          geminiApiKey,
          openRouterApiKey,
          replicateApiKey,
          models,
        });
      }

      // Normalize vendor
      const extractedVendor = (extraction.analysis.consensus.vendor as string) || vendorHint || '';
      const standardizedVendor = normalizeVendorName(extractedVendor);
      extraction.analysis.consensus.vendor = standardizedVendor;

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

      // Extract line items for specific vendors
      let lineItemsFromOCR: OCRLineItem[] = [];
      const vendorLower = standardizedVendor.toLowerCase();
      const isEurosender = vendorLower.includes('eurosender');

      if (isMRWInvoice || isEurosender) {
        lineItemsFromOCR = (extraction.analysis.consensus.line_items as OCRLineItem[]) || [];
      } else {
        const isDPD = await isDPDInvoice(file.path);
        if (isDPD) {
          try {
            lineItemsFromOCR = await extractDPDLineItems(file.path, invoiceNumber || '');
          } catch (e) {
            logger.error({ error: e }, 'Failed to extract DPD line items');
          }
        }
      }

      const hasLineItems = lineItemsFromOCR.length > 0;

      // Save to database (using same pattern as auto-ingest.service.ts)
      const client = await pgPool.connect();
      let insertResult: { insertId: number; fileId: number };

      try {
        await client.query('BEGIN');

        // Step 1: Insert file record first (same as auto-ingest)
        const fileResult = await client.query(
          `INSERT INTO invoice_files (
            file_type, file_name, file_size, mime_type, local_path, source, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id`,
          ['pdf', file.originalname, file.size, file.mimetype, file.path, 'api', 'completed']
        );
        const fileId = fileResult.rows[0].id;

        // Step 2: Insert extraction record with file_id (same columns as auto-ingest)
        const extractionResult = await client.query(
          `INSERT INTO invoice_extractions (
            file_id, invoice_number, vendor, document_type,
            net_amount, gross_amount, models_used, confidence_score,
            consensus_data, conflicts_data, raw_results, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id`,
          [
            fileId,
            invoiceNumber,
            standardizedVendor,
            normalizedDocumentType,
            extraction.analysis.consensus.net_amount || null,
            extraction.analysis.consensus.gross_amount || null,
            JSON.stringify(models),
            extraction.analysis.confidence_score,
            JSON.stringify(extraction.analysis.consensus),
            JSON.stringify(extraction.analysis.conflicts),
            JSON.stringify(extraction.raw_results),
            'review',
          ]
        );
        const invoiceId = extractionResult.rows[0].id;

        await client.query('COMMIT');
        insertResult = { insertId: invoiceId, fileId };
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

      // Save line items if any
      if (hasLineItems && lineItemsFromOCR.length > 0) {
        for (const item of lineItemsFromOCR) {
          await pgPool.query(
            `INSERT INTO invoice_line_items (
              invoice_id, vendor, invoice_number, shipment_number, shipment_date,
              shipment_reference_1, shipment_reference_2, product_name, pieces, weight_kg,
              origin_country, origin_city, destination_country, destination_city,
              net_amount, gross_amount, extraction_source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              insertResult.insertId,
              standardizedVendor,
              invoiceNumber,
              item.shipment_number || null,
              item.shipment_date || null,
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
              'n8n_upload',
            ]
          );
        }
      }

      logger.info({
        invoiceId: insertResult.insertId,
        invoiceNumber,
        vendor: standardizedVendor,
        source: 'n8n',
      }, 'n8n invoice upload completed');

      res.status(201).json({
        success: true,
        id: insertResult.insertId,
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
        line_items_count: lineItemsFromOCR.length,
        models_used: models,
        parent_invoice_id: parentInvoiceId,
      });
    } catch (error) {
      logger.error({ error, fileName: file.originalname }, 'n8n invoice upload failed');
      res.status(500).json({
        error: 'Extraction failed',
        message: error instanceof Error ? error.message : 'Unknown error',
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
