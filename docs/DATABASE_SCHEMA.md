# Invoice System Database Schema

**Database:** PostgreSQL (Neon)
**Last Updated:** 2026-04-23
**Source:** Live database query

---

## Tables Overview

| # | Table | Columns | Purpose |
|---|-------|---------|---------|
| 1 | `invoice_extractions` | 33 | Main invoice header data |
| 2 | `invoice_line_items` | 42 | Shipment/surcharge line items |
| 3 | `invoice_files` | 25 | Uploaded PDF/CSV files |
| 4 | `invoice_users` | 13 | User authentication |
| 5 | `invoice_threads` | 11 | Comments with @mentions |
| 6 | `invoice_notifications` | 11 | User notifications |
| 7 | `invoice_data_sources` | 21 | Email/SFTP ingestion config |
| 8 | `invoice_data_source_logs` | 16 | Ingestion event logs |

---

## Table 1: `invoice_extractions`

Main table for storing invoice header data extracted from PDFs/CSVs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | serial | Primary key |
| `file_id` | integer | YES | | FK to invoice_files |
| `invoice_number` | varchar(255) | YES | | Invoice number from document |
| `vendor` | varchar(50) | YES | | Carrier name (UPS, DHL, etc.) |
| `account_number` | varchar(100) | YES | | Vendor account number |
| `document_type` | varchar(50) | YES | 'shipping_invoice' | Type of document |
| `parent_invoice_id` | integer | YES | | FK to parent invoice (credit notes) |
| `parent_invoice_number` | varchar(100) | YES | | Parent invoice number reference |
| `net_amount` | numeric(12,2) | YES | | Net amount (before tax) |
| `gross_amount` | numeric(12,2) | YES | | Gross amount (after tax) |
| `vat_amount` | numeric(12,2) | YES | | VAT/tax amount |
| `vat_percentage` | numeric(5,2) | YES | | VAT percentage |
| `currency` | varchar(3) | YES | | Currency code (EUR, USD) |
| `invoice_date` | date | YES | | Invoice issue date |
| `due_date` | date | YES | | Payment due date |
| `performance_period_start` | date | YES | | Service period start |
| `performance_period_end` | date | YES | | Service period end |
| `models_used` | jsonb | YES | | LLM models used for extraction |
| `confidence_score` | numeric(5,2) | YES | | Extraction confidence (0-100) |
| `consensus_data` | jsonb | YES | | Consensus extraction results |
| `conflicts_data` | jsonb | YES | | Conflicting extraction data |
| `raw_results` | jsonb | YES | | Raw OCR results per model |
| `has_line_items` | boolean | YES | false | Whether line items exist |
| `status` | varchar(20) | YES | 'pending' | Processing status |
| `assigned_to` | integer | YES | | User ID assigned to review |
| `assigned_at` | timestamptz | YES | | Assignment timestamp |
| `approved_by` | integer | YES | | User ID who approved |
| `approved_at` | timestamptz | YES | | Approval timestamp |
| `viewed_by` | jsonb | YES | | Users who viewed this invoice |
| `payment_status` | varchar(20) | YES | 'unpaid' | Payment status |
| `payment_date` | date | YES | | When payment was made |
| `payment_method` | varchar(50) | YES | | Payment method used |
| `data_source_id` | integer | YES | | FK to invoice_data_sources |
| `created_by` | integer | YES | | User ID who created |
| `created_at` | timestamptz | YES | CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | timestamptz | YES | CURRENT_TIMESTAMP | Last update timestamp |
| `last_modified_by` | integer | YES | | User ID who last modified |
| `last_modified_action` | varchar(50) | YES | | Last modification action |

### Constraints

```sql
PRIMARY KEY (id)
FOREIGN KEY (parent_invoice_id) REFERENCES invoice_extractions(id) ON DELETE SET NULL
FOREIGN KEY (file_id) REFERENCES invoice_files(id) ON DELETE SET NULL

CHECK chk_document_type: document_type IN ('shipping_invoice', 'credit_note', 'surcharge_invoice', 'correction', 'proforma')
CHECK chk_ie_status: status IN ('pending', 'processing', 'review', 'approved', 'on_hold', 'rejected')
CHECK chk_ie_payment_status: payment_status IN ('unpaid', 'partial', 'paid', 'refunded')
```

### Indexes

```sql
idx_ie_status ON (status)
idx_ie_vendor ON (vendor)
idx_ie_invoice_number ON (invoice_number)
idx_ie_invoice_date ON (invoice_date)
idx_ie_document_type ON (document_type)
idx_ie_payment_status ON (payment_status)
idx_ie_file_id ON (file_id) WHERE file_id IS NOT NULL
idx_ie_parent ON (parent_invoice_id) WHERE parent_invoice_id IS NOT NULL
idx_ie_assigned_to ON (assigned_to) WHERE assigned_to IS NOT NULL
idx_ie_data_source ON (data_source_id) WHERE data_source_id IS NOT NULL
```

---

## Table 2: `invoice_line_items`

Individual line items from invoices (shipments, surcharges, credits).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | serial | Primary key |
| `invoice_id` | integer | NO | | FK to invoice_extractions |
| `vendor` | varchar(50) | YES | | Carrier name |
| `shipment_number` | varchar(100) | YES | | Primary tracking number |
| `shipment_number_2` | varchar(100) | YES | | Secondary tracking number |
| `invoice_number` | varchar(100) | YES | | Invoice number reference |
| `shipment_reference_1` | varchar(255) | YES | | First reference (order ID) |
| `shipment_reference_2` | varchar(255) | YES | | Second reference |
| `shipment_date` | date | YES | | Date of shipment |
| `booking_date` | date | YES | | Date booking was created |
| `line_item_type` | varchar(30) | YES | 'shipment' | Type of line item |
| `adjustment_type` | varchar(20) | YES | | Type of adjustment |
| `original_line_item_id` | bigint | YES | | FK to original line item |
| `original_shipment_number` | varchar(100) | YES | | Original shipment adjusted |
| `charge_subtype` | varchar(50) | YES | | Charge subcategory |
| `product_name` | varchar(255) | YES | | Shipping product name |
| `description` | text | YES | | Line item description |
| `route_code` | varchar(20) | YES | | Route code |
| `origin_country` | varchar(100) | YES | | Origin country |
| `origin_city` | varchar(255) | YES | | Origin city |
| `origin_postal_code` | varchar(20) | YES | | Origin postal code |
| `destination_country` | varchar(100) | YES | | Destination country |
| `destination_city` | varchar(255) | YES | | Destination city |
| `destination_postal_code` | varchar(20) | YES | | Destination postal code |
| `sender_name` | varchar(255) | YES | | Sender name |
| `receiver_name` | varchar(255) | YES | | Receiver name |
| `pieces` | integer | YES | | Number of pieces |
| `weight_kg` | numeric(10,3) | YES | | Weight in kilograms |
| `weight_flag` | varchar(10) | YES | | Weight type (A/B/V/W/M) |
| `base_price` | numeric(12,2) | YES | | Base shipping price |
| `published_charge` | numeric(12,2) | YES | | Published charge |
| `incentive_credit` | numeric(12,2) | YES | | Incentive/discount |
| `total_surcharges` | numeric(12,2) | YES | | Total surcharges |
| `net_amount` | numeric(12,2) | YES | | Net amount |
| `total_tax` | numeric(12,2) | YES | | Total tax |
| `gross_amount` | numeric(12,2) | YES | | Gross amount |
| `currency` | varchar(3) | YES | | Currency code |
| `vendor_raw_data` | jsonb | YES | | Vendor-specific raw data |
| `extraction_source` | varchar(20) | YES | | Source of extraction |
| `extraction_confidence` | numeric(5,2) | YES | | Confidence (0-100) |
| `row_number` | integer | YES | | Row in source document |
| `reconciliation_id` | integer | YES | | Reconciliation reference |
| `extracted_at` | timestamptz | YES | CURRENT_TIMESTAMP | When extracted |
| `created_at` | timestamptz | YES | CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | timestamptz | YES | CURRENT_TIMESTAMP | Last update timestamp |

### Constraints

```sql
PRIMARY KEY (id)
FOREIGN KEY (invoice_id) REFERENCES invoice_extractions(id) ON DELETE CASCADE
FOREIGN KEY (original_line_item_id) REFERENCES invoice_line_items(id) ON DELETE SET NULL

CHECK chk_ili_line_item_type: line_item_type IN ('shipment', 'surcharge', 'credit', 'adjustment', 'fee')
CHECK chk_ili_adjustment_type: adjustment_type IN ('credit', 'debit', 'refund', 'correction') OR NULL
CHECK chk_ili_extraction_source: extraction_source IN ('pdf_ocr', 'csv_parser', 'manual') OR NULL
```

### Indexes

```sql
idx_ili_invoice_id ON (invoice_id)
idx_ili_shipment_number ON (shipment_number)
idx_ili_shipment_number_2 ON (shipment_number_2) WHERE shipment_number_2 IS NOT NULL
idx_ili_shipment_date ON (shipment_date)
idx_ili_reference_1 ON (shipment_reference_1)
idx_ili_vendor ON (vendor)
idx_ili_type ON (line_item_type)
idx_ili_adjustment_type ON (adjustment_type) WHERE adjustment_type IS NOT NULL
idx_ili_original ON (original_line_item_id) WHERE original_line_item_id IS NOT NULL
idx_ili_route_code ON (route_code)
idx_ili_route_countries ON (origin_country, destination_country)
idx_ili_vendor_date ON (vendor, shipment_date)
idx_ili_vendor_type ON (vendor, line_item_type)
idx_ili_charge_subtype ON (charge_subtype) WHERE charge_subtype IS NOT NULL
idx_ili_reconciliation ON (reconciliation_id) WHERE reconciliation_id IS NOT NULL
idx_ili_vendor_raw_data ON vendor_raw_data USING GIN
```

---

## Table 3: `invoice_files`

Stores uploaded invoice files (PDF/CSV) with hash for duplicate detection.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | serial | Primary key |
| `file_type` | varchar(10) | NO | | File extension (pdf, csv) |
| `file_name` | varchar(255) | NO | | Original filename |
| `file_size` | bigint | YES | | File size in bytes |
| `mime_type` | varchar(100) | YES | | MIME type |
| `checksum` | varchar(64) | YES | | SHA-256 checksum |
| `file_hash` | varchar(64) | YES | | SHA-256 hash for dedup |
| `s3_bucket` | varchar(100) | YES | | S3 bucket name |
| `s3_key` | varchar(500) | YES | | S3 object key |
| `s3_url` | varchar(1000) | YES | | S3 URL |
| `s3_region` | varchar(50) | YES | | S3 region |
| `local_path` | varchar(500) | YES | | Local filesystem path |
| `source` | varchar(20) | NO | | Source: upload, email, webhook |
| `source_email_from` | varchar(255) | YES | | Email sender |
| `source_email_subject` | text | YES | | Email subject |
| `source_email_received_at` | timestamptz | YES | | Email received time |
| `source_api_client` | varchar(100) | YES | | API client identifier |
| `status` | varchar(20) | YES | 'pending' | Processing status |
| `processing_started_at` | timestamptz | YES | | Processing start time |
| `processing_completed_at` | timestamptz | YES | | Processing end time |
| `error_message` | text | YES | | Error if failed |
| `retry_count` | integer | YES | 0 | Number of retries |
| `is_primary` | boolean | YES | true | Is primary file |
| `uploaded_at` | timestamptz | YES | CURRENT_TIMESTAMP | Upload timestamp |
| `created_at` | timestamptz | YES | CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | timestamptz | YES | CURRENT_TIMESTAMP | Last update timestamp |

### Constraints

```sql
PRIMARY KEY (id)

CHECK chk_if_file_type: file_type IN ('pdf', 'csv', 'xlsx', 'xls', 'png', 'jpg', 'jpeg')
CHECK chk_if_source: source IN ('upload', 'email', 'webhook', 'api', 'auto_ingest', 'sftp')
CHECK chk_if_status: status IN ('pending', 'processing', 'completed', 'failed', 'duplicate')
```

### Indexes

```sql
idx_if_file_type ON (file_type)
idx_if_source ON (source)
idx_if_status ON (status)
idx_if_uploaded_at ON (uploaded_at)
idx_if_checksum ON (checksum) WHERE checksum IS NOT NULL
idx_invoice_files_hash ON (file_hash) UNIQUE WHERE file_hash IS NOT NULL
```

---

## Table 4: `invoice_users`

User authentication and authorization.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | serial | Primary key |
| `email` | varchar(255) | NO | | User email (unique) |
| `password_hash` | varchar(255) | NO | | Bcrypt hashed password |
| `name` | varchar(255) | YES | | Display name |
| `avatar_url` | varchar(500) | YES | | Avatar image URL |
| `role` | varchar(50) | YES | 'member' | User role |
| `is_active` | boolean | YES | true | Whether user is active |
| `last_login_at` | timestamptz | YES | | Last login timestamp |
| `last_seen_at` | timestamptz | YES | | Last activity timestamp |
| `reset_token` | varchar(255) | YES | | Password reset token |
| `reset_token_expires` | timestamptz | YES | | Token expiration |
| `created_at` | timestamptz | YES | CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | timestamptz | YES | CURRENT_TIMESTAMP | Last update timestamp |

### Constraints

```sql
PRIMARY KEY (id)
UNIQUE (email)
```

### Role Permissions

| Role | Permissions |
|------|------------|
| `member` | view, comment |
| `manager` | view, comment, assign, approve |
| `admin` | view, comment, assign, approve, delete, admin |

---

## Table 5: `invoice_threads`

Comments/notes on invoices with @mentions support.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | serial | Primary key |
| `entity_type` | varchar(50) | NO | 'invoice' | Type of entity |
| `entity_id` | integer | NO | | FK to invoice_extractions.id |
| `content` | text | NO | | Comment content |
| `author_id` | integer | NO | | FK to invoice_users.id |
| `author_name` | varchar(255) | NO | | Author display name |
| `mentioned_user_ids` | integer[] | YES | '{}' | Array of mentioned user IDs |
| `is_edited` | boolean | YES | false | Whether edited |
| `is_deleted` | boolean | YES | false | Soft delete flag |
| `created_at` | timestamptz | YES | now() | Creation timestamp |
| `updated_at` | timestamptz | YES | now() | Last update timestamp |

### Constraints

```sql
PRIMARY KEY (id)
FOREIGN KEY (entity_id) REFERENCES invoice_extractions(id) ON DELETE CASCADE
```

### Indexes

```sql
idx_invoice_threads_entity ON (entity_type, entity_id) WHERE is_deleted = false
idx_invoice_threads_mentions ON mentioned_user_ids USING GIN WHERE is_deleted = false
```

---

## Table 6: `invoice_notifications`

User notifications for assignments and @mentions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | serial | Primary key |
| `user_id` | integer | NO | | FK to invoice_users.id |
| `type` | varchar(50) | NO | | Notification type |
| `entity_type` | varchar(50) | NO | | Entity type (invoice, thread) |
| `entity_id` | integer | NO | | Entity ID |
| `title` | varchar(255) | NO | | Notification title |
| `message` | text | YES | | Notification message |
| `actor_id` | integer | YES | | User who triggered |
| `actor_name` | varchar(255) | YES | | Actor display name |
| `is_read` | boolean | YES | false | Whether read |
| `created_at` | timestamptz | YES | now() | Creation timestamp |

### Constraints

```sql
PRIMARY KEY (id)
FOREIGN KEY (user_id) REFERENCES invoice_users(id) ON DELETE CASCADE
```

### Indexes

```sql
idx_notifications_user_all ON (user_id, created_at DESC)
idx_notifications_user_unread ON (user_id, is_read, created_at DESC) WHERE is_read = false
```

---

## Table 7: `invoice_data_sources`

Email/SFTP ingestion configuration for automatic invoice processing.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | serial | Primary key |
| `name` | varchar(255) | NO | | Source name |
| `email_address` | varchar(255) | NO | | Unique email for ingestion |
| `status` | varchar(20) | NO | 'active' | Source status |
| `vendor_hint` | varchar(100) | YES | | Expected vendor |
| `auto_process` | boolean | NO | true | Auto-process invoices |
| `description` | text | YES | | Description |
| `connection_type` | varchar(20) | YES | 'webhook' | Connection type |
| `host` | varchar(255) | YES | | IMAP/SFTP host |
| `port` | integer | YES | | Connection port |
| `username` | varchar(255) | YES | | Connection username |
| `encrypted_password` | text | YES | | Encrypted password |
| `encryption_iv` | text | YES | | Encryption IV |
| `folder_path` | varchar(255) | YES | | Folder path |
| `use_ssl` | boolean | YES | true | Use SSL |
| `poll_interval_minutes` | integer | YES | 15 | Poll interval |
| `last_poll_at` | timestamptz | YES | | Last poll time |
| `next_poll_at` | timestamptz | YES | | Next poll time |
| `created_by` | integer | YES | | User ID who created |
| `last_received_at` | timestamptz | YES | | Last email received |
| `total_emails_received` | integer | NO | 0 | Total emails received |
| `total_invoices_processed` | integer | NO | 0 | Total invoices processed |
| `created_at` | timestamptz | NO | now() | Creation timestamp |
| `updated_at` | timestamptz | NO | now() | Last update timestamp |

### Constraints

```sql
PRIMARY KEY (id)
UNIQUE (email_address)
CHECK valid_status: status IN ('active', 'paused', 'archived')
```

---

## Table 8: `invoice_data_source_logs`

Activity logs for email/SFTP ingestion events.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | integer | NO | serial | Primary key |
| `data_source_id` | integer | NO | | FK to invoice_data_sources |
| `event_type` | varchar(50) | NO | | Event type |
| `from_email` | varchar(255) | YES | | Sender email |
| `subject` | varchar(500) | YES | | Email subject |
| `received_at` | timestamptz | NO | now() | When received |
| `file_name` | varchar(255) | YES | | Attachment filename |
| `file_path` | varchar(500) | YES | | File storage path |
| `file_size` | integer | YES | | File size in bytes |
| `file_type` | varchar(50) | YES | | File type |
| `status` | varchar(20) | NO | | Processing status |
| `invoice_extraction_id` | integer | YES | | FK to invoice_extractions |
| `error_message` | text | YES | | Error message |
| `raw_headers` | jsonb | YES | | Raw email headers |
| `source_identifier` | varchar(512) | YES | | Source identifier (message-id) |
| `created_at` | timestamptz | NO | now() | Creation timestamp |

### Constraints

```sql
PRIMARY KEY (id)
FOREIGN KEY (data_source_id) REFERENCES invoice_data_sources(id) ON DELETE CASCADE
```

### Indexes

```sql
idx_data_source_logs_source_identifier ON (data_source_id, source_identifier)
```

---

## Enum Values Reference

### `document_type`
| Value | Description |
|-------|-------------|
| `shipping_invoice` | Standard shipping invoice |
| `credit_note` | Credit note/refund |
| `surcharge_invoice` | Additional charges invoice |
| `correction` | Invoice correction |
| `proforma` | Proforma invoice |

### `status` (invoice)
| Value | Description |
|-------|-------------|
| `pending` | Awaiting processing |
| `processing` | Currently being processed |
| `review` | Needs manual review |
| `approved` | Approved for payment |
| `on_hold` | On hold |
| `rejected` | Rejected |

### `payment_status`
| Value | Description |
|-------|-------------|
| `unpaid` | Not yet paid |
| `partial` | Partially paid |
| `paid` | Fully paid |
| `refunded` | Refunded |

### `line_item_type`
| Value | Description |
|-------|-------------|
| `shipment` | Regular shipment charge |
| `surcharge` | Additional surcharge |
| `credit` | Credit/refund |
| `adjustment` | Adjustment to previous charge |
| `fee` | Miscellaneous fee |

### `adjustment_type`
| Value | Description |
|-------|-------------|
| `credit` | Credit adjustment |
| `debit` | Debit adjustment |
| `refund` | Refund |
| `correction` | Correction |

### `extraction_source`
| Value | Description |
|-------|-------------|
| `pdf_ocr` | Extracted from PDF via OCR |
| `csv_parser` | Parsed from CSV file |
| `manual` | Manually entered |

### `file_source`
| Value | Description |
|-------|-------------|
| `upload` | Manual upload |
| `email` | Email ingestion |
| `webhook` | Webhook |
| `api` | API upload |
| `auto_ingest` | Automatic ingestion |
| `sftp` | SFTP download |

### `notification_type`
| Value | Description |
|-------|-------------|
| `assignment` | Invoice assigned |
| `mention` | User mentioned |

### `data_source_status`
| Value | Description |
|-------|-------------|
| `active` | Actively processing |
| `paused` | Temporarily paused |
| `archived` | No longer in use |

---

## Entity Relationship Diagram

```
                                    ┌─────────────────────┐
                                    │   invoice_users     │
                                    │─────────────────────│
                                    │ id (PK)             │
                                    │ email (UNIQUE)      │
                                    │ password_hash       │
                                    │ name                │
                                    │ role                │
                                    └──────────┬──────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
        ┌───────────────────┐    ┌───────────────────────┐    ┌───────────────────┐
        │invoice_notifications│    │   invoice_threads     │    │                   │
        │───────────────────│    │───────────────────────│    │                   │
        │ id (PK)           │    │ id (PK)               │    │                   │
        │ user_id (FK)      │    │ entity_id (FK)        │────┼───────────┐       │
        │ entity_id         │    │ author_id             │    │           │       │
        │ type              │    │ content               │    │           │       │
        └───────────────────┘    │ mentioned_user_ids[]  │    │           │       │
                                 └───────────────────────┘    │           │       │
                                                              │           │       │
┌─────────────────────┐                                       │           │       │
│  invoice_files      │                                       │           │       │
│─────────────────────│                                       │           ▼       │
│ id (PK)             │◄──────────────────────────────────────┼──┌────────────────┴───────┐
│ file_type           │                                       │  │  invoice_extractions   │
│ file_name           │                                       │  │────────────────────────│
│ file_hash (UNIQUE)  │                                       │  │ id (PK)                │
│ s3_key              │                                       │  │ file_id (FK)           │
│ local_path          │                                       │  │ parent_invoice_id (FK) │──┐
│ source              │                                       │  │ invoice_number         │  │
│ status              │                                       │  │ vendor                 │  │
└─────────────────────┘                                       │  │ net_amount             │  │
                                                              │  │ gross_amount           │  │
                                                              │  │ status                 │  │
                                                              │  │ payment_status         │  │
                                                              │  │ data_source_id (FK)    │  │
                                                              │  │ assigned_to            │  │
                                                              │  └────────────┬───────────┘  │
                                                              │               │              │
                                                              │               │◄─────────────┘
                                                              │               │ self-ref
                                                              │               │
                                                              │               ▼
┌─────────────────────┐       ┌─────────────────────┐        │  ┌────────────────────────┐
│invoice_data_sources │◄──────│invoice_data_source  │        │  │  invoice_line_items    │
│─────────────────────│       │       _logs         │        │  │────────────────────────│
│ id (PK)             │       │─────────────────────│        │  │ id (PK)                │
│ name                │       │ id (PK)             │        │  │ invoice_id (FK)        │◄─┘
│ email_address       │       │ data_source_id (FK) │        │  │ original_line_item_id  │──┐
│ status              │       │ event_type          │        │  │ shipment_number        │  │
│ connection_type     │       │ invoice_extraction_id│───────┘  │ vendor                 │  │
│ host                │       │ status              │           │ net_amount             │  │
│ poll_interval       │       └─────────────────────┘           │ gross_amount           │  │
└─────────────────────┘                                         │ line_item_type         │  │
                                                                └────────────────────────┘  │
                                                                             │              │
                                                                             │◄─────────────┘
                                                                             self-ref
```

---

## Database Connection

```typescript
// PostgreSQL (Primary - All invoice tables)
const pool = new Pool({
  connectionString: process.env.NEON_POSTGRES_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// MySQL (Legacy - buycycle main app data only, not used for invoicing)
// Used for: orders, users, products, bikes, shipments (BLS)
const mainPool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: 'buycycle',
  connectionLimit: 50,
});
```
