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
    models_used: string;
    confidence_score: string;
    consensus_data: string;
    conflicts_data: string | null;
    missing_data: string | null;
    raw_results: string;
    review_needed: string | null;
    created_at: Date;
    created_by: number | null;
    created_via: 'api' | 'frontend';
    notes: string | null;
    status: 'pending' | 'approved' | 'on_hold' | 'rejected';
    has_line_items: number;
    csv_file_path: string | null;
    csv_file_name: string | null;
}
/**
 * Raw database row for support_case_tag_assignments table
 * with joined tag data
 */
export interface CaseTagAssignmentRow {
    id: number;
    case_id: number;
    tag_id: number;
    assigned_by_user_id: number | null;
    assigned_at: Date;
    is_auto_assigned: number;
    tag_name: string;
    tag_slug: string;
    tag_description: string | null;
    tag_color: string | null;
    tag_is_system_tag: number;
    tag_auto_assign_conditions: string | null;
    tag_created_at: Date;
    tag_updated_at: Date;
    tag_created_by_user_id: number | null;
}
/**
 * Raw database row for product_conversations table
 * with joined user and product data
 */
export interface ConversationRow {
    id: number;
    product_id: number;
    buyer_id: number;
    seller_id: number;
    currency_id: number | null;
    product_booking_id: number | null;
    status: string;
    price: string | null;
    sendbird_channel_url: string | null;
    is_approved: number;
    is_from_next: number;
    seller_muted: number | null;
    buyer_muted: number | null;
    seller_first_response: Date | null;
    seller_last_response: Date | null;
    buyer_last_response: Date | null;
    reserved_at: Date | null;
    accepted_at: Date | null;
    created_at: Date;
    updated_at: Date;
    is_hidden: number;
    buyer_first_name: string;
    buyer_last_name: string;
    buyer_email: string;
    seller_first_name: string;
    seller_last_name: string;
    seller_email: string;
    product_name: string;
    product_type: string;
    product_status: string;
    bad_messages_count?: number;
}
//# sourceMappingURL=database-rows.d.ts.map