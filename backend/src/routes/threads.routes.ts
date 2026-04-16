/**
 * Threads/Comments Routes
 * Manage comments/notes on invoices with @mentions support
 */

import express, { Request, Response } from 'express';
import { getPgPool } from '../utils/db';
import { logger } from '../utils/logger';
import type { ThreadWithReplies, CreateThreadRequest, UpdateThreadRequest } from '@shared/types';
import { createMentionNotifications } from '../services/notification.service';

const router = express.Router();

/**
 * Parse @mentions from content
 * Supports formats:
 *   - @[userId] - e.g., @[123]
 *   - @username - e.g., @john (looks up by name)
 * Returns array of user IDs
 */
async function parseMentions(content: string): Promise<number[]> {
  const mentionedIds: number[] = [];

  // Match @[123] format (direct user ID)
  const idMatches = content.match(/@\[(\d+)\]/g);
  if (idMatches) {
    for (const match of idMatches) {
      const id = parseInt(match.replace(/@\[|\]/g, ''), 10);
      if (!isNaN(id) && !mentionedIds.includes(id)) {
        mentionedIds.push(id);
      }
    }
  }

  // Match @username format (lookup by name - case insensitive)
  const nameMatches = content.match(/@(\w+)/g);
  if (nameMatches) {
    const names = nameMatches.map(m => m.slice(1).toLowerCase());
    const uniqueNames = [...new Set(names)];

    if (uniqueNames.length > 0) {
      try {
        const placeholders = uniqueNames.map((_, i) => `LOWER(name) LIKE $${i + 1}`).join(' OR ');
        const result = await getPgPool()!.query(
          `SELECT id FROM invoice_users WHERE ${placeholders} AND is_active = true`,
          uniqueNames.map(n => `%${n}%`)
        );

        for (const row of result.rows) {
          if (!mentionedIds.includes(row.id)) {
            mentionedIds.push(row.id);
          }
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to lookup mentioned users by name');
      }
    }
  }

  return mentionedIds;
}

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
        mentioned_user_ids INTEGER[] DEFAULT '{}',
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

    // Add mentioned_user_ids column if it doesn't exist (for existing tables)
    await getPgPool()!.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoice_threads' AND column_name = 'mentioned_user_ids'
        ) THEN
          ALTER TABLE invoice_threads ADD COLUMN mentioned_user_ids INTEGER[] DEFAULT '{}';
        END IF;
      END $$;
    `);

    // Remove old mentioned_users column if it exists (cleanup)
    await getPgPool()!.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoice_threads' AND column_name = 'mentioned_users'
        ) THEN
          ALTER TABLE invoice_threads DROP COLUMN mentioned_users;
        END IF;
      END $$;
    `);

    // Create GIN index for efficient @> (contains) queries on mentioned_user_ids
    await getPgPool()!.query(`
      CREATE INDEX IF NOT EXISTS idx_invoice_threads_mentions
      ON invoice_threads USING GIN (mentioned_user_ids)
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

    logger.info('Invoice threads table initialized with mentions support');
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
    mentioned_user_ids: (row.mentioned_user_ids as number[]) || [],
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
 * Create a new thread/comment with @mentions support
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

    // Parse @mentions from content
    const mentionedUserIds = await parseMentions(content);

    const result = await getPgPool()!.query(
      `INSERT INTO invoice_threads (entity_type, entity_id, content, author_id, author_name, mentioned_user_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [entity_type, Number(entity_id), content.trim(), author_id, author_name, mentionedUserIds]
    );

    const thread = mapRowToThread(result.rows[0]);

    // Create notifications for mentioned users
    if (mentionedUserIds.length > 0 && entity_type === 'invoice') {
      // Get invoice info for notification
      const invoiceResult = await getPgPool()!.query(
        `SELECT invoice_number, consensus_data->>'vendor' as vendor FROM invoice_extractions WHERE id = $1`,
        [Number(entity_id)]
      );

      if (invoiceResult.rows.length > 0) {
        const invoiceNumber = invoiceResult.rows[0].invoice_number || `#${entity_id}`;
        const vendor = invoiceResult.rows[0].vendor || 'Unknown';

        createMentionNotifications({
          mentionedUserIds,
          threadId: thread.id,
          invoiceId: Number(entity_id),
          invoiceNumber,
          vendor,
          authorId: author_id,
          authorName: author_name,
          contentPreview: content.trim(),
        }).catch(err => {
          logger.error({ error: err }, 'Failed to create mention notifications');
        });
      }
    }

    req.log.info({
      threadId: thread.id,
      entityType: entity_type,
      entityId: entity_id,
      mentionedUsers: mentionedUserIds.length,
    }, 'Thread created with mentions');

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
 * Update a thread/comment with @mentions support
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

    // Parse @mentions from updated content
    const mentionedUserIds = await parseMentions(content);

    const result = await getPgPool()!.query(
      `UPDATE invoice_threads
       SET content = $1, mentioned_user_ids = $2, updated_at = NOW(), is_edited = true
       WHERE id = $3
       RETURNING *`,
      [content.trim(), mentionedUserIds, threadId]
    );

    const thread = mapRowToThread(result.rows[0]);

    req.log.info({ threadId, mentionedUsers: mentionedUserIds.length }, 'Thread updated with mentions');

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

/**
 * GET /api/threads/mentions/:userId
 * Get all threads where a user is mentioned
 */
router.get('/mentions/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const { limit = 50, offset = 0 } = req.query;

    if (isNaN(userId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid user ID',
      });
      return;
    }

    // Find threads where the user is mentioned
    const result = await getPgPool()!.query(
      `SELECT t.*, ie.invoice_number, ie.consensus_data->>'vendor' as vendor
       FROM invoice_threads t
       LEFT JOIN invoice_extractions ie ON t.entity_id = ie.id
       WHERE $1 = ANY(t.mentioned_user_ids) AND t.is_deleted = false
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, Number(limit), Number(offset)]
    );

    // Count total mentions
    const countResult = await getPgPool()!.query(
      `SELECT COUNT(*) as total
       FROM invoice_threads
       WHERE $1 = ANY(mentioned_user_ids) AND is_deleted = false`,
      [userId]
    );

    const threads = result.rows.map((row) => ({
      ...mapRowToThread(row),
      invoice_number: row.invoice_number,
      vendor: row.vendor,
    }));

    res.json({
      success: true,
      threads,
      total: parseInt(countResult.rows[0].total, 10),
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    req.log.error({ error }, 'Error fetching mentions');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch mentions',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/threads/mentions/:userId/count
 * Get count of unread mentions for a user (for notification badge)
 */
router.get('/mentions/:userId/count', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);

    if (isNaN(userId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid user ID',
      });
      return;
    }

    const result = await getPgPool()!.query(
      `SELECT COUNT(*) as count
       FROM invoice_threads
       WHERE $1 = ANY(mentioned_user_ids) AND is_deleted = false`,
      [userId]
    );

    res.json({
      success: true,
      count: parseInt(result.rows[0].count, 10),
    });
  } catch (error) {
    req.log.error({ error }, 'Error counting mentions');
    res.status(500).json({
      success: false,
      error: 'Failed to count mentions',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/threads/users
 * Get list of users for @mention autocomplete
 */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT id, name, email, role
      FROM invoice_users
      WHERE is_active = true
    `;
    const params: string[] = [];

    if (search && typeof search === 'string' && search.length > 0) {
      query += ` AND (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)`;
      params.push(`%${search.toLowerCase()}%`);
    }

    query += ` ORDER BY name ASC LIMIT 20`;

    const result = await getPgPool()!.query(query, params);

    res.json({
      success: true,
      users: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
      })),
    });
  } catch (error) {
    req.log.error({ error }, 'Error fetching users for mentions');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
