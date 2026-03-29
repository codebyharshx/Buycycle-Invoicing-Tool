/**
 * Invoice Data Source Types
 *
 * Types for the email-based invoice ingestion system.
 * Data sources allow carriers to send invoices to unique email addresses
 * (e.g., ups@invoices.buycycle.com) for automatic OCR processing.
 */
/**
 * Status values for a data source
 */
export type InvoiceDataSourceStatus = 'active' | 'paused' | 'archived';
/**
 * All valid statuses
 */
export declare const INVOICE_DATA_SOURCE_STATUSES: InvoiceDataSourceStatus[];
/**
 * Display labels for statuses
 */
export declare const INVOICE_DATA_SOURCE_STATUS_LABELS: Record<InvoiceDataSourceStatus, string>;
/**
 * Event types for data source logs
 */
export type InvoiceDataSourceEventType = 'email_received' | 'processing_started' | 'processing_completed' | 'processing_failed' | 'attachment_saved' | 'no_attachment';
/**
 * Log status values
 */
export type InvoiceDataSourceLogStatus = 'received' | 'processing' | 'success' | 'failed' | 'skipped';
/**
 * Invoice data source record as stored in database
 */
export interface InvoiceDataSource {
    id: number;
    name: string;
    email_address: string;
    status: InvoiceDataSourceStatus;
    vendor_hint: string | null;
    auto_process: boolean;
    description: string | null;
    created_by: number | null;
    created_at: string;
    updated_at: string;
    last_received_at: string | null;
    total_emails_received: number;
    total_invoices_processed: number;
}
/**
 * Invoice data source log record
 */
export interface InvoiceDataSourceLog {
    id: number;
    data_source_id: number;
    event_type: InvoiceDataSourceEventType;
    from_email: string | null;
    subject: string | null;
    received_at: string;
    file_name: string | null;
    file_path: string | null;
    file_size: number | null;
    file_type: string | null;
    status: InvoiceDataSourceLogStatus;
    invoice_extraction_id: number | null;
    error_message: string | null;
    raw_headers: Record<string, string> | null;
    created_at: string;
}
/**
 * Request body for creating a data source
 */
export interface CreateInvoiceDataSourceRequest {
    name: string;
    email_address: string;
    vendor_hint?: string;
    auto_process?: boolean;
    description?: string;
    created_by?: number;
}
/**
 * Request body for updating a data source
 */
export interface UpdateInvoiceDataSourceRequest {
    name?: string;
    status?: InvoiceDataSourceStatus;
    vendor_hint?: string | null;
    auto_process?: boolean;
    description?: string | null;
}
/**
 * Response for listing data sources
 */
export interface InvoiceDataSourcesListResponse {
    dataSources: InvoiceDataSource[];
    pagination: {
        limit: number;
        offset: number;
        total: number;
        hasMore: boolean;
    };
}
/**
 * Response for listing logs
 */
export interface InvoiceDataSourceLogsResponse {
    logs: InvoiceDataSourceLog[];
    pagination: {
        limit: number;
        offset: number;
        total: number;
        hasMore: boolean;
    };
}
/**
 * SendGrid inbound email payload (subset of fields we use)
 */
export interface SendGridInboundEmail {
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
    headers: string;
    envelope: string;
    attachments?: number;
    attachment_info?: string;
}
/**
 * Parsed attachment info from SendGrid
 */
export interface SendGridAttachment {
    filename: string;
    name: string;
    type: string;
    'content-id'?: string;
}
//# sourceMappingURL=invoice-data-source.d.ts.map