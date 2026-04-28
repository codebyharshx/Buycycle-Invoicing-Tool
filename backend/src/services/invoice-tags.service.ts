/**
 * Invoice Tags Service
 *
 * Manages tags/labels that can be applied to logistics invoices.
 * Uses PostgreSQL (same as invoice_extractions).
 */

import { getPgPool } from '../utils/db';
import {
  InvoiceTag,
  InvoiceTagAssignment,
  InvoiceTagRow,
  InvoiceTagAssignmentRow,
} from '@shared/types';
import logger from '../utils/logger';

/**
 * Maps database row to InvoiceTag interface
 */
function mapRowToTag(row: InvoiceTagRow): InvoiceTag {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

/**
 * Maps database row to InvoiceTagAssignment interface with joined tag data
 */
function mapRowToTagAssignment(row: InvoiceTagAssignmentRow): InvoiceTagAssignment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    tagId: row.tag_id,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
    tag: {
      id: row.tag_id,
      name: row.tag_name,
      description: row.tag_description,
      createdAt: row.tag_created_at,
      updatedAt: row.tag_updated_at,
      createdBy: row.tag_created_by,
    },
  };
}

/**
 * Ensure the invoice tags tables exist in PostgreSQL
 */
export async function initInvoiceTagsTables(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not configured, skipping invoice tags table init');
    return;
  }

  try {
    // Create invoice_tags table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(255)
      )
    `);

    // Create invoice_tag_assignments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_tag_assignments (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoice_extractions(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES invoice_tags(id) ON DELETE CASCADE,
        assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        assigned_by VARCHAR(255),
        UNIQUE(invoice_id, tag_id)
      )
    `);

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tag_assignments_invoice_id ON invoice_tag_assignments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag_id ON invoice_tag_assignments(tag_id);
    `);

    logger.info('Invoice tags tables initialized (PostgreSQL)');
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to initialize invoice tags tables');
    throw err;
  }
}

/**
 * Get all available tags
 */
export async function getAllTags(): Promise<InvoiceTag[]> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  const result = await pool.query<InvoiceTagRow>(
    'SELECT * FROM invoice_tags ORDER BY name ASC'
  );

  return result.rows.map(mapRowToTag);
}

/**
 * Get a specific tag by ID
 */
export async function getTagById(tagId: number): Promise<InvoiceTag | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  const result = await pool.query<InvoiceTagRow>(
    'SELECT * FROM invoice_tags WHERE id = $1',
    [tagId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToTag(result.rows[0]);
}

/**
 * Create a new tag
 */
export async function createTag(data: {
  name: string;
  description?: string;
  createdBy?: string;
}): Promise<InvoiceTag> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  try {
    const result = await pool.query<InvoiceTagRow>(
      `INSERT INTO invoice_tags (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.description || null, data.createdBy || null]
    );

    logger.info({ tagId: result.rows[0].id, name: data.name }, 'Invoice tag created');

    return mapRowToTag(result.rows[0]);
  } catch (err: unknown) {
    logger.error({ err, data }, 'Failed to create invoice tag');
    throw err;
  }
}

/**
 * Update a tag
 */
export async function updateTag(
  tagId: number,
  data: {
    name?: string;
    description?: string;
  }
): Promise<InvoiceTag> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  try {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }

    if (updates.length === 0) {
      const tag = await getTagById(tagId);
      if (!tag) {
        throw new Error(`Tag not found: ${tagId}`);
      }
      return tag;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(tagId);

    const result = await pool.query<InvoiceTagRow>(
      `UPDATE invoice_tags SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error(`Tag not found: ${tagId}`);
    }

    logger.info({ tagId, updates: Object.keys(data) }, 'Invoice tag updated');

    return mapRowToTag(result.rows[0]);
  } catch (err: unknown) {
    logger.error({ err, tagId, data }, 'Failed to update invoice tag');
    throw err;
  }
}

/**
 * Delete a tag
 * Note: This will also delete all assignments due to CASCADE
 */
export async function deleteTag(tagId: number): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  try {
    await pool.query('DELETE FROM invoice_tags WHERE id = $1', [tagId]);
    logger.info({ tagId }, 'Invoice tag deleted');
  } catch (err: unknown) {
    logger.error({ err, tagId }, 'Failed to delete invoice tag');
    throw err;
  }
}

/**
 * Get all tags assigned to a specific invoice
 */
export async function getTagsForInvoice(invoiceId: number): Promise<InvoiceTagAssignment[]> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  const result = await pool.query<InvoiceTagAssignmentRow>(
    `SELECT
      ta.id,
      ta.invoice_id,
      ta.tag_id,
      ta.assigned_at,
      ta.assigned_by,
      t.name as tag_name,
      t.description as tag_description,
      t.created_at as tag_created_at,
      t.updated_at as tag_updated_at,
      t.created_by as tag_created_by
    FROM invoice_tag_assignments ta
    JOIN invoice_tags t ON ta.tag_id = t.id
    WHERE ta.invoice_id = $1
    ORDER BY ta.assigned_at DESC`,
    [invoiceId]
  );

  return result.rows.map(mapRowToTagAssignment);
}

/**
 * Assign a tag to an invoice
 */
export async function assignTagToInvoice(
  invoiceId: number,
  tagId: number,
  assignedBy: string | null = null
): Promise<InvoiceTagAssignment> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  try {
    await pool.query(
      `INSERT INTO invoice_tag_assignments (invoice_id, tag_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (invoice_id, tag_id) DO UPDATE SET
         assigned_by = EXCLUDED.assigned_by,
         assigned_at = CURRENT_TIMESTAMP`,
      [invoiceId, tagId, assignedBy]
    );

    logger.info({ invoiceId, tagId, assignedBy }, 'Tag assigned to invoice');

    // Fetch and return the assignment
    const assignments = await getTagsForInvoice(invoiceId);
    const assignment = assignments.find((a) => a.tagId === tagId);

    if (!assignment) {
      throw new Error('Failed to fetch assignment after creation');
    }

    return assignment;
  } catch (err: unknown) {
    logger.error({ err, invoiceId, tagId }, 'Failed to assign tag to invoice');
    throw err;
  }
}

/**
 * Remove a tag from an invoice
 */
export async function removeTagFromInvoice(invoiceId: number, tagId: number): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  try {
    await pool.query(
      'DELETE FROM invoice_tag_assignments WHERE invoice_id = $1 AND tag_id = $2',
      [invoiceId, tagId]
    );
    logger.info({ invoiceId, tagId }, 'Tag removed from invoice');
  } catch (err: unknown) {
    logger.error({ err, invoiceId, tagId }, 'Failed to remove tag from invoice');
    throw err;
  }
}
