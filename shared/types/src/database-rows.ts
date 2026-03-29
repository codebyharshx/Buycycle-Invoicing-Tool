/**
 * Database Row Types
 *
 * These types represent the raw rows returned by MySQL/PostgreSQL queries
 * before transformation to application types.
 *
 * Key differences from application types:
 * - DECIMAL columns come back as strings
 * - TINYINT(1) comes back as 0 | 1 (not boolean)
 * - JSON columns come back as strings (need JSON.parse)
 * - DATETIME comes back as Date objects
 *
 * Note: These interfaces are compatible with mysql2's RowDataPacket
 * but don't extend it to avoid requiring mysql2 as a dependency.
 * Use type assertions when needed: rows as InvoiceExtractionRow[]
 */

// =============================================================================
// Invoice OCR Row Types
// =============================================================================

/**
 * Raw database row for invoice_extractions table
 * JSON fields are strings that need parsing
 */
export interface InvoiceExtractionRow {
  id: number;
  file_name: string;
  invoice_number: string | null;
  file_path: string;
  file_size: number;
  models_used: string; // JSON string - needs JSON.parse to get string[]
  confidence_score: string; // DECIMAL comes as string
  consensus_data: string; // JSON string
  conflicts_data: string | null; // JSON string
  missing_data: string | null; // JSON string
  raw_results: string; // JSON string
  review_needed: string | null; // JSON string
  created_at: Date;
  created_by: number | null;
  created_via: 'api' | 'frontend';
  notes: string | null;
  status: 'pending' | 'approved' | 'on_hold' | 'rejected';
  has_line_items: number; // TINYINT(1)
  csv_file_path: string | null;
  csv_file_name: string | null;
}

// =============================================================================
// Case Tag Row Types
// =============================================================================

/**
 * Raw database row for support_case_tag_assignments table
 * with joined tag data
 */
export interface CaseTagAssignmentRow {
  // From support_case_tag_assignments
  id: number;
  case_id: number;
  tag_id: number;
  assigned_by_user_id: number | null;
  assigned_at: Date;
  is_auto_assigned: number; // TINYINT(1)

  // Joined from support_case_tags (prefixed with tag_)
  tag_name: string;
  tag_slug: string;
  tag_description: string | null;
  tag_color: string | null;
  tag_is_system_tag: number; // TINYINT(1)
  tag_auto_assign_conditions: string | null; // JSON string
  tag_created_at: Date;
  tag_updated_at: Date;
  tag_created_by_user_id: number | null;
}

// =============================================================================
// Conversation Row Types
// =============================================================================

/**
 * Raw database row for product_conversations table
 * with joined user and product data
 */
export interface ConversationRow {
  // From product_conversations
  id: number;
  product_id: number;
  buyer_id: number;
  seller_id: number;
  currency_id: number | null;
  product_booking_id: number | null;
  status: string;
  price: string | null; // DECIMAL comes as string
  sendbird_channel_url: string | null;
  is_approved: number; // TINYINT(1)
  is_from_next: number; // TINYINT(1)
  seller_muted: number | null; // TINYINT(1)
  buyer_muted: number | null; // TINYINT(1)
  seller_first_response: Date | null;
  seller_last_response: Date | null;
  buyer_last_response: Date | null;
  reserved_at: Date | null;
  accepted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  is_hidden: number; // TINYINT(1)

  // Joined from users (buyer)
  buyer_first_name: string;
  buyer_last_name: string;
  buyer_email: string;

  // Joined from users (seller)
  seller_first_name: string;
  seller_last_name: string;
  seller_email: string;

  // Joined from products
  product_name: string;
  product_type: string;
  product_status: string;

  // Optional: from subquery
  bad_messages_count?: number;
}

// Note: BuyerProtectionClaim/ClaimRow types are defined in claims-pipeline.ts
