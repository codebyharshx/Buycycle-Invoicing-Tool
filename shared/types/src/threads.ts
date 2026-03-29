/**
 * Thread/Comment Types for Invoice Notes
 *
 * The invoice_threads table is connected to invoice_extractions via foreign key:
 *   invoice_threads.entity_id → invoice_extractions.id (ON DELETE CASCADE)
 *
 * This allows multiple notes/comments per invoice with full audit trail.
 */

/**
 * Thread entity types - currently only 'invoice' is supported
 * Could be extended to 'vendor', 'line_item', etc.
 */
export type ThreadEntityType = 'invoice';

/**
 * A single thread/comment attached to an invoice
 */
export interface Thread {
  id: number;
  entity_type: ThreadEntityType;
  /** References invoice_extractions.id */
  entity_id: number;
  content: string;
  author_id: number;
  author_name: string;
  created_at: string;
  updated_at: string;
  is_edited: boolean;
  is_deleted: boolean;
}

/**
 * Thread with replies (for future nested comments support)
 */
export interface ThreadWithReplies extends Thread {
  replies?: Thread[];
}

/**
 * Create thread request
 */
export interface CreateThreadRequest {
  entity_type: ThreadEntityType;
  entity_id: number | string;
  content: string;
}

/**
 * Update thread request
 */
export interface UpdateThreadRequest {
  content: string;
}

/**
 * List threads response
 */
export interface ListThreadsResponse {
  success: boolean;
  threads: ThreadWithReplies[];
}
