/**
 * Notification Routes
 *
 * Handles notification management for assignments and mentions.
 */

import express, { Request, Response } from 'express';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  initNotificationsTable,
} from '../services/notification.service';

const router = express.Router();

// Initialize table on startup
initNotificationsTable();

/**
 * GET /api/notifications
 * Get notifications for the current user
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await getNotifications(userId, { limit, offset, unreadOnly });

    res.json({
      success: true,
      notifications: result.notifications,
      total: result.total,
      unreadCount: result.unreadCount,
      limit,
      offset,
    });
  } catch (error) {
    req.log.error({ error }, 'Error fetching notifications');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/notifications/count
 * Get unread notification count for the current user
 */
router.get('/count', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const count = await getUnreadCount(userId);

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    req.log.error({ error }, 'Error fetching notification count');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification count',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a notification as read
 */
router.post('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const notificationId = parseInt(req.params.id, 10);
    if (isNaN(notificationId)) {
      res.status(400).json({ success: false, error: 'Invalid notification ID' });
      return;
    }

    const success = await markAsRead(notificationId, userId);

    if (!success) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    req.log.error({ error }, 'Error marking notification as read');
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read for the current user
 */
router.post('/read-all', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const count = await markAllAsRead(userId);

    res.json({
      success: true,
      message: `Marked ${count} notifications as read`,
      count,
    });
  } catch (error) {
    req.log.error({ error }, 'Error marking all notifications as read');
    res.status(500).json({
      success: false,
      error: 'Failed to mark notifications as read',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
