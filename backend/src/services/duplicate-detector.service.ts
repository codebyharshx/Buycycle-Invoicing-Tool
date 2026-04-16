/**
 * Duplicate Detector Service
 *
 * Multi-layer duplicate detection for invoice files:
 * - Layer 1: SHA-256 file hash check against invoice_files.file_hash
 * - Layer 2: Source identifier check (email message-id, SFTP filepath) in invoice_data_source_logs
 * - Layer 3: Post-extraction invoice_number check against invoice_extractions
 */

import crypto from 'crypto';
import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: 'file_hash' | 'source_identifier' | 'invoice_number';
  existingId?: number;
  existingInvoiceNumber?: string;
}

/**
 * Calculate SHA-256 hash of file content
 */
export function calculateFileHash(fileBuffer: Buffer): string {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Layer 1: Check if file hash already exists in invoice_files table
 */
export async function isFileHashDuplicate(fileHash: string): Promise<DuplicateCheckResult> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not available for duplicate check');
    return { isDuplicate: false };
  }

  try {
    const result = await pool.query(
      `SELECT id, invoice_id FROM invoice_files WHERE file_hash = $1 LIMIT 1`,
      [fileHash]
    );

    if (result.rows.length > 0) {
      logger.info(
        { fileHash, existingFileId: result.rows[0].id },
        'Duplicate file detected by hash'
      );
      return {
        isDuplicate: true,
        reason: 'file_hash',
        existingId: result.rows[0].invoice_id || result.rows[0].id,
      };
    }

    return { isDuplicate: false };
  } catch (error) {
    logger.error({ error, fileHash }, 'Error checking file hash duplicate');
    return { isDuplicate: false };
  }
}

/**
 * Layer 2: Check if source identifier (email message-id or SFTP filepath) already processed
 */
export async function isSourceIdentifierDuplicate(
  dataSourceId: number,
  sourceIdentifier: string
): Promise<DuplicateCheckResult> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not available for source identifier check');
    return { isDuplicate: false };
  }

  try {
    // Check invoice_data_source_logs for this source identifier
    // Use subject field for email message-id, file_path for SFTP paths
    const result = await pool.query(
      `SELECT id, invoice_extraction_id
       FROM invoice_data_source_logs
       WHERE data_source_id = $1
         AND (subject = $2 OR file_path = $2)
         AND status IN ('success', 'processing')
       LIMIT 1`,
      [dataSourceId, sourceIdentifier]
    );

    if (result.rows.length > 0) {
      logger.info(
        { dataSourceId, sourceIdentifier, existingLogId: result.rows[0].id },
        'Duplicate source identifier detected'
      );
      return {
        isDuplicate: true,
        reason: 'source_identifier',
        existingId: result.rows[0].invoice_extraction_id,
      };
    }

    return { isDuplicate: false };
  } catch (error) {
    logger.error({ error, dataSourceId, sourceIdentifier }, 'Error checking source identifier duplicate');
    return { isDuplicate: false };
  }
}

/**
 * Layer 3: Check if invoice number already exists (post-extraction check)
 */
export async function isInvoiceNumberDuplicate(
  invoiceNumber: string,
  vendor?: string
): Promise<DuplicateCheckResult> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not available for invoice number check');
    return { isDuplicate: false };
  }

  if (!invoiceNumber || invoiceNumber.trim() === '') {
    return { isDuplicate: false };
  }

  try {
    // Check for exact invoice number match, optionally filtered by vendor
    let query = `
      SELECT id, invoice_number, vendor
      FROM invoice_extractions
      WHERE LOWER(invoice_number) = LOWER($1)
    `;
    const params: (string | undefined)[] = [invoiceNumber.trim()];

    if (vendor) {
      query += ` AND LOWER(vendor) = LOWER($2)`;
      params.push(vendor);
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

    if (result.rows.length > 0) {
      logger.info(
        { invoiceNumber, vendor, existingInvoiceId: result.rows[0].id },
        'Duplicate invoice number detected'
      );
      return {
        isDuplicate: true,
        reason: 'invoice_number',
        existingId: result.rows[0].id,
        existingInvoiceNumber: result.rows[0].invoice_number,
      };
    }

    return { isDuplicate: false };
  } catch (error) {
    logger.error({ error, invoiceNumber, vendor }, 'Error checking invoice number duplicate');
    return { isDuplicate: false };
  }
}

/**
 * Combined duplicate check - runs all layers
 * Returns on first duplicate found (short-circuit evaluation)
 */
export async function checkForDuplicate(options: {
  fileBuffer?: Buffer;
  fileHash?: string;
  dataSourceId?: number;
  sourceIdentifier?: string;
  invoiceNumber?: string;
  vendor?: string;
}): Promise<DuplicateCheckResult> {
  // Layer 1: File hash check
  if (options.fileBuffer || options.fileHash) {
    const hash = options.fileHash || calculateFileHash(options.fileBuffer!);
    const hashResult = await isFileHashDuplicate(hash);
    if (hashResult.isDuplicate) {
      return hashResult;
    }
  }

  // Layer 2: Source identifier check
  if (options.dataSourceId && options.sourceIdentifier) {
    const sourceResult = await isSourceIdentifierDuplicate(
      options.dataSourceId,
      options.sourceIdentifier
    );
    if (sourceResult.isDuplicate) {
      return sourceResult;
    }
  }

  // Layer 3: Invoice number check (usually done post-extraction)
  if (options.invoiceNumber) {
    const invoiceResult = await isInvoiceNumberDuplicate(
      options.invoiceNumber,
      options.vendor
    );
    if (invoiceResult.isDuplicate) {
      return invoiceResult;
    }
  }

  return { isDuplicate: false };
}

/**
 * Add file_hash column to invoice_files table if it doesn't exist
 * Call this during server startup
 */
export async function ensureFileHashColumn(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not available - skipping file_hash column check');
    return;
  }

  try {
    // Check if column exists
    const columnCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'invoice_files' AND column_name = 'file_hash'
    `);

    if (columnCheck.rows.length === 0) {
      // Add column
      await pool.query(`
        ALTER TABLE invoice_files
        ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64)
      `);

      // Create index for fast lookups
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_invoice_files_file_hash
        ON invoice_files(file_hash)
      `);

      logger.info('Added file_hash column to invoice_files table');
    }
  } catch (error) {
    logger.error({ error }, 'Error ensuring file_hash column exists');
  }
}

/**
 * Add source_identifier column to invoice_data_source_logs table if needed
 */
export async function ensureSourceIdentifierColumn(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not available - skipping source_identifier column check');
    return;
  }

  try {
    // Check if source_identifier column exists
    const columnCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'invoice_data_source_logs' AND column_name = 'source_identifier'
    `);

    if (columnCheck.rows.length === 0) {
      // Add column for unique source identifiers (email message-id, SFTP path)
      await pool.query(`
        ALTER TABLE invoice_data_source_logs
        ADD COLUMN IF NOT EXISTS source_identifier VARCHAR(512)
      `);

      // Create index
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_data_source_logs_source_identifier
        ON invoice_data_source_logs(data_source_id, source_identifier)
      `);

      logger.info('Added source_identifier column to invoice_data_source_logs table');
    }
  } catch (error) {
    logger.error({ error }, 'Error ensuring source_identifier column exists');
  }
}

/**
 * Initialize duplicate detection tables/columns
 */
export async function initDuplicateDetection(): Promise<void> {
  await ensureFileHashColumn();
  await ensureSourceIdentifierColumn();
  logger.info('Duplicate detection tables initialized');
}
