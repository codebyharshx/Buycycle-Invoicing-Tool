/**
 * Threads/Comments Routes
 * Manage comments/notes on invoices
 */

import express, { Request, Response } from 'express';
import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';
import type { ThreadWithReplies, CreateThreadRequest, UpdateThreadRequest } from '@shared/types';

const router = express.Router();

/**
 * Initialize the threads table if it doesn't exist
 * Connected to invoice_extractions via foreign key
 */
async function initThreadsTable(): Promise<void> {
  try {
    // Create table with foreign key to invoice_extractions
    await getPgPool()!.query(`
      CREATE TABLE IF NOT EXISTS invoice_threads (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(50) NOT NULL DEFAULT 'invoice',
        entity_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        author_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_edited BOOLEAN DEFAULT FALSE,
        is_deleted BOOLEAN DEFAULT FALSE,
        CONSTRAINT fk_invoice_threads_invoice
          FOREIGN KEY (entity_id)
          REFERENCES invoice_extractions(id)
          ON DELETE CASCADE
      )
    `);

    // Create index for faster lookups
    await getPgPool()!.query(`
      CREATE INDEX IF NOT EXISTS idx_invoice_threads_entity
      ON invoice_threads (entity_type, entity_id)
      WHERE is_deleted = false
    `);

    // Add foreign key constraint if table already exists without it
    await getPgPool()!.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_invoice_threads_invoice'
          AND table_name = 'invoice_threads'
        ) THEN
          ALTER TABLE invoice_threads
          ADD CONSTRAINT fk_invoice_threads_invoice
          FOREIGN KEY (entity_id)
          REFERENCES invoice_extractions(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    logger.info('Invoice threads table initialized with foreign key to invoice_extractions');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize invoice threads table');
  }
}

// Initialize table on module load
initThreadsTable();

/**
 * Map database row to Thread interface
 */
function mapRowToThread(row: Record<string, unknown>): ThreadWithReplies {
  return {
    id: row.id as number,
    entity_type: row.entity_type as 'invoice',
    entity_id: row.entity_id as number,
    content: row.content as string,
    author_id: row.author_id as number,
    author_name: row.author_name as string,
    created_at: (row.created_at as Date)?.toISOString() || row.created_at as string,
    updated_at: (row.updated_at as Date)?.toISOString() || row.updated_at as string,
    is_edited: row.is_edited as boolean,
    is_deleted: row.is_deleted as boolean,
  };
}

/**
 * GET /api/threads
 * List threads for an entity
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id, sort = 'newest', limit = 50 } = req.query;

    if (!entity_type || !entity_id) {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameters: entity_type and entity_id',
      });
      return;
    }

    const orderBy = sort === 'oldest' ? 'ASC' : 'DESC';

    const result = await getPgPool()!.query(
      `SELECT * FROM invoice_threads
       WHERE entity_type = $1 AND entity_id = $2 AND is_deleted = false
       ORDER BY created_at ${orderBy}
       LIMIT $3`,
      [entity_type, Number(entity_id), Number(limit)]
    );

    const threads = result.rows.map(mapRowToThread);

    res.json({
      success: true,
      threads,
    });
  } catch (error) {
    req.log.error({ error }, 'Error listing threads');
    res.status(500).json({
      success: false,
      error: 'Failed to list threads',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/threads
 * Create a new thread/comment
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id, content } = req.body as CreateThreadRequest;
    const author_id = req.body.author_id as number;
    const author_name = req.body.author_name as string;

    if (!entity_type || !entity_id || !content) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: entity_type, entity_id, content',
      });
      return;
    }

    if (!author_id || !author_name) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: author_id, author_name',
      });
      return;
    }

    const result = await getPgPool()!.query(
      `INSERT INTO invoice_threads (entity_type, entity_id, content, author_id, author_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [entity_type, Number(entity_id), content.trim(), author_id, author_name]
    );

    const thread = mapRowToThread(result.rows[0]);

    req.log.info({ threadId: thread.id, entityType: entity_type, entityId: entity_id }, 'Thread created');

    res.status(201).json({
      success: true,
      data: thread,
    });
  } catch (error) {
    req.log.error({ error }, 'Error creating thread');
    res.status(500).json({
      success: false,
      error: 'Failed to create thread',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/threads/:id
 * Update a thread/comment
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const threadId = parseInt(req.params.id, 10);
    const { content } = req.body as UpdateThreadRequest;
    const author_id = req.body.author_id as number;

    if (isNaN(threadId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid thread ID',
      });
      return;
    }

    if (!content) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: content',
      });
      return;
    }

    // Verify ownership
    const existing = await getPgPool()!.query(
      'SELECT author_id FROM invoice_threads WHERE id = $1 AND is_deleted = false',
      [threadId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Thread not found',
      });
      return;
    }

    if (existing.rows[0].author_id !== author_id) {
      res.status(403).json({
        success: false,
        error: 'You can only edit your own comments',
      });
      return;
    }

    const result = await getPgPool()!.query(
      `UPDATE invoice_threads
       SET content = $1, updated_at = NOW(), is_edited = true
       WHERE id = $2
       RETURNING *`,
      [content.trim(), threadId]
    );

    const thread = mapRowToThread(result.rows[0]);

    req.log.info({ threadId }, 'Thread updated');

    res.json({
      success: true,
      data: thread,
    });
  } catch (error) {
    req.log.error({ error }, 'Error updating thread');
    res.status(500).json({
      success: false,
      error: 'Failed to update thread',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/threads/:id
 * Soft delete a thread/comment
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const threadId = parseInt(req.params.id, 10);
    const author_id = req.body.author_id as number || parseInt(req.query.author_id as string, 10);

    if (isNaN(threadId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid thread ID',
      });
      return;
    }

    // Verify ownership
    const existing = await getPgPool()!.query(
      'SELECT author_id FROM invoice_threads WHERE id = $1 AND is_deleted = false',
      [threadId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Thread not found',
      });
      return;
    }

    if (existing.rows[0].author_id !== author_id) {
      res.status(403).json({
        success: false,
        error: 'You can only delete your own comments',
      });
      return;
    }

    // Soft delete
    await getPgPool()!.query(
      `UPDATE invoice_threads SET is_deleted = true, updated_at = NOW() WHERE id = $1`,
      [threadId]
    );

    req.log.info({ threadId }, 'Thread deleted');

    res.json({
      success: true,
      message: 'Thread deleted successfully',
    });
  } catch (error) {
    req.log.error({ error }, 'Error deleting thread');
    res.status(500).json({
      success: false,
      error: 'Failed to delete thread',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
