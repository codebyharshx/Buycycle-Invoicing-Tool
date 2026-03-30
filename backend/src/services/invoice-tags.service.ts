/**
 * Invoice Tags Service
 *
 * Manages tags/labels that can be applied to logistics invoices.
 * Uses logsPool (buycycle_log database), same as case tags.
 */

import { RowDataPacket, ResultSetHeader, Pool } from 'mysql2/promise';
import { logsPool } from '../utils/db';
import {
  InvoiceTag,
  InvoiceTagAssignment,
  InvoiceTagRow,
  InvoiceTagAssignmentRow,
} from '@shared/types';
import logger from '../utils/logger';

/**
 * Get logsPool or throw if not configured
 */
function getLogsPool(): Pool {
  if (!logsPool) {
    throw new Error('MySQL logsPool is not configured');
  }
  return logsPool;
}

/** MySQL error shape — extends Error with errno for detecting e.g. read-only mode. */
interface MySQLError extends Error {
  errno: number;
}

interface InvoiceTagDBRow extends RowDataPacket, InvoiceTagRow {}

/**
 * Ensure the invoice tags tables exist
 */
export async function initInvoiceTagsTables(): Promise<void> {
  try {
    await getLogsPool().execute(`
      CREATE TABLE IF NOT EXISTS support_logistics_invoice_tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(255),
        UNIQUE KEY unique_tag_name (name)
      )
    `);

    await getLogsPool().execute(`
      CREATE TABLE IF NOT EXISTS support_logistics_invoice_tag_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_id INT NOT NULL,
        tag_id INT NOT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        assigned_by VARCHAR(255),
        UNIQUE KEY unique_invoice_tag (invoice_id, tag_id),
        FOREIGN KEY (tag_id) REFERENCES support_logistics_invoice_tags(id) ON DELETE CASCADE
      )
    `);

    logger.info('Invoice tags tables initialized');
  } catch (err: unknown) {
    const MYSQL_ER_OPTION_PREVENTS_STATEMENT = 1290; // --read-only mode
    const isReadOnly = err instanceof Error && 'errno' in err && (err as MySQLError).errno === MYSQL_ER_OPTION_PREVENTS_STATEMENT;
    if (isReadOnly) {
      logger.warn({ err }, 'Skipping invoice tags table init (database is read-only)');
    } else {
      logger.error({ err }, 'Failed to initialize invoice tags tables');
      throw err;
    }
  }
}

/**
 * Maps database row to InvoiceTag interface
 */
function mapRowToTag(row: InvoiceTagDBRow): InvoiceTag {
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
 * Get all available tags
 */
export async function getAllTags(): Promise<InvoiceTag[]> {
  const [rows] = await getLogsPool().execute<InvoiceTagDBRow[]>(
    'SELECT * FROM support_logistics_invoice_tags ORDER BY name ASC'
  );

  return rows.map(mapRowToTag);
}

/**
 * Get a specific tag by ID
 */
export async function getTagById(tagId: number): Promise<InvoiceTag | null> {
  const [rows] = await getLogsPool().execute<InvoiceTagDBRow[]>(
    'SELECT * FROM support_logistics_invoice_tags WHERE id = ?',
    [tagId]
  );

  if (rows.length === 0) {
    return null;
  }

  return mapRowToTag(rows[0]);
}

/**
 * Create a new tag
 */
export async function createTag(data: {
  name: string;
  description?: string;
  createdBy?: string;
}): Promise<InvoiceTag> {
  try {
    const [result] = await getLogsPool().execute<ResultSetHeader>(
      `INSERT INTO support_logistics_invoice_tags
        (name, description, created_by)
      VALUES (?, ?, ?)`,
      [
        data.name,
        data.description || null,
        data.createdBy || null,
      ]
    );

    const newTag = await getTagById(result.insertId);

    if (!newTag) {
      throw new Error('Failed to fetch tag after creation');
    }

    logger.info({ tagId: result.insertId, name: data.name }, 'Invoice tag created');

    return newTag;
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
  try {
    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }

    if (updates.length === 0) {
      const tag = await getTagById(tagId);
      if (!tag) {
        throw new Error(`Tag not found: ${tagId}`);
      }
      return tag;
    }

    values.push(tagId as unknown as string);

    await getLogsPool().execute(
      `UPDATE support_logistics_invoice_tags SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

    const updatedTag = await getTagById(tagId);

    if (!updatedTag) {
      throw new Error(`Tag not found after update: ${tagId}`);
    }

    logger.info({ tagId, updates: Object.keys(data) }, 'Invoice tag updated');

    return updatedTag;
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
  try {
    await getLogsPool().execute('DELETE FROM support_logistics_invoice_tags WHERE id = ?', [tagId]);

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
  const [rows] = await getLogsPool().execute(
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
    FROM support_logistics_invoice_tag_assignments ta
    JOIN support_logistics_invoice_tags t ON ta.tag_id = t.id
    WHERE ta.invoice_id = ?
    ORDER BY ta.assigned_at DESC`,
    [invoiceId]
  );

  return (rows as InvoiceTagAssignmentRow[]).map(mapRowToTagAssignment);
}

/**
 * Assign a tag to an invoice
 */
export async function assignTagToInvoice(
  invoiceId: number,
  tagId: number,
  assignedBy: string | null = null
): Promise<InvoiceTagAssignment> {
  try {
    await getLogsPool().execute<ResultSetHeader>(
      `INSERT INTO support_logistics_invoice_tag_assignments
        (invoice_id, tag_id, assigned_by)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        assigned_by = VALUES(assigned_by),
        assigned_at = CURRENT_TIMESTAMP`,
      [invoiceId, tagId, assignedBy]
    );

    logger.info({ invoiceId, tagId, assignedBy }, 'Tag assigned to invoice');

    // Fetch and return the assignment
    const assignments = await getTagsForInvoice(invoiceId);
    const assignment = assignments.find(a => a.tagId === tagId);

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
  try {
    await getLogsPool().execute(
      'DELETE FROM support_logistics_invoice_tag_assignments WHERE invoice_id = ? AND tag_id = ?',
      [invoiceId, tagId]
    );

    logger.info({ invoiceId, tagId }, 'Tag removed from invoice');
  } catch (err: unknown) {
    logger.error({ err, invoiceId, tagId }, 'Failed to remove tag from invoice');
    throw err;
  }
}
