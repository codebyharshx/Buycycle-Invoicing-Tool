/**
 * Invoice Data Sources Service
 * Handles email-based invoice ingestion system for carriers
 * Uses PostgreSQL (Neon) for storage
 */

import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';
import {
  InvoiceDataSource,
  InvoiceDataSourceLog,
  InvoiceDataSourceStatus,
  InvoiceDataSourceEventType,
  InvoiceDataSourceLogStatus,
  InvoiceDataSourcesListResponse,
  InvoiceDataSourceLogsResponse,
  CreateInvoiceDataSourceRequest,
  UpdateInvoiceDataSourceRequest,
} from '@shared/types';

// ============================================================================
// Row Types
// ============================================================================

interface DataSourceRow {
  id: number;
  name: string;
  email_address: string;
  status: InvoiceDataSourceStatus;
  vendor_hint: string | null;
  auto_process: boolean;
  description: string | null;
  created_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_received_at: Date | string | null;
  total_emails_received: number;
  total_invoices_processed: number;
}

interface DataSourceLogRow {
  id: number;
  data_source_id: number;
  event_type: InvoiceDataSourceEventType;
  from_email: string | null;
  subject: string | null;
  received_at: Date | string;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  file_type: string | null;
  status: InvoiceDataSourceLogStatus;
  invoice_extraction_id: number | null;
  error_message: string | null;
  raw_headers: Record<string, string> | null;
  created_at: Date | string;
}

// ============================================================================
// Row Transformers
// ============================================================================

function toISOString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function transformDataSourceRow(row: DataSourceRow): InvoiceDataSource {
  return {
    id: row.id,
    name: row.name,
    email_address: row.email_address,
    status: row.status,
    vendor_hint: row.vendor_hint,
    auto_process: Boolean(row.auto_process),
    description: row.description,
    created_by: row.created_by,
    created_at: toISOString(row.created_at) as string,
    updated_at: toISOString(row.updated_at) as string,
    last_received_at: toISOString(row.last_received_at),
    total_emails_received: row.total_emails_received,
    total_invoices_processed: row.total_invoices_processed,
  };
}

function transformLogRow(row: DataSourceLogRow): InvoiceDataSourceLog {
  return {
    id: row.id,
    data_source_id: row.data_source_id,
    event_type: row.event_type,
    from_email: row.from_email,
    subject: row.subject,
    received_at: toISOString(row.received_at) as string,
    file_name: row.file_name,
    file_path: row.file_path,
    file_size: row.file_size,
    file_type: row.file_type,
    status: row.status,
    invoice_extraction_id: row.invoice_extraction_id,
    error_message: row.error_message,
    raw_headers: row.raw_headers,
    created_at: toISOString(row.created_at) as string,
  };
}

// ============================================================================
// Table Initialization
// ============================================================================

/**
 * Initialize invoice data sources tables in PostgreSQL
 * Should be called on server startup
 */
export async function initInvoiceDataSourcesTables(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not available - skipping invoice data sources table initialization');
    return;
  }

  try {
    // Create invoice_data_sources table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_data_sources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email_address VARCHAR(255) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        vendor_hint VARCHAR(100),
        auto_process BOOLEAN NOT NULL DEFAULT true,
        description TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_received_at TIMESTAMPTZ,
        total_emails_received INTEGER NOT NULL DEFAULT 0,
        total_invoices_processed INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT valid_status CHECK (status IN ('active', 'paused', 'archived'))
      )
    `);

    // Create invoice_data_source_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_data_source_logs (
        id SERIAL PRIMARY KEY,
        data_source_id INTEGER NOT NULL REFERENCES invoice_data_sources(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        from_email VARCHAR(255),
        subject VARCHAR(500),
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        file_name VARCHAR(255),
        file_path VARCHAR(500),
        file_size INTEGER,
        file_type VARCHAR(50),
        status VARCHAR(20) NOT NULL,
        invoice_extraction_id INTEGER,
        error_message TEXT,
        raw_headers JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Create indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_data_sources_email ON invoice_data_sources(email_address)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_data_sources_status ON invoice_data_sources(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_data_source_logs_data_source_id ON invoice_data_source_logs(data_source_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_data_source_logs_received_at ON invoice_data_source_logs(received_at DESC)`);

    logger.info('Invoice data sources tables initialized successfully (PostgreSQL)');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize invoice data sources tables');
    throw error;
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * List all data sources with optional search and pagination
 */
export async function listDataSources(options: {
  search?: string;
  status?: InvoiceDataSourceStatus;
  limit?: number;
  offset?: number;
}): Promise<InvoiceDataSourcesListResponse> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  const limit = Math.min(options.limit || 100, 500);
  const offset = options.offset || 0;

  // Build query
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (options.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(options.status);
  } else {
    // By default, exclude archived
    conditions.push(`status != $${paramIndex++}`);
    params.push('archived');
  }

  if (options.search) {
    conditions.push(`(name ILIKE $${paramIndex} OR email_address ILIKE $${paramIndex})`);
    params.push(`%${options.search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM invoice_data_sources ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Get data sources
  const dataResult = await pool.query<DataSourceRow>(
    `SELECT * FROM invoice_data_sources
     ${whereClause}
     ORDER BY name ASC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  const dataSources = dataResult.rows.map(transformDataSourceRow);

  return {
    dataSources,
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + dataSources.length < total,
    },
  };
}

/**
 * Get a single data source by ID
 */
export async function getDataSourceById(id: number): Promise<InvoiceDataSource | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  const result = await pool.query<DataSourceRow>(
    'SELECT * FROM invoice_data_sources WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return transformDataSourceRow(result.rows[0]);
}

/**
 * Get a data source by email address
 */
export async function getDataSourceByEmail(email: string): Promise<InvoiceDataSource | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  const result = await pool.query<DataSourceRow>(
    'SELECT * FROM invoice_data_sources WHERE email_address = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return transformDataSourceRow(result.rows[0]);
}

/**
 * Create a new data source
 */
export async function createDataSource(
  data: CreateInvoiceDataSourceRequest
): Promise<InvoiceDataSource> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  // Normalize email address
  const emailAddress = data.email_address.toLowerCase().trim();

  // Check for duplicate email
  const existing = await pool.query(
    'SELECT id FROM invoice_data_sources WHERE email_address = $1',
    [emailAddress]
  );

  if (existing.rows.length > 0) {
    throw new Error('A data source with this email address already exists');
  }

  const result = await pool.query<DataSourceRow>(
    `INSERT INTO invoice_data_sources
     (name, email_address, vendor_hint, auto_process, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.name.trim(),
      emailAddress,
      data.vendor_hint || null,
      data.auto_process !== false,
      data.description || null,
      data.created_by || null,
    ]
  );

  return transformDataSourceRow(result.rows[0]);
}

/**
 * Update a data source
 */
export async function updateDataSource(
  id: number,
  data: UpdateInvoiceDataSourceRequest
): Promise<InvoiceDataSource> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  // Check if exists
  const existing = await pool.query(
    'SELECT id FROM invoice_data_sources WHERE id = $1',
    [id]
  );

  if (existing.rows.length === 0) {
    throw new Error('Data source not found');
  }

  // Build dynamic update query
  const updates: string[] = [];
  const values: (string | boolean | null)[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name.trim());
  }

  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(data.status);
  }

  if (data.vendor_hint !== undefined) {
    updates.push(`vendor_hint = $${paramIndex++}`);
    values.push(data.vendor_hint);
  }

  if (data.auto_process !== undefined) {
    updates.push(`auto_process = $${paramIndex++}`);
    values.push(data.auto_process);
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(data.description);
  }

  if (updates.length === 0) {
    // No fields to update, just return existing
    const current = await getDataSourceById(id);
    if (!current) {
      throw new Error('Data source not found');
    }
    return current;
  }

  // Always update updated_at
  updates.push('updated_at = NOW()');

  const result = await pool.query<DataSourceRow>(
    `UPDATE invoice_data_sources SET ${updates.join(', ')} WHERE id = $${paramIndex++} RETURNING *`,
    [...values, id]
  );

  return transformDataSourceRow(result.rows[0]);
}

/**
 * Archive a data source (soft delete)
 */
export async function archiveDataSource(id: number): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  const existing = await pool.query(
    'SELECT id FROM invoice_data_sources WHERE id = $1 AND status != $2',
    [id, 'archived']
  );

  if (existing.rows.length === 0) {
    throw new Error('Data source not found or already archived');
  }

  await pool.query(
    `UPDATE invoice_data_sources SET status = 'archived', updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

// ============================================================================
// Log Operations
// ============================================================================

/**
 * Get logs for a data source
 */
export async function getDataSourceLogs(
  dataSourceId: number,
  options: {
    limit?: number;
    offset?: number;
  }
): Promise<InvoiceDataSourceLogsResponse> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  const limit = Math.min(options.limit || 50, 200);
  const offset = options.offset || 0;

  // Get total count
  const countResult = await pool.query(
    'SELECT COUNT(*) as total FROM invoice_data_source_logs WHERE data_source_id = $1',
    [dataSourceId]
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Get logs
  const result = await pool.query<DataSourceLogRow>(
    `SELECT * FROM invoice_data_source_logs
     WHERE data_source_id = $1
     ORDER BY received_at DESC
     LIMIT $2 OFFSET $3`,
    [dataSourceId, limit, offset]
  );

  const logs = result.rows.map(transformLogRow);

  return {
    logs,
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + logs.length < total,
    },
  };
}

/**
 * Create a log entry
 */
export async function createDataSourceLog(data: {
  data_source_id: number;
  event_type: InvoiceDataSourceEventType;
  from_email?: string;
  subject?: string;
  file_name?: string;
  file_path?: string;
  file_size?: number;
  file_type?: string;
  status: InvoiceDataSourceLogStatus;
  invoice_extraction_id?: number;
  error_message?: string;
  raw_headers?: Record<string, string>;
}): Promise<InvoiceDataSourceLog> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  const result = await pool.query<DataSourceLogRow>(
    `INSERT INTO invoice_data_source_logs
     (data_source_id, event_type, from_email, subject, file_name, file_path, file_size, file_type, status, invoice_extraction_id, error_message, raw_headers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      data.data_source_id,
      data.event_type,
      data.from_email || null,
      data.subject || null,
      data.file_name || null,
      data.file_path || null,
      data.file_size || null,
      data.file_type || null,
      data.status,
      data.invoice_extraction_id || null,
      data.error_message || null,
      data.raw_headers ? JSON.stringify(data.raw_headers) : null,
    ]
  );

  return transformLogRow(result.rows[0]);
}

/**
 * Update data source statistics after receiving an email
 */
export async function updateDataSourceStats(
  id: number,
  options: {
    incrementEmails?: boolean;
    incrementInvoices?: boolean;
    updateLastReceived?: boolean;
  }
): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL not available');
  }

  const updates: string[] = [];

  if (options.incrementEmails) {
    updates.push('total_emails_received = total_emails_received + 1');
  }

  if (options.incrementInvoices) {
    updates.push('total_invoices_processed = total_invoices_processed + 1');
  }

  if (options.updateLastReceived) {
    updates.push('last_received_at = NOW()');
  }

  if (updates.length === 0) {
    return;
  }

  updates.push('updated_at = NOW()');

  await pool.query(
    `UPDATE invoice_data_sources SET ${updates.join(', ')} WHERE id = $1`,
    [id]
  );
}
