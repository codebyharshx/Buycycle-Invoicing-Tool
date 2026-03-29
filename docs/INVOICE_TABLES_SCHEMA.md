# Invoice Tables Schema

Database: PostgreSQL (Railway)

## Table: `invoice_extractions`

Main table for storing invoice header data extracted from PDFs/CSVs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NOT NULL | auto-increment | Primary key |
| `invoice_number` | varchar(255) | YES | | Invoice number from document |
| `vendor` | varchar(50) | YES | | Carrier/vendor name (UPS, DHL, etc.) |
| `account_number` | varchar(100) | YES | | Vendor account number |
| `document_type` | varchar(50) | YES | 'shipping_invoice' | Type of document |
| `document_type_raw` | varchar(255) | YES | | Raw document type from OCR |
| `parent_invoice_id` | integer | YES | | FK to parent invoice (for credit notes) |
| `parent_invoice_number` | varchar(100) | YES | | Parent invoice number reference |
| `net_amount` | numeric(12,2) | YES | | Net amount (before tax) |
| `gross_amount` | numeric(12,2) | YES | | Gross amount (after tax) |
| `vat_amount` | numeric(12,2) | YES | | VAT/tax amount |
| `vat_percentage` | numeric(5,2) | YES | | VAT percentage |
| `currency` | varchar(3) | YES | | Currency code (EUR, USD, etc.) |
| `invoice_date` | date | YES | | Invoice issue date |
| `due_date` | date | YES | | Payment due date |
| `performance_period_start` | date | YES | | Service period start |
| `performance_period_end` | date | YES | | Service period end |
| `models_used` | jsonb | YES | | LLM models used for extraction |
| `confidence_score` | numeric(5,2) | YES | | Extraction confidence (0-100) |
| `consensus_data` | jsonb | YES | | Consensus extraction results |
| `conflicts_data` | jsonb | YES | | Conflicting extraction data |
| `raw_results` | jsonb | YES | | Raw OCR/extraction results |
| `has_line_items` | boolean | YES | false | Whether line items exist |
| `total_line_items` | integer | YES | 0 | Count of line items |
| `line_items_source` | varchar(20) | YES | | Source of line items |
| `extraction_completed_at` | timestamptz | YES | | When extraction finished |
| `invoice_description` | text | YES | | Additional description |
| `status` | varchar(20) | YES | 'pending' | Processing status |
| `assigned_to` | integer | YES | | User ID assigned to review |
| `approved_by` | integer | YES | | User ID who approved |
| `approved_at` | timestamptz | YES | | Approval timestamp |
| `rejected_by` | integer | YES | | User ID who rejected |
| `rejected_at` | timestamptz | YES | | Rejection timestamp |
| `rejection_reason` | text | YES | | Reason for rejection |
| `payment_status` | varchar(20) | YES | 'unpaid' | Payment status |
| `payment_date` | date | YES | | When payment was made |
| `payment_method` | varchar(50) | YES | | Payment method used |
| `payment_reference` | varchar(255) | YES | | Payment reference number |
| `notes` | text | YES | | Internal notes |
| `tags` | jsonb | YES | | Tags for categorization |
| `viewed_by` | jsonb | YES | | Users who viewed this invoice |
| `created_by` | integer | YES | | User ID who created |
| `created_at` | timestamptz | YES | CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | timestamptz | YES | CURRENT_TIMESTAMP | Last update timestamp |

### Constraints

| Constraint | Type | Definition |
|------------|------|------------|
| `invoice_extractions_pkey` | PRIMARY KEY | `id` |
| `chk_document_type` | CHECK | `shipping_invoice`, `credit_note`, `surcharge_invoice`, `correction`, `proforma` |
| `chk_line_items_source` | CHECK | `pdf_ocr`, `csv_parser`, `hybrid`, `manual`, or NULL |
| `chk_payment_status` | CHECK | `unpaid`, `partial`, `paid`, `refunded` |
| `chk_status` | CHECK | `pending`, `processing`, `review`, `approved`, `on_hold`, `rejected` |
| `invoice_extractions_parent_invoice_id_fkey` | FOREIGN KEY | `parent_invoice_id` → `invoice_extractions(id)` ON DELETE SET NULL |

### Referenced By

- `invoice_files.invoice_id` → `invoice_extractions(id)` ON DELETE SET NULL
- `invoice_line_items.invoice_id` → `invoice_extractions(id)` ON DELETE CASCADE

---

## Table: `invoice_line_items`

Individual line items from invoices (shipments, surcharges, credits, etc.).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NOT NULL | auto-increment | Primary key |
| `invoice_id` | integer | NOT NULL | | FK to invoice_extractions |
| `vendor` | varchar(50) | YES | | Carrier/vendor name |
| `shipment_number` | varchar(100) | YES | | Tracking/shipment number |
| `invoice_number` | varchar(100) | YES | | Invoice number reference |
| `shipment_date` | date | YES | | Date of shipment |
| `booking_date` | date | YES | | Date booking was created |
| `shipment_reference_1` | varchar(255) | YES | | First reference (often order ID) |
| `shipment_reference_2` | varchar(255) | YES | | Second reference |
| `product_name` | varchar(255) | YES | | Shipping product/service name |
| `description` | text | YES | | Line item description |
| `line_item_type` | varchar(30) | YES | 'shipment' | Type of line item |
| `adjustment_type` | varchar(20) | YES | | Type of adjustment (for credits) |
| `original_line_item_id` | bigint | YES | | FK to original line item (for adjustments) |
| `original_shipment_number` | varchar(100) | YES | | Original shipment being adjusted |
| `pieces` | integer | YES | | Number of pieces |
| `weight_kg` | numeric(10,3) | YES | | Weight in kilograms |
| `weight_flag` | varchar(10) | YES | | Weight type indicator |
| `origin_country` | varchar(100) | YES | | Origin country name |
| `origin_city` | varchar(255) | YES | | Origin city name |
| `origin_postal_code` | varchar(20) | YES | | Origin postal code |
| `destination_country` | varchar(100) | YES | | Destination country name |
| `destination_city` | varchar(255) | YES | | Destination city name |
| `destination_postal_code` | varchar(20) | YES | | Destination postal code |
| `net_amount` | numeric(12,2) | YES | | Net amount (before tax) |
| `gross_amount` | numeric(12,2) | YES | | Gross amount (after tax) |
| `base_price` | numeric(12,2) | YES | | Base shipping price |
| `total_tax` | numeric(12,2) | YES | | Total tax amount |
| `total_surcharges` | numeric(12,2) | YES | | Total surcharges |
| `currency` | varchar(3) | YES | | Currency code |
| `vendor_raw_data` | jsonb | YES | | Vendor-specific structured data |
| `extraction_source` | varchar(20) | YES | | Source of extraction |
| `extraction_confidence` | numeric(5,2) | YES | | Extraction confidence (0-100) |
| `row_number` | integer | YES | | Row number in source document |
| `extracted_at` | timestamptz | YES | CURRENT_TIMESTAMP | When extracted |
| `created_at` | timestamptz | YES | CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | timestamptz | YES | CURRENT_TIMESTAMP | Last update timestamp |

### Constraints

| Constraint | Type | Definition |
|------------|------|------------|
| `invoice_line_items_pkey` | PRIMARY KEY | `id` |
| `chk_line_item_type` | CHECK | `shipment`, `surcharge`, `credit`, `adjustment`, `fee` |
| `chk_adjustment_type` | CHECK | `credit`, `debit`, `refund`, `correction`, or NULL |
| `chk_extraction_source` | CHECK | `pdf_ocr`, `csv_parser`, `manual`, or NULL |
| `invoice_line_items_invoice_id_fkey` | FOREIGN KEY | `invoice_id` → `invoice_extractions(id)` ON DELETE CASCADE |
| `invoice_line_items_original_line_item_id_fkey` | FOREIGN KEY | `original_line_item_id` → `invoice_line_items(id)` ON DELETE SET NULL |

### Indexes

| Index Name | Columns | Purpose |
|------------|---------|---------|
| `idx_line_items_invoice_id` | `invoice_id` | Join to parent invoice |
| `idx_line_items_shipment_number` | `shipment_number` | Lookup by tracking number |
| `idx_line_items_shipment_date` | `shipment_date` | Date range queries |
| `idx_line_items_reference` | `shipment_reference_1` | Lookup by order reference |
| `idx_line_items_vendor` | `vendor` | Filter by carrier |
| `idx_line_items_type` | `line_item_type` | Filter by type |
| `idx_line_items_adjustment` | `adjustment_type` | Filter adjustments |
| `idx_line_items_original` | `original_line_item_id` | Find related adjustments |
| `idx_line_items_route` | `origin_country`, `destination_country` | Route analysis |
| `idx_line_items_vendor_data` | `vendor_raw_data` (GIN) | JSON queries |

---

## Relationships

```
invoice_extractions (1) ←──────── (N) invoice_line_items
        │                                    │
        │ parent_invoice_id                  │ original_line_item_id
        ↓                                    ↓
invoice_extractions (self-ref)    invoice_line_items (self-ref)
```

---

## Enum Values Reference

### `document_type`
- `shipping_invoice` - Standard shipping invoice
- `credit_note` - Credit note/refund
- `surcharge_invoice` - Additional charges invoice
- `correction` - Invoice correction
- `proforma` - Proforma invoice

### `status`
- `pending` - Awaiting processing
- `processing` - Currently being processed
- `review` - Needs manual review
- `approved` - Approved for payment
- `on_hold` - On hold
- `rejected` - Rejected

### `payment_status`
- `unpaid` - Not yet paid
- `partial` - Partially paid
- `paid` - Fully paid
- `refunded` - Refunded

### `line_item_type`
- `shipment` - Regular shipment charge
- `surcharge` - Additional surcharge
- `credit` - Credit/refund
- `adjustment` - Adjustment to previous charge
- `fee` - Miscellaneous fee

### `adjustment_type`
- `credit` - Credit adjustment
- `debit` - Debit adjustment
- `refund` - Refund
- `correction` - Correction to previous charge

### `extraction_source` / `line_items_source`
- `pdf_ocr` - Extracted from PDF via OCR
- `csv_parser` - Parsed from CSV file
- `hybrid` - Combination of sources
- `manual` - Manually entered

---

**Last Updated**: 2024-03-27
