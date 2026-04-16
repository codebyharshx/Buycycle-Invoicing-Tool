/**
 * Notification Service
 *
 * Handles creating, fetching, and managing notifications for:
 * - Invoice assignments
 * - @mentions in comments
 */

import { getPgPool } from '../utils/db';
import logger from '../utils/logger';

/**
 * Notification types
 */
export type NotificationType = 'assignment' | 'mention';

/**
 * Entity types that can have notifications
 */
export type NotificationEntityType = 'invoice' | 'thread';

/**
 * Notification record from database
 */
export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  entity_type: NotificationEntityType;
  entity_id: number;
  title: string;
  message: string;
  actor_id: number | null;
  actor_name: string | null;
  is_read: boolean;
  created_at: string;
  // Joined fields for display
  invoice_number?: string;
  vendor?: string;
}

/**
 * Initialize the notifications table
 */
export async function initNotificationsTable(): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        actor_id INTEGER,
        actor_name VARCHAR(255),
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT fk_notification_user
          FOREIGN KEY (user_id)
          REFERENCES invoice_users(id)
          ON DELETE CASCADE
      )
    `);

    // Create indexes for efficient queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
      ON invoice_notifications (user_id, is_read, created_at DESC)
      WHERE is_read = false
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_all
      ON invoice_notifications (user_id, created_at DESC)
    `);

    logger.info('Notifications table initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize notifications table');
  }
}

/**
 * Create a notification
 */
export async function createNotification(params: {
  userId: number;
  type: NotificationType;
  entityType: NotificationEntityType;
  entityId: number;
  title: string;
  message?: string;
  actorId?: number;
  actorName?: string;
}): Promise<Notification | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  try {
    const result = await pool.query(
      `INSERT INTO invoice_notifications
       (user_id, type, entity_type, entity_id, title, message, actor_id, actor_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        params.userId,
        params.type,
        params.entityType,
        params.entityId,
        params.title,
        params.message || null,
        params.actorId || null,
        params.actorName || null,
      ]
    );

    logger.info(
      { userId: params.userId, type: params.type, entityId: params.entityId },
      'Notification created'
    );

    return result.rows[0] as Notification;
  } catch (error) {
    logger.error({ error, params }, 'Failed to create notification');
    return null;
  }
}

/**
 * Create assignment notification
 */
export async function createAssignmentNotification(params: {
  assigneeId: number;
  invoiceId: number;
  invoiceNumber: string;
  vendor: string;
  assignedById: number;
  assignedByName: string;
}): Promise<Notification | null> {
  // Don't notify if assigning to yourself
  if (params.assigneeId === params.assignedById) {
    return null;
  }

  return createNotification({
    userId: params.assigneeId,
    type: 'assignment',
    entityType: 'invoice',
    entityId: params.invoiceId,
    title: 'Invoice Assigned',
    message: `${params.assignedByName} assigned you to invoice ${params.invoiceNumber} (${params.vendor})`,
    actorId: params.assignedById,
    actorName: params.assignedByName,
  });
}

/**
 * Create mention notifications for all mentioned users
 */
export async function createMentionNotifications(params: {
  mentionedUserIds: number[];
  threadId: number;
  invoiceId: number;
  invoiceNumber: string;
  vendor: string;
  authorId: number;
  authorName: string;
  contentPreview: string;
}): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;

  // Filter out self-mentions
  const userIds = params.mentionedUserIds.filter(id => id !== params.authorId);

  if (userIds.length === 0) return;

  const truncatedContent = params.contentPreview.length > 100
    ? params.contentPreview.substring(0, 100) + '...'
    : params.contentPreview;

  for (const userId of userIds) {
    await createNotification({
      userId,
      type: 'mention',
      entityType: 'invoice', // Link to invoice, not thread, for easier navigation
      entityId: params.invoiceId,
      title: 'Mentioned in Comment',
      message: `${params.authorName} mentioned you on invoice ${params.invoiceNumber}: "${truncatedContent}"`,
      actorId: params.authorId,
      actorName: params.authorName,
    });
  }

  logger.info(
    { invoiceId: params.invoiceId, mentionedCount: userIds.length },
    'Mention notifications created'
  );
}

/**
 * Get notifications for a user
 */
export async function getNotifications(
  userId: number,
  options: {
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  } = {}
): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const { limit = 50, offset = 0, unreadOnly = false } = options;

  // Get notifications with invoice info
  const result = await pool.query(
    `SELECT
       n.*,
       ie.invoice_number,
       ie.consensus_data->>'vendor' as vendor
     FROM invoice_notifications n
     LEFT JOIN invoice_extractions ie ON n.entity_type = 'invoice' AND n.entity_id = ie.id
     WHERE n.user_id = $1 ${unreadOnly ? 'AND n.is_read = false' : ''}
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM invoice_notifications WHERE user_id = $1 ${unreadOnly ? 'AND is_read = false' : ''}`,
    [userId]
  );

  // Get unread count
  const unreadResult = await pool.query(
    `SELECT COUNT(*) as unread FROM invoice_notifications WHERE user_id = $1 AND is_read = false`,
    [userId]
  );

  return {
    notifications: result.rows.map(row => ({
      ...row,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    })) as Notification[],
    total: parseInt(countResult.rows[0].total, 10),
    unreadCount: parseInt(unreadResult.rows[0].unread, 10),
  };
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: number): Promise<number> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    `SELECT COUNT(*) as count FROM invoice_notifications WHERE user_id = $1 AND is_read = false`,
    [userId]
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: number, userId: number): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    `UPDATE invoice_notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );

  return (result.rowCount || 0) > 0;
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: number): Promise<number> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    `UPDATE invoice_notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId]
  );

  logger.info({ userId, count: result.rowCount }, 'Marked all notifications as read');

  return result.rowCount || 0;
}

/**
 * Delete old notifications (cleanup job)
 */
export async function deleteOldNotifications(daysOld: number = 30): Promise<number> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    `DELETE FROM invoice_notifications
     WHERE created_at < NOW() - INTERVAL '1 day' * $1 AND is_read = true`,
    [daysOld]
  );

  if ((result.rowCount || 0) > 0) {
    logger.info({ count: result.rowCount, daysOld }, 'Deleted old notifications');
  }

  return result.rowCount || 0;
}
