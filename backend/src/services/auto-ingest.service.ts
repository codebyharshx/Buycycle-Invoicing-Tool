/**
 * Auto-Ingest Orchestration Service
 *
 * Coordinates the automated invoice ingestion workflow:
 * 1. Fetch files from IMAP/SFTP sources
 * 2. Check for duplicates
 * 3. Save files and trigger OCR extraction
 * 4. Log all operations to invoice_data_source_logs
 */

import path from 'path';
import fs from 'fs/promises';
import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';
import {
  checkForDuplicate,
  calculateFileHash,
} from './duplicate-detector.service';
import {
  fetchNewEmails,
  FetchedEmail,
  ImapConfig,
  getImapConfigFromEnv,
} from './email-fetcher.service';
import {
  fetchNewFiles,
  FetchedFile,
  SftpConfig,
  getSftpConfigFromEnv,
  moveToArchive,
} from './sftp-fetcher.service';
import {
  createDataSourceLog,
  updateDataSourceStats,
  getDataSourceById,
} from './invoice-data-sources.service';
import { extractWithMultipleModels } from './invoice-ocr';
import { InvoiceDataSourceEventType, InvoiceDataSourceLogStatus } from '@shared/types';

// Temporary upload directory
const UPLOAD_DIR = process.env.INVOICE_UPLOAD_DIR || '/tmp/invoice-uploads';

export interface IngestResult {
  success: boolean;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
  extractionIds: number[];
}

export interface ProcessedFile {
  filename: string;
  extractionId?: number;
  status: 'success' | 'duplicate' | 'failed';
  error?: string;
}

/**
 * Ensure upload directory exists
 */
async function ensureUploadDir(): Promise<void> {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    logger.error({ error, dir: UPLOAD_DIR }, 'Failed to create upload directory');
  }
}

/**
 * Save file content to local filesystem
 */
async function saveFileLocally(
  filename: string,
  content: Buffer
): Promise<{ localPath: string; fileHash: string }> {
  await ensureUploadDir();

  const fileHash = calculateFileHash(content);
  const timestamp = Date.now();
  const safeFilename = `${timestamp}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const localPath = path.join(UPLOAD_DIR, safeFilename);

  await fs.writeFile(localPath, content);

  return { localPath, fileHash };
}

/**
 * Get file MIME type from extension
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.csv': 'text/csv',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Process a single file through the extraction pipeline
 */
async function processFile(
  dataSourceId: number,
  filename: string,
  content: Buffer,
  sourceIdentifier: string,
  metadata: {
    fromEmail?: string;
    subject?: string;
    vendor?: string;
  }
): Promise<ProcessedFile> {
  const pool = getPgPool();
  if (!pool) {
    return {
      filename,
      status: 'failed',
      error: 'PostgreSQL not available',
    };
  }

  const logBase = {
    data_source_id: dataSourceId,
    from_email: metadata.fromEmail,
    subject: metadata.subject,
    file_name: filename,
    file_size: content.length,
    file_type: getMimeType(filename),
  };

  try {
    // Calculate file hash
    const fileHash = calculateFileHash(content);

    // Check for duplicates
    const duplicateCheck = await checkForDuplicate({
      fileHash,
      dataSourceId,
      sourceIdentifier,
    });

    if (duplicateCheck.isDuplicate) {
      logger.info(
        { filename, reason: duplicateCheck.reason, existingId: duplicateCheck.existingId },
        'Skipping duplicate file'
      );

      await createDataSourceLog({
        ...logBase,
        event_type: 'processing_completed' as InvoiceDataSourceEventType,
        status: 'skipped' as InvoiceDataSourceLogStatus,
        error_message: `Duplicate detected: ${duplicateCheck.reason}`,
        invoice_extraction_id: duplicateCheck.existingId,
      });

      return {
        filename,
        status: 'duplicate',
        error: `Duplicate: ${duplicateCheck.reason}`,
      };
    }

    // Save file locally
    const { localPath } = await saveFileLocally(filename, content);

    // Log processing started
    await createDataSourceLog({
      ...logBase,
      event_type: 'processing_started' as InvoiceDataSourceEventType,
      status: 'processing' as InvoiceDataSourceLogStatus,
      file_path: localPath,
    });

    // Insert into invoice_files
    const client = await pool.connect();
    let fileId: number;
    let extractionId: number;

    try {
      await client.query('BEGIN');

      // Insert file record with hash
      const fileInsertResult = await client.query(
        `INSERT INTO invoice_files (
          file_type,
          file_name,
          file_size,
          mime_type,
          local_path,
          file_hash,
          source,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          path.extname(filename).slice(1) || 'unknown',
          filename,
          content.length,
          getMimeType(filename),
          localPath,
          fileHash,
          'auto_ingest',
          'processing',
        ]
      );

      fileId = fileInsertResult.rows[0].id;

      // Run OCR extraction
      const extraction = await extractWithMultipleModels(localPath, {
        geminiApiKey: process.env.GEMINI_API_KEY,
        mistralApiKey: process.env.MISTRAL_API_KEY,
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
      });

      // Determine vendor
      const vendor = metadata.vendor || extraction.analysis?.consensus?.vendor || 'Unknown';

      // Extract models used from raw_results keys
      const modelsUsed = extraction.raw_results ? Object.keys(extraction.raw_results) : [];

      // Insert extraction record
      const extractionResult = await client.query(
        `INSERT INTO invoice_extractions (
          file_id,
          invoice_number,
          vendor,
          document_type,
          net_amount,
          gross_amount,
          models_used,
          confidence_score,
          consensus_data,
          conflicts_data,
          raw_results,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id`,
        [
          fileId,
          extraction.analysis?.consensus?.invoice_number || null,
          vendor,
          extraction.analysis?.consensus?.document_type || 'shipping_invoice',
          extraction.analysis?.consensus?.net_amount || null,
          extraction.analysis?.consensus?.gross_amount || null,
          JSON.stringify(modelsUsed),
          extraction.analysis?.confidence_score || 0,
          JSON.stringify(extraction.analysis?.consensus || {}),
          JSON.stringify(extraction.analysis?.conflicts || []),
          JSON.stringify(extraction.raw_results || {}),
          'review', // Auto-ingested invoices go to review
        ]
      );

      extractionId = extractionResult.rows[0].id;

      // Update file status
      await client.query(
        `UPDATE invoice_files SET status = 'completed', invoice_id = $1 WHERE id = $2`,
        [extractionId, fileId]
      );

      await client.query('COMMIT');

      // Log success
      await createDataSourceLog({
        ...logBase,
        event_type: 'processing_completed' as InvoiceDataSourceEventType,
        status: 'success' as InvoiceDataSourceLogStatus,
        file_path: localPath,
        invoice_extraction_id: extractionId,
      });

      // Update data source stats
      await updateDataSourceStats(dataSourceId, {
        incrementEmails: true,
        incrementInvoices: true,
        updateLastReceived: true,
      });

      logger.info(
        { filename, extractionId, vendor },
        'Successfully processed invoice file'
      );

      return {
        filename,
        extractionId,
        status: 'success',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, filename }, 'Failed to process file');

    await createDataSourceLog({
      ...logBase,
      event_type: 'processing_failed' as InvoiceDataSourceEventType,
      status: 'failed' as InvoiceDataSourceLogStatus,
      error_message: errorMessage,
    });

    return {
      filename,
      status: 'failed',
      error: errorMessage,
    };
  }
}

/**
 * Process emails from IMAP data source
 */
export async function processImapDataSource(
  dataSourceId: number,
  config: ImapConfig
): Promise<IngestResult> {
  const result: IngestResult = {
    success: true,
    processedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
    extractionIds: [],
  };

  try {
    // Fetch data source info
    const dataSource = await getDataSourceById(dataSourceId);
    if (!dataSource) {
      throw new Error(`Data source ${dataSourceId} not found`);
    }

    logger.info(
      { dataSourceId, name: dataSource.name },
      'Starting IMAP data source processing'
    );

    // Fetch new emails
    const fetchResult = await fetchNewEmails(config, {
      limit: 50, // Process max 50 emails per run
      markAsSeen: true,
    });

    if (!fetchResult.success) {
      throw new Error(fetchResult.error || 'Failed to fetch emails');
    }

    // Process each email's attachments
    for (const email of fetchResult.emails) {
      for (const attachment of email.attachments) {
        const fileResult = await processFile(
          dataSourceId,
          attachment.filename,
          attachment.content,
          email.messageId,
          {
            fromEmail: email.from,
            subject: email.subject,
            vendor: dataSource.vendor_hint || undefined,
          }
        );

        if (fileResult.status === 'success') {
          result.processedCount++;
          if (fileResult.extractionId) {
            result.extractionIds.push(fileResult.extractionId);
          }
        } else if (fileResult.status === 'duplicate') {
          result.skippedCount++;
        } else {
          result.failedCount++;
          if (fileResult.error) {
            result.errors.push(`${attachment.filename}: ${fileResult.error}`);
          }
        }
      }
    }

    logger.info(
      {
        dataSourceId,
        processed: result.processedCount,
        skipped: result.skippedCount,
        failed: result.failedCount,
      },
      'IMAP data source processing completed'
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, dataSourceId }, 'IMAP data source processing failed');

    result.success = false;
    result.errors.push(errorMessage);
    return result;
  }
}

/**
 * Process files from SFTP data source
 */
export async function processSftpDataSource(
  dataSourceId: number,
  config: SftpConfig
): Promise<IngestResult> {
  const result: IngestResult = {
    success: true,
    processedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
    extractionIds: [],
  };

  try {
    // Fetch data source info
    const dataSource = await getDataSourceById(dataSourceId);
    if (!dataSource) {
      throw new Error(`Data source ${dataSourceId} not found`);
    }

    logger.info(
      { dataSourceId, name: dataSource.name, path: config.remotePath },
      'Starting SFTP data source processing'
    );

    // Fetch new files
    const fetchResult = await fetchNewFiles(config, {
      limit: 50, // Process max 50 files per run
    });

    if (!fetchResult.success) {
      throw new Error(fetchResult.error || 'Failed to fetch SFTP files');
    }

    // Process each file
    for (const file of fetchResult.files) {
      const fileResult = await processFile(
        dataSourceId,
        file.filename,
        file.content,
        file.remotePath,
        {
          vendor: dataSource.vendor_hint || undefined,
        }
      );

      if (fileResult.status === 'success') {
        result.processedCount++;
        if (fileResult.extractionId) {
          result.extractionIds.push(fileResult.extractionId);
        }

        // Move processed file to archive
        if (config.archivePath) {
          await moveToArchive(config, file.remotePath);
        }
      } else if (fileResult.status === 'duplicate') {
        result.skippedCount++;
      } else {
        result.failedCount++;
        if (fileResult.error) {
          result.errors.push(`${file.filename}: ${fileResult.error}`);
        }
      }
    }

    logger.info(
      {
        dataSourceId,
        processed: result.processedCount,
        skipped: result.skippedCount,
        failed: result.failedCount,
      },
      'SFTP data source processing completed'
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, dataSourceId }, 'SFTP data source processing failed');

    result.success = false;
    result.errors.push(errorMessage);
    return result;
  }
}

/**
 * Process the default IMAP source from environment variables
 */
export async function processDefaultImapSource(): Promise<IngestResult | null> {
  const config = getImapConfigFromEnv();
  if (!config) {
    logger.debug('No IMAP configuration found in environment');
    return null;
  }

  // Use dataSourceId 0 for default env-based source
  return processImapDataSource(0, config);
}

/**
 * Process the default SFTP source from environment variables
 */
export async function processDefaultSftpSource(): Promise<IngestResult | null> {
  const config = getSftpConfigFromEnv();
  if (!config) {
    logger.debug('No SFTP configuration found in environment');
    return null;
  }

  // Use dataSourceId 0 for default env-based source
  return processSftpDataSource(0, config);
}

/**
 * Manual trigger to process a specific data source
 */
export async function triggerDataSourceFetch(
  dataSourceId: number,
  connectionType: 'imap' | 'sftp',
  config: ImapConfig | SftpConfig
): Promise<IngestResult> {
  if (connectionType === 'imap') {
    return processImapDataSource(dataSourceId, config as ImapConfig);
  } else {
    return processSftpDataSource(dataSourceId, config as SftpConfig);
  }
}
