/**
 * Invoice OCR Types
 * Shared types for multi-model invoice OCR extraction with consensus analysis
 */
/**
 * Line item data from OCR extraction (without database fields)
 */
export interface OCRLineItem {
    invoice_number?: string;
    invoice_date?: string;
    invoice_due_date?: string;
    currency?: string;
    shipment_number?: string;
    shipment_date?: string;
    booking_created_date?: string;
    shipment_reference_1?: string;
    shipment_reference_2?: string;
    product_name?: string;
    pieces?: number;
    weight_kg?: number;
    weight_flag?: string;
    /** Weight discrepancy note (e.g., "Entered: 15L, Billed: 18L (Dimensional)") */
    weight_discrepancy?: string;
    package_dimensions?: string;
    origin_country_name?: string;
    origin_name?: string;
    senders_postcode?: string;
    destination_country_name?: string;
    destination_name?: string;
    receivers_postcode?: string;
    net_amount?: number;
    gross_amount?: number;
    base_price?: number;
    total_tax?: number;
    incentive_amount?: number;
    total_extra_charges?: number;
    total_extra_charges_tax?: number;
    xc1_name?: string;
    xc1_charge?: number;
    xc2_name?: string;
    xc2_charge?: number;
    xc3_name?: string;
    xc3_charge?: number;
    xc4_name?: string;
    xc4_charge?: number;
    xc5_name?: string;
    xc5_charge?: number;
    xc6_name?: string;
    xc6_charge?: number;
    xc7_name?: string;
    xc7_charge?: number;
    xc8_name?: string;
    xc8_charge?: number;
    xc9_name?: string;
    xc9_charge?: number;
}
/**
 * Complete invoice data structure matching the OCR extraction format
 */
export interface InvoiceData {
    vendor: string;
    account_nr: string;
    invoice_number: string;
    document_type: string;
    net_amount: number;
    vat_amount: number;
    vat_percentage: number;
    gross_invoice_amt: number;
    currency: string;
    issued_date: string;
    due_date: string;
    performance_period_start: string;
    performance_period_end: string;
    assigned_to: string;
    booking_date: string;
    line_items?: OCRLineItem[];
}
/**
 * Partial invoice data from extraction (fields may be missing)
 */
export type PartialInvoiceData = Partial<InvoiceData>;
/**
 * Field-level conflict information
 */
export interface FieldConflict {
    [modelName: string]: string | number | string[] | undefined;
    _missing_from?: string[];
}
/**
 * Consensus analysis result with accuracy metrics
 */
export interface ConsensusAnalysis {
    consensus: Record<string, string | number | string[] | OCRLineItem[]>;
    conflicts: Record<string, FieldConflict>;
    missing: Record<string, string>;
    confidence_score: number;
    review_needed: string[];
    field_confidence_scores: Record<string, number>;
    field_consistency: Record<string, number>;
    validation_issues: string[];
    low_confidence_fields: string[];
}
/**
 * Multi-model extraction result
 */
export interface MultiModelResult {
    file: string;
    timestamp: string;
    raw_results: Record<string, InvoiceData | null>;
    analysis: ConsensusAnalysis;
}
/**
 * Configuration for extraction
 */
export interface ExtractionConfig {
    mistralApiKey?: string;
    geminiApiKey?: string;
    openRouterApiKey?: string;
    replicateApiKey?: string;
    models?: string[];
}
/**
 * Model configuration
 */
export interface ModelConfig {
    id: string;
    name: string;
    emoji: string;
}
/**
 * Available models
 */
export type ModelName = 'mistral' | 'gemini' | 'claude' | 'qwen3-8b' | 'qwen3-30b' | 'qwen3-235b' | 'deepseek';
/**
 * Invoice extraction status enum
 */
export type InvoiceExtractionStatus = 'pending' | 'approved' | 'on_hold' | 'rejected' | 'paid';
/**
 * Source of invoice upload
 */
export type InvoiceCreatedVia = 'api' | 'frontend';
/**
 * Payment methods for invoices
 */
export type InvoicePaymentMethod = 'Mercury' | 'Bank Transfer' | 'PayPal' | 'Credit Card' | 'Direct Debit' | 'Other';
/**
 * All available payment methods
 */
export declare const INVOICE_PAYMENT_METHODS: InvoicePaymentMethod[];
/**
 * Invoice extraction record as stored in database
 */
export interface InvoiceExtractionRecord {
    id: number;
    file_name: string;
    invoice_number: string | null;
    file_path: string;
    file_size: number;
    models_used: string[];
    confidence_score: number;
    consensus_data: Record<string, string | number | string[]>;
    conflicts_data: Record<string, FieldConflict> | null;
    missing_data: Record<string, string> | null;
    raw_results: Record<string, InvoiceData | null>;
    review_needed: string[] | null;
    created_at: string;
    created_by: number | null;
    created_via: InvoiceCreatedVia;
    /** @deprecated Use threads system with entity_type='invoice' instead. This field is no longer written to. */
    notes: string | null;
    status: InvoiceExtractionStatus;
    has_line_items: boolean;
    csv_file_path: string | null;
    csv_file_name: string | null;
    assigned_agent_id: number | null;
    payment_date: string | null;
    payment_method: InvoicePaymentMethod | null;
    approved_by: number | null;
    approved_at: string | null;
    viewed_by: number[];
}
/**
 * Single line item from a multi-line invoice (e.g., DHL shipment)
 */
export interface InvoiceLineItem {
    id: number;
    invoice_extraction_id: number;
    invoice_number: string | null;
    shipment_number: string | null;
    shipment_date: string | null;
    booking_created_date: string | null;
    shipment_reference_1: string | null;
    shipment_reference_2: string | null;
    product_name: string | null;
    pieces: number | null;
    weight_kg: number | null;
    weight_flag: string | null;
    origin_country_name: string | null;
    origin_name: string | null;
    senders_postcode: string | null;
    destination_country_name: string | null;
    destination_name: string | null;
    receivers_postcode: string | null;
    net_amount: number | null;
    gross_amount: number | null;
    base_price: number | null;
    total_tax: number | null;
    total_extra_charges: number | null;
    total_extra_charges_tax: number | null;
    xc1_name: string | null;
    xc1_charge: number | null;
    xc2_name: string | null;
    xc2_charge: number | null;
    xc3_name: string | null;
    xc3_charge: number | null;
    xc4_name: string | null;
    xc4_charge: number | null;
    xc5_name: string | null;
    xc5_charge: number | null;
    xc6_name: string | null;
    xc6_charge: number | null;
    xc7_name: string | null;
    xc7_charge: number | null;
    xc8_name: string | null;
    xc8_charge: number | null;
    xc9_name: string | null;
    xc9_charge: number | null;
    created_at: string;
    updated_at: string;
}
/**
 * Invoice extraction record with populated line items
 */
export interface InvoiceExtractionRecordWithLineItems extends InvoiceExtractionRecord {
    line_items: InvoiceLineItem[];
}
/**
 * Request body for invoice extraction
 */
export interface InvoiceExtractionRequest {
    models?: ModelName[];
    created_by?: number;
    created_via?: InvoiceCreatedVia;
    notes?: string;
    has_line_items?: boolean;
}
/**
 * Response from invoice extraction endpoint
 */
export interface InvoiceExtractionResponse {
    id: number;
    extraction: MultiModelResult;
    database_record: InvoiceExtractionRecord;
}
/**
 * Invoice status counts with unread tracking
 */
export interface InvoiceStatusCounts {
    active: {
        total: number;
        unread: number;
    };
    approved: {
        total: number;
        unread: number;
    };
    paid: {
        total: number;
        unread: number;
    };
    all: {
        total: number;
        unread: number;
    };
    myAssignments: {
        total: number;
        unread: number;
    };
    unassigned: {
        total: number;
    };
}
/**
 * Invoice view/status filter options
 */
export type InvoiceViewFilter = 'active' | 'approved' | 'paid' | 'all';
/**
 * Aggregate totals used for invoice dashboards
 */
export interface InvoiceDashboardTotals {
    count: number;
    totalNet: number;
    totalGross: number;
}
/**
 * Vendor-level aggregation for dashboard cards
 */
export interface InvoiceVendorSummary {
    vendor: string;
    invoiceCount: number;
    totalNet: number;
    totalGross: number;
}
/**
 * Monthly vendor aggregation for heatmap/timeline
 */
export interface InvoiceMonthlySummary {
    month: string;
    vendor: string;
    invoiceCount: number;
    totalNet: number;
    totalGross: number;
}
/**
 * Dashboard response combining headline stats, vendor list, and monthly heatmap
 */
export interface InvoiceDashboardResponse {
    stats: {
        open: InvoiceDashboardTotals;
        onHold: InvoiceDashboardTotals;
        readyForPayment: InvoiceDashboardTotals;
        discrepancies: InvoiceDashboardTotals;
    };
    vendors: InvoiceVendorSummary[];
    monthly: InvoiceMonthlySummary[];
    lastUpdated: string;
}
/**
 * Known logistics vendors (normalized names)
 */
export declare const KNOWN_LOGISTICS_VENDORS: string[];
/**
 * A single month/total column bucket in the accounting pivot table.
 * Represents aggregated line items for a specific month (by booking_created_date),
 * a year total, or the "unmapped" bucket.
 */
export interface AccountingMonthBucket {
    /** Month key: "YYYY-MM" for months, "YYYY-total" for year totals, "unmapped" for null dates */
    key: string;
    /** Human-readable label: "Jan 2025", "2025 Total", "Unmapped" */
    label: string;
    /** Number of shipments (line items) in this bucket */
    shipmentCount: number;
    /** Sum of net_amount for line items in this bucket */
    netAmount: number;
}
/**
 * One row in the accounting pivot table representing a single invoice.
 */
export interface AccountingInvoiceRow {
    invoiceId: number;
    vendor: string;
    invoiceNumber: string;
    invoiceDate: string | null;
    netInvoiceAmount: number;
    grossInvoiceAmount: number;
    currency: string;
    /** Monthly buckets for this invoice (only includes non-zero buckets) */
    months: AccountingMonthBucket[];
    totalShipmentCount: number;
    totalNetAmount: number;
}
/**
 * Vendor group in the accounting view -- groups multiple invoice rows under one vendor.
 */
export interface AccountingVendorGroup {
    vendor: string;
    invoices: AccountingInvoiceRow[];
    /** Aggregated totals per column across all invoices for this vendor */
    monthTotals: AccountingMonthBucket[];
    totalShipmentCount: number;
    totalNetAmount: number;
}
/**
 * Full response from the accounting endpoint.
 */
export interface AccountingViewResponse {
    /** All column keys in display order (e.g. ["2024-11","2024-12","2024-total","2025-01","unmapped","2025-total"]) */
    columnKeys: string[];
    /** Human-readable labels for each column key */
    columnLabels: Record<string, string>;
    /** Data grouped by vendor */
    vendors: AccountingVendorGroup[];
    /** Grand totals across all vendors per column */
    grandTotals: AccountingMonthBucket[];
    grandTotalShipmentCount: number;
    grandTotalNetAmount: number;
}
/**
 * Query parameters for the accounting view endpoint
 */
export interface AccountingViewQuery {
    dateFrom?: string;
    dateTo?: string;
    vendor?: string;
}
//# sourceMappingURL=invoice-ocr.d.ts.map