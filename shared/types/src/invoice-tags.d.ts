/**
 * Invoice Tag Types
 *
 * Types for the invoice tagging system (similar to case tags).
 * Tags are stored in logsPool (buycycle_log database).
 */
/**
 * Invoice tag definition
 */
export interface InvoiceTag {
    id: number;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
}
/**
 * Invoice tag assignment (join between invoice and tag)
 */
export interface InvoiceTagAssignment {
    id: number;
    invoiceId: number;
    tagId: number;
    assignedAt: Date;
    assignedBy: string | null;
    tag: InvoiceTag;
}
/**
 * Raw database row for support_logistics_invoice_tags table
 */
export interface InvoiceTagRow {
    id: number;
    name: string;
    description: string | null;
    created_at: Date;
    updated_at: Date;
    created_by: string | null;
}
/**
 * Raw database row for support_logistics_invoice_tag_assignments table
 * with joined tag data
 */
export interface InvoiceTagAssignmentRow {
    id: number;
    invoice_id: number;
    tag_id: number;
    assigned_at: Date;
    assigned_by: string | null;
    tag_name: string;
    tag_description: string | null;
    tag_created_at: Date;
    tag_updated_at: Date;
    tag_created_by: string | null;
}
//# sourceMappingURL=invoice-tags.d.ts.map