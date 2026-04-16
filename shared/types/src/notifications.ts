/**
 * Notification Types
 *
 * Shared types for the notification system covering:
 * - Invoice assignment notifications
 * - @mention notifications in comments
 */

/**
 * Type of notification
 */
export type NotificationType = 'assignment' | 'mention';

/**
 * Entity types that can have notifications
 */
export type NotificationEntityType = 'invoice' | 'thread';

/**
 * Notification record
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
 * Response for listing notifications
 */
export interface NotificationsResponse {
  success: boolean;
  notifications: Notification[];
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
}

/**
 * Response for notification count
 */
export interface NotificationCountResponse {
  success: boolean;
  count: number;
}

/**
 * Response for marking notifications as read
 */
export interface MarkReadResponse {
  success: boolean;
  message: string;
  count?: number;
}
