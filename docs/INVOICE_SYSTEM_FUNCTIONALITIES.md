# Invoice System Functionalities

Complete list of features and their data requirements for database schema planning.

---

## 1. Invoice Extraction & Upload

| Feature | Description | Data Required |
|---------|-------------|---------------|
| PDF Upload | Upload invoice PDFs for OCR extraction | file_name, file_path, file_size, file_type |
| CSV Upload | Upload CSV files with line items | csv_file_path, csv_file_name |
| Combined Upload | PDF + CSV together for full invoice | Both file fields |
| Multi-model OCR | Uses Gemini → DeepSeek → Mistral fallback | models_used, raw_results |
| Email Ingestion | Auto-receive invoices via SendGrid webhook | data_source_id, from_email, received_at |
| Reprocess CSV | Re-parse line items for existing invoice | line_items_source |

---

## 2. Invoice Header Data (Extracted Fields)

| Field | Type | Description |
|-------|------|-------------|
| `invoice_number` | varchar(255) | Invoice identifier |
| `vendor` | varchar(50) | Carrier (UPS, DHL, FedEx, etc.) |
| `account_number` | varchar(100) | Vendor account number |
| `document_type` | enum | shipping_invoice, credit_note, surcharge_invoice, correction, proforma |
| `document_type_raw` | varchar(255) | Raw document type from OCR |
| `net_amount` | decimal(12,2) | Amount before tax |
| `gross_amount` | decimal(12,2) | Amount after tax |
| `vat_amount` | decimal(12,2) | VAT/tax amount |
| `vat_percentage` | decimal(5,2) | VAT rate |
| `currency` | varchar(3) | EUR, USD, GBP, etc. |
| `invoice_date` | date | Invoice issue date |
| `due_date` | date | Payment due date |
| `performance_period_start` | date | Service period start |
| `performance_period_end` | date | Service period end |
| `invoice_description` | text | Additional description |

---

## 3. OCR Extraction Metadata

| Field | Type | Description |
|-------|------|-------------|
| `models_used` | jsonb | Array of models used for extraction |
| `confidence_score` | decimal(5,2) | Overall OCR confidence (0-100) |
| `consensus_data` | jsonb | Merged extraction results |
| `conflicts_data` | jsonb | Fields where models disagreed |
| `raw_results` | jsonb | Raw output from each model |
| `extraction_completed_at` | timestamptz | When extraction finished |

---

## 4. Line Items (Per Shipment)

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `invoice_id` | int (FK) | Parent invoice reference |
| `vendor` | varchar(50) | Carrier name |
| `shipment_number` | varchar(100) | Tracking/waybill number |
| `invoice_number` | varchar(100) | Invoice number reference |
| `shipment_date` | date | Date of shipment |
| `booking_date` | date | Date booking was created |
| `shipment_reference_1` | varchar(255) | First reference (often order ID) |
| `shipment_reference_2` | varchar(255) | Second reference |
| `product_name` | varchar(255) | Shipping service type |
| `description` | text | Line item description |

### Line Item Type & Adjustments

| Field | Type | Description |
|-------|------|-------------|
| `line_item_type` | enum | shipment, surcharge, credit, adjustment, fee |
| `adjustment_type` | enum | credit, debit, refund, correction |
| `original_line_item_id` | bigint (FK) | Reference to original line item |
| `original_shipment_number` | varchar(100) | Original shipment being adjusted |

### Package Details

| Field | Type | Description |
|-------|------|-------------|
| `pieces` | int | Number of pieces |
| `weight_kg` | decimal(10,3) | Weight in kilograms |
| `weight_flag` | varchar(10) | Weight type indicator |

### Route Information

| Field | Type | Description |
|-------|------|-------------|
| `origin_country` | varchar(100) | Origin country name |
| `origin_city` | varchar(255) | Origin city name |
| `origin_postal_code` | varchar(20) | Origin postal code |
| `destination_country` | varchar(100) | Destination country name |
| `destination_city` | varchar(255) | Destination city name |
| `destination_postal_code` | varchar(20) | Destination postal code |

### Pricing

| Field | Type | Description |
|-------|------|-------------|
| `net_amount` | decimal(12,2) | Net amount |
| `gross_amount` | decimal(12,2) | Gross amount |
| `base_price` | decimal(12,2) | Base shipping price |
| `total_tax` | decimal(12,2) | Total tax amount |
| `total_surcharges` | decimal(12,2) | Total surcharges |
| `currency` | varchar(3) | Currency code |

### Vendor-Specific Data

| Field | Type | Description |
|-------|------|-------------|
| `vendor_raw_data` | jsonb | Vendor-specific structured data |
| `extraction_source` | enum | pdf_ocr, csv_parser, manual |
| `extraction_confidence` | decimal(5,2) | Line item extraction confidence |
| `row_number` | int | Row number in source document |

---

## 5. Workflow & Status Management

| Feature | Field | Type | Values |
|---------|-------|------|--------|
| Status Tracking | `status` | enum | pending, processing, review, approved, on_hold, rejected |
| Assignment | `assigned_to` | int (FK) | User ID |
| Approval | `approved_by` | int (FK) | User ID who approved |
| Approval Time | `approved_at` | timestamptz | Approval timestamp |
| Rejection | `rejected_by` | int (FK) | User ID who rejected |
| Rejection Time | `rejected_at` | timestamptz | Rejection timestamp |
| Rejection Reason | `rejection_reason` | text | Why invoice was rejected |
| Read Tracking | `viewed_by` | jsonb | Array of user IDs who viewed |

---

## 6. Payment Tracking

| Feature | Field | Type | Values |
|---------|-------|------|--------|
| Payment Status | `payment_status` | enum | unpaid, partial, paid, refunded |
| Payment Date | `payment_date` | date | When payment was made |
| Payment Method | `payment_method` | varchar(50) | bank_transfer, credit_card, etc. |
| Payment Reference | `payment_reference` | varchar(255) | Transaction reference |

---

## 7. Tags System

### Tags Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `name` | varchar(100) | Tag name (unique) |
| `description` | text | Tag description |
| `created_by` | varchar(255) | Who created the tag |
| `created_at` | timestamptz | Creation time |
| `updated_at` | timestamptz | Last update time |

### Tag Assignments Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `invoice_id` | int (FK) | Invoice reference |
| `tag_id` | int (FK) | Tag reference |
| `assigned_by` | varchar(255) | Who assigned the tag |
| `assigned_at` | timestamptz | Assignment time |

---

## 8. Notes/Comments

### Current Implementation

| Field | Type | Description |
|-------|------|-------------|
| `notes` | text | Single notes field on invoice |

### Proposed: Comments Table (Not Yet Implemented)

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `invoice_id` | int (FK) | Invoice reference |
| `user_id` | int (FK) | Who wrote the comment |
| `content` | text | Comment content |
| `is_internal` | boolean | Internal vs external comment |
| `created_at` | timestamptz | Creation time |
| `updated_at` | timestamptz | Last update time |

---

## 9. Vendor Management

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `name` | varchar(255) | Vendor name (unique) |
| `services` | jsonb | Array of services offered |
| `payment_terms_type` | enum | based_on_invoice, net_30, net_60, custom |
| `payment_terms_custom_days` | int | Custom payment term days |
| `invoice_source` | varchar(255) | How invoices arrive |
| `shipment_type` | varchar(255) | Type of shipments |
| `vat_info` | varchar(255) | VAT information |
| `invoice_frequency` | varchar(255) | How often invoices arrive |
| `invoice_format` | varchar(255) | PDF, CSV, etc. |
| `payment_method` | varchar(255) | Preferred payment method |
| `is_active` | boolean | Soft delete flag |
| `notes` | text | Internal notes |
| `created_by` | int (FK) | Who created |
| `updated_by` | int (FK) | Who last updated |
| `created_at` | timestamptz | Creation time |
| `updated_at` | timestamptz | Last update time |

---

## 10. Data Sources (Email Ingestion)

### Data Sources Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `name` | varchar(255) | Source name |
| `email_address` | varchar(255) | Email address (unique) |
| `status` | enum | active, paused, archived |
| `vendor_hint` | varchar(100) | Pre-assign vendor |
| `auto_process` | boolean | Auto-run OCR |
| `description` | text | Description |
| `created_by` | int | Who created |
| `last_received_at` | timestamptz | Last email received |
| `total_emails_received` | int | Email count |
| `total_invoices_processed` | int | Processed count |
| `created_at` | timestamptz | Creation time |
| `updated_at` | timestamptz | Last update time |

### Data Source Logs Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `data_source_id` | int (FK) | Data source reference |
| `event_type` | varchar(50) | Event type |
| `from_email` | varchar(255) | Sender email |
| `subject` | varchar(500) | Email subject |
| `received_at` | timestamptz | When received |
| `file_name` | varchar(255) | Attachment filename |
| `file_path` | varchar(500) | Storage path |
| `file_size` | int | File size in bytes |
| `file_type` | varchar(50) | MIME type |
| `status` | varchar(20) | Processing status |
| `invoice_extraction_id` | int (FK) | Created invoice ID |
| `error_message` | text | Error if failed |
| `raw_headers` | jsonb | Email headers |
| `created_at` | timestamptz | Creation time |

---

## 11. File Management

### Invoice Files Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `invoice_id` | int (FK) | Invoice reference |
| `file_type` | enum | pdf, csv, image |
| `file_name` | varchar(255) | Original filename |
| `file_path` | varchar(500) | Storage path |
| `file_size` | int | Size in bytes |
| `mime_type` | varchar(100) | MIME type |
| `is_primary` | boolean | Main invoice file |
| `uploaded_by` | int (FK) | Who uploaded |
| `created_at` | timestamptz | Upload time |

---

## 12. Analytics & Reporting Features

| Feature | Data Required |
|---------|---------------|
| Dashboard Overview | Aggregates from invoice_extractions |
| Counts by Status | `status` field |
| Totals by Vendor | `vendor`, `net_amount`, `gross_amount` |
| Monthly Heatmap | `invoice_date`, counts |
| Accounting View | Line items grouped by `booking_date` month |
| Excel Export | All fields for filtered data |
| Unread Tracking | `viewed_by` array |

---

## 13. Views & Filtering Capabilities

| Filter | Field(s) Used |
|--------|---------------|
| Status View | `status` |
| Payment Status | `payment_status` |
| Vendor Filter | `vendor` |
| Date Range | `invoice_date` |
| Due Date Range | `due_date` |
| Search | `invoice_number`, `file_name` |
| Unread Only | `viewed_by` not containing current user |
| Assigned To | `assigned_to` |
| Tags | Join with tag_assignments |
| Document Type | `document_type` |
| Has Line Items | `has_line_items` |

---

## 14. Credit Note & Adjustment Linking

| Feature | Fields Required |
|---------|-----------------|
| Parent Invoice Link | `parent_invoice_id`, `parent_invoice_number` |
| Original Line Item | `original_line_item_id`, `original_shipment_number` |
| Adjustment Type | `adjustment_type` |

---

## 15. Audit & History (Not Yet Implemented)

### Proposed: Activity Log Table

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `invoice_id` | int (FK) | Invoice reference |
| `user_id` | int (FK) | Who performed action |
| `action` | varchar(50) | created, updated, approved, rejected, etc. |
| `field_changed` | varchar(100) | Which field changed |
| `old_value` | text | Previous value |
| `new_value` | text | New value |
| `created_at` | timestamptz | When action occurred |

---

## Summary: Required Tables

| Table | Database | Purpose |
|-------|----------|---------|
| `invoice_extractions` | PostgreSQL | Main invoice records |
| `invoice_line_items` | PostgreSQL | Individual shipment line items |
| `invoice_files` | PostgreSQL | File attachments |
| `invoice_tags` | PostgreSQL | Tag definitions |
| `invoice_tag_assignments` | PostgreSQL | Invoice ↔ Tag mapping |
| `invoice_comments` | PostgreSQL | Threaded comments (proposed) |
| `invoice_activity_log` | PostgreSQL | Audit trail (proposed) |
| `invoice_data_sources` | PostgreSQL | Email ingestion config |
| `invoice_data_source_logs` | PostgreSQL | Email processing logs |
| `support_logistics_vendors` | PostgreSQL | Vendor/carrier definitions |

---

## Current Gaps / Missing Features

| Feature | Status | Notes |
|---------|--------|-------|
| Threaded Comments | Missing | Only single notes field |
| Activity/Audit Log | Missing | No history tracking |
| Credit Note Linking | Partial | Fields exist, not fully used |
| Line Item ↔ Order Matching | Missing | No link to buycycle orders |
| Dispute Tracking | Missing | No formal dispute workflow |
| Duplicate Detection | Missing | No deduplication logic |
| Bulk Operations | Missing | No bulk approve/reject |
| Scheduled Reports | Missing | No automated reporting |

---

**Last Updated**: 2024-03-27
