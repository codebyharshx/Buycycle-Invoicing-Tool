# Invoice System Database & Flow Redesign Plan

## Overview

Redesign the invoicing tool database schema and data flow to support:
- Multiple invoice types per carrier (shipping, credit note, surcharge)
- Unified line items storage with carrier-specific data in JSONB
- Credit note linking to original invoices (both invoice and line item level)
- Description field extraction for PDF invoices
- Full data extraction with consolidated view for accounting

---

## 1. Database Schema Changes

### 1.1 Main Invoice Table (ALTER existing)

**Table: `support_logistics_invoice_extractions`**

```sql
-- NEW COLUMNS TO ADD:
ALTER TABLE support_logistics_invoice_extractions ADD COLUMN (
  -- Document categorization
  document_type_normalized  VARCHAR(50),      -- 'shipping_invoice' | 'credit_note' | 'surcharge_invoice' | 'correction'
  document_type_raw         VARCHAR(255),     -- Original text from PDF: 'Gutschrift', 'CREDIT NOTE', etc.

  -- Invoice linking (for credit notes)
  parent_invoice_id         INT NULL,         -- FK to original invoice this credit/adjustment refers to
  parent_invoice_number     VARCHAR(100),     -- Original invoice number (for cross-reference when parent_id unknown)

  -- Line items summary
  total_line_items          INT DEFAULT 0,    -- Count of line items extracted
  line_items_source         VARCHAR(20),      -- 'pdf_ocr' | 'csv_parser' | 'hybrid' | 'manual'

  -- Description/notes from invoice
  invoice_description       TEXT,             -- Any explanatory text/remarks from the invoice

  -- Processing metadata
  extraction_completed_at   TIMESTAMP,        -- When line item extraction finished

  FOREIGN KEY (parent_invoice_id) REFERENCES support_logistics_invoice_extractions(id) ON DELETE SET NULL
);

-- INDEX for credit note queries
CREATE INDEX idx_invoice_parent ON support_logistics_invoice_extractions(parent_invoice_id);
CREATE INDEX idx_invoice_document_type ON support_logistics_invoice_extractions(document_type_normalized);
```

### 1.2 Line Items Table (ALTER existing)

**Table: `support_logistics_invoice_line_items`**

```sql
-- NEW COLUMNS TO ADD:
ALTER TABLE support_logistics_invoice_line_items ADD COLUMN (
  -- Carrier identification
  carrier                   VARCHAR(50),      -- Normalized carrier name: 'UPS', 'DHL', 'GLS', etc.

  -- Description field (KEY REQUIREMENT)
  description               TEXT,             -- Free-text description/notes for this line item
  line_item_type            VARCHAR(30),      -- 'shipment' | 'surcharge' | 'credit' | 'adjustment' | 'fee'

  -- Credit note linking
  adjustment_type           VARCHAR(20),      -- 'credit' | 'debit' | 'refund' | 'correction' | NULL
  original_line_item_id     INT NULL,         -- FK to original line item this credit adjusts
  original_shipment_number  VARCHAR(100),     -- Reference to match when original_line_item_id unknown

  -- Data source tracking
  extraction_source         VARCHAR(20),      -- 'pdf_ocr' | 'csv_parser' | 'manual_entry'

  -- Carrier-specific data (JSONB for flexibility)
  carrier_raw_data          JSON,             -- All carrier-specific columns not in common schema
  carrier_metadata          JSON,             -- Parsing metadata (row number, confidence, etc.)

  -- Audit fields
  extracted_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (original_line_item_id) REFERENCES support_logistics_invoice_line_items(id) ON DELETE SET NULL
);

-- INDEXES
CREATE INDEX idx_line_items_carrier ON support_logistics_invoice_line_items(carrier);
CREATE INDEX idx_line_items_shipment ON support_logistics_invoice_line_items(shipment_number);
CREATE INDEX idx_line_items_adjustment ON support_logistics_invoice_line_items(adjustment_type);
CREATE INDEX idx_line_items_original ON support_logistics_invoice_line_items(original_line_item_id);
CREATE INDEX idx_line_items_booking_date ON support_logistics_invoice_line_items(booking_created_date);
```

### 1.3 Common Line Item Columns (Keep Existing ~40 Columns)

These remain unchanged - they are the "consolidated view" columns:

| Column | Purpose | Used In Consolidated View |
|--------|---------|--------------------------|
| `shipment_number` | Tracking/AWB | Yes |
| `shipment_date` | Transaction date | Yes |
| `booking_created_date` | For accounting buckets | Yes |
| `shipment_reference_1/2` | Order IDs | Yes |
| `product_name` | Service type | Yes |
| `weight_kg` | Billed weight | Yes |
| `origin_country_name` | From country | Yes |
| `destination_country_name` | To country | Yes |
| `net_amount` | Charge before tax | Yes |
| `gross_amount` | Total charge | Yes |
| `base_price` | Base shipping cost | Yes |
| `total_extra_charges` | Surcharges sum | Yes |
| `xc1-xc9 name/charge` | Extra charge breakdown | Yes |

### 1.4 JSONB `carrier_raw_data` Contents

All carrier-specific columns that don't fit common schema:

**UPS (90+ columns -> JSONB):**
```json
{
  "lead_shipment_number": "...",
  "charge_category": "FRT",
  "charge_description_code": "GND",
  "entered_weight": 5.2,
  "entered_weight_uom": "L",
  "billed_weight_type": "Dimensional",
  "package_dimensions": "10x12x15",
  "sender_state": "CA",
  "receiver_state": "NY",
  "invoice_amount": 1234.56,
  "record_type": "SHP"
}
```

**DHL (155 columns -> JSONB):**
```json
{
  "line_type": "S",
  "weight_flag": "A",
  "xc1_code": "FF",
  "xc1_tax_code": "...",
  "xc1_discount": 0,
  "xc1_total": 12.50
}
```

---

## 2. Document Type Handling

### 2.1 Normalized Document Types

| `document_type_normalized` | Description | Amount Sign | Links To Original? |
|---------------------------|-------------|-------------|-------------------|
| `shipping_invoice` | Regular shipping charges | Positive | No (is the original) |
| `credit_note` | Refund/correction reducing amount owed | Negative | **Yes** - invoice + line items |
| `surcharge_invoice` | Additional charges (oversize, DIM weight, customs) | Positive | **Yes** - invoice + line items |
| `correction` | Adjustment to previous invoice | +/- | **Yes** - invoice + line items |
| `proforma` | Quote/estimate (non-billable) | N/A | No |

**All non-shipping invoice types link to originals at TWO levels:**
1. **Invoice level**: `parent_invoice_id` -> original shipping invoice
2. **Line item level**: `original_line_item_id` -> original shipment line item

This allows querying:
- "Show all adjustments to invoice #12345" (invoice-level links)
- "Show all credits/surcharges for shipment 1Z999ABC" (line-item-level links)

### 2.2 Vendor Mapping Extension

Extend `VENDOR_MAPPINGS` in `vendor-mappings.ts`:

```typescript
export interface VendorMapping {
  // ... existing fields ...

  // NEW: Document type detection
  documentTypePatterns: {
    creditNote: string[];      // ['Gutschrift', 'CREDIT NOTE', 'Korrektur']
    surcharge: string[];       // ['Zuschlag', 'SURCHARGE', 'Additional']
    correction: string[];      // ['Berichtigung', 'ADJUSTMENT']
  };

  // NEW: Line item field mappings for PDF extraction
  lineItemMappings?: {
    description: string[];     // ['Beschreibung', 'Description', 'Remarks']
    trackingNumber: string[];  // ['Sendungsnummer', 'Tracking', 'AWB']
    reference: string[];       // ['Referenz', 'Reference', 'Order']
    amount: string[];          // ['Betrag', 'Amount', 'Netto']
    // ... other line item fields
  };
}
```

---

## 3. Data Flow

### 3.1 Invoice Ingestion Flow

```
+---------------------------------------------------------------------+
|                        INVOICE RECEIVED                              |
|                    (Email / API / Manual Upload)                     |
+-----------------------------------+---------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                      STEP 1: FILE DETECTION                          |
|  - Detect file type (PDF / CSV / Both)                               |
|  - Detect vendor from filename or content                            |
|  - Detect document type (invoice / credit note / surcharge)          |
+-----------------------------------+---------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                    STEP 2: HEADER EXTRACTION                         |
|  INSERT INTO support_logistics_invoice_extractions:                  |
|  - vendor, invoice_number, amounts                                   |
|  - document_type_normalized, document_type_raw                       |
|  - invoice_description (if found)                                    |
|  - status = 'pending'                                                |
|  - line_items_source = 'pdf_ocr' | 'csv_parser' | 'hybrid'          |
+-----------------------------------+---------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                   STEP 3: LINE ITEM EXTRACTION                       |
|                                                                      |
|  +---------------+    +---------------+    +---------------+         |
|  |  PDF Invoice  |    | CSV Invoice   |    |  PDF + CSV    |         |
|  |  (1-2 items)  |    | (100+ items)  |    |  (Hybrid)     |         |
|  +-------+-------+    +-------+-------+    +-------+-------+         |
|          |                    |                    |                 |
|          v                    v                    v                 |
|  +-------------------------------------------------------------+    |
|  |  INSERT INTO support_logistics_invoice_line_items:          |    |
|  |  - Common columns (shipment_number, amounts, etc.)          |    |
|  |  - carrier = normalized vendor name                         |    |
|  |  - description = extracted from PDF/CSV                     |    |
|  |  - line_item_type = 'shipment' | 'surcharge' | 'credit'    |    |
|  |  - extraction_source = 'pdf_ocr' | 'csv_parser'            |    |
|  |  - carrier_raw_data = {all carrier-specific columns}       |    |
|  +-------------------------------------------------------------+    |
+-----------------------------------+---------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|              STEP 4: INVOICE LINKING (All Non-Shipping Types)        |
|  IF document_type IN ('credit_note', 'surcharge_invoice', 'correction'): |
|    - Search for original invoice by invoice_reference               |
|    - Search line items by shipment_number/description               |
|    - SET parent_invoice_id on invoice record                        |
|    - SET original_line_item_id on line item records                 |
|    - SET adjustment_type based on document type:                    |
|        credit_note -> 'credit' (amounts NEGATIVE)                   |
|        surcharge_invoice -> 'debit' (amounts POSITIVE)              |
|        correction -> 'correction' (amounts +/-)                     |
+-----------------------------------+---------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                    STEP 5: UPDATE INVOICE                            |
|  UPDATE support_logistics_invoice_extractions:                       |
|  - total_line_items = COUNT of inserted line items                  |
|  - extraction_completed_at = NOW()                                  |
|  - status = 'pending' (ready for review)                            |
+---------------------------------------------------------------------+
```

### 3.2 Invoice Linking Logic (All Types)

Applies to: `credit_note`, `surcharge_invoice`, `correction`

```typescript
async function linkInvoiceToOriginal(
  invoiceId: number,
  documentType: 'credit_note' | 'surcharge_invoice' | 'correction',
  lineItems: LineItem[]
) {
  // Determine adjustment type based on document type
  const adjustmentType = {
    'credit_note': 'credit',      // Negative amounts
    'surcharge_invoice': 'debit', // Positive amounts (additional charges)
    'correction': 'correction',   // Can be +/-
  }[documentType];

  // 1. Find parent invoice (INVOICE LEVEL linking)
  const parentInvoice = await findOriginalInvoice({
    referenceNumber: lineItems[0].description, // May contain original invoice ref
    vendor: invoice.vendor,
    dateRange: { from: -90days, to: invoice.date } // Look back 90 days
  });

  if (parentInvoice) {
    await updateInvoice(invoiceId, { parent_invoice_id: parentInvoice.id });
  }

  // 2. Link individual line items (LINE ITEM LEVEL linking)
  for (const item of lineItems) {
    const originalItem = await findOriginalLineItem({
      shipmentNumber: item.shipment_number || item.original_shipment_number,
      description: item.description,
      carrier: item.carrier
    });

    if (originalItem) {
      await updateLineItem(item.id, {
        original_line_item_id: originalItem.id,
        adjustment_type: adjustmentType  // 'credit', 'debit', or 'correction'
      });
    }
  }
}

// Example: Surcharge invoice for oversize shipment
// surcharge_invoice -> parent_invoice_id -> original shipping_invoice
//   +-- surcharge_line_item -> original_line_item_id -> original shipment line
//       (adjustment_type = 'debit', net_amount = +25.00)
```

---

## 4. Vendor Mapping Updates

### 4.1 Files to Modify

**`backend/src/services/invoice-ocr/vendor-mappings.ts`**

Add to each vendor mapping:

```typescript
'dhl': {
  // ... existing fields ...

  documentTypePatterns: {
    creditNote: ['Gutschrift', 'CREDIT', 'Credit Note', 'Korrektur'],
    surcharge: ['Zuschlag', 'SURCHARGE', 'Zusatzgebuehr'],
    correction: ['Berichtigung', 'ADJUSTMENT', 'Anpassung'],
  },

  lineItemMappings: {
    description: ['Beschreibung', 'Description', 'Bemerkung', 'Comments'],
    trackingNumber: ['Sendungsnummer', 'Shipment Number', 'AWB', 'Tracking'],
    reference: ['Referenz', 'Reference', 'Kundenreferenz', 'Customer Ref'],
    serviceType: ['Produkt', 'Product', 'Service'],
    chargeType: ['Gebuehrenart', 'Charge Type', 'Leistungsart'],
  },
},
```

### 4.2 Description Field Extraction

Add to OCR extraction prompts (Gemini, Mistral):

```
For each line item, also extract:
- description: Any explanatory text, remarks, or notes for this shipment/charge
- charge_type: Type of charge (e.g., 'Fuel Surcharge', 'Weight Adjustment', 'Credit')

For CREDIT NOTES specifically:
- Look for references to original invoice numbers
- Look for original shipment/tracking numbers being credited
- Extract the reason for credit if stated
```

---

## 5. API Changes

### 5.1 New/Updated Endpoints

| Method | Endpoint | Change |
|--------|----------|--------|
| `PATCH` | `/extractions/:id` | Add `parent_invoice_id` field |
| `GET` | `/extractions/:id/linked` | NEW: Get all linked invoices (credits, adjustments) |
| `GET` | `/line-items/:id/history` | NEW: Get adjustment history for a line item |
| `POST` | `/extractions/:id/link` | NEW: Manually link credit note to original |

### 5.2 Response Updates

```typescript
// InvoiceExtractionRecord additions
interface InvoiceExtractionRecord {
  // ... existing fields ...

  document_type_normalized: 'shipping_invoice' | 'credit_note' | 'surcharge_invoice' | 'correction';
  document_type_raw: string | null;
  parent_invoice_id: number | null;
  parent_invoice_number: string | null;
  invoice_description: string | null;
  total_line_items: number;
  line_items_source: 'pdf_ocr' | 'csv_parser' | 'hybrid' | 'manual';

  // Populated on detail view
  linked_invoices?: InvoiceExtractionRecord[]; // Credit notes linked to this invoice
  parent_invoice?: InvoiceExtractionRecord;     // Original invoice if this is a credit
}

// InvoiceLineItem additions
interface InvoiceLineItem {
  // ... existing fields ...

  carrier: string;
  description: string | null;
  line_item_type: 'shipment' | 'surcharge' | 'credit' | 'adjustment' | 'fee';
  adjustment_type: 'credit' | 'debit' | 'refund' | 'correction' | null;
  original_line_item_id: number | null;
  original_shipment_number: string | null;
  extraction_source: 'pdf_ocr' | 'csv_parser' | 'manual_entry';
  carrier_raw_data: Record<string, unknown>;

  // Populated on detail view
  original_line_item?: InvoiceLineItem;  // Original if this is an adjustment
  adjustments?: InvoiceLineItem[];        // Credits/adjustments to this item
}
```

---

## 6. Shared Types Updates

### 6.1 Files to Modify

**`shared/types/src/invoice-ocr.ts`**

```typescript
// Add document type enum
export type InvoiceDocumentType =
  | 'shipping_invoice'
  | 'credit_note'
  | 'surcharge_invoice'
  | 'correction'
  | 'proforma';

// Add line item type enum
export type LineItemType =
  | 'shipment'
  | 'surcharge'
  | 'credit'
  | 'adjustment'
  | 'fee';

// Add adjustment type enum
export type AdjustmentType =
  | 'credit'
  | 'debit'
  | 'refund'
  | 'correction';

// Add extraction source enum
export type ExtractionSource =
  | 'pdf_ocr'
  | 'csv_parser'
  | 'manual_entry';

// Update OCRLineItem
export interface OCRLineItem {
  // ... existing fields ...

  description?: string;
  line_item_type?: LineItemType;
  adjustment_type?: AdjustmentType;
  original_shipment_number?: string;
  carrier_raw_data?: Record<string, unknown>;
}

// Update InvoiceData
export interface InvoiceData {
  // ... existing fields ...

  document_type_normalized?: InvoiceDocumentType;
  invoice_description?: string;
  parent_invoice_number?: string;
}
```

---

## 7. Migration Steps

### 7.1 Database Migrations (In Order)

```sql
-- Migration 1: Add columns to invoice_extractions
ALTER TABLE support_logistics_invoice_extractions
ADD COLUMN document_type_normalized VARCHAR(50),
ADD COLUMN document_type_raw VARCHAR(255),
ADD COLUMN parent_invoice_id INT NULL,
ADD COLUMN parent_invoice_number VARCHAR(100),
ADD COLUMN total_line_items INT DEFAULT 0,
ADD COLUMN line_items_source VARCHAR(20),
ADD COLUMN invoice_description TEXT,
ADD COLUMN extraction_completed_at TIMESTAMP;

-- Migration 2: Add columns to line_items
ALTER TABLE support_logistics_invoice_line_items
ADD COLUMN carrier VARCHAR(50),
ADD COLUMN description TEXT,
ADD COLUMN line_item_type VARCHAR(30),
ADD COLUMN adjustment_type VARCHAR(20),
ADD COLUMN original_line_item_id INT NULL,
ADD COLUMN original_shipment_number VARCHAR(100),
ADD COLUMN extraction_source VARCHAR(20),
ADD COLUMN carrier_raw_data JSON,
ADD COLUMN carrier_metadata JSON,
ADD COLUMN extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Migration 3: Add indexes
CREATE INDEX idx_invoice_parent ON support_logistics_invoice_extractions(parent_invoice_id);
CREATE INDEX idx_invoice_document_type ON support_logistics_invoice_extractions(document_type_normalized);
CREATE INDEX idx_line_items_carrier ON support_logistics_invoice_line_items(carrier);
CREATE INDEX idx_line_items_adjustment ON support_logistics_invoice_line_items(adjustment_type);
CREATE INDEX idx_line_items_original ON support_logistics_invoice_line_items(original_line_item_id);

-- Migration 4: Add foreign keys
ALTER TABLE support_logistics_invoice_extractions
ADD CONSTRAINT fk_parent_invoice
FOREIGN KEY (parent_invoice_id) REFERENCES support_logistics_invoice_extractions(id) ON DELETE SET NULL;

ALTER TABLE support_logistics_invoice_line_items
ADD CONSTRAINT fk_original_line_item
FOREIGN KEY (original_line_item_id) REFERENCES support_logistics_invoice_line_items(id) ON DELETE SET NULL;

-- Migration 5: Backfill existing data
UPDATE support_logistics_invoice_line_items li
JOIN support_logistics_invoice_extractions ie ON li.invoice_extraction_id = ie.id
SET li.carrier = JSON_UNQUOTE(JSON_EXTRACT(ie.consensus_data, '$.vendor')),
    li.extraction_source = CASE
      WHEN ie.csv_file_path IS NOT NULL THEN 'csv_parser'
      ELSE 'pdf_ocr'
    END;

UPDATE support_logistics_invoice_extractions
SET document_type_normalized = CASE
      WHEN LOWER(JSON_UNQUOTE(JSON_EXTRACT(consensus_data, '$.document_type'))) LIKE '%credit%' THEN 'credit_note'
      WHEN LOWER(JSON_UNQUOTE(JSON_EXTRACT(consensus_data, '$.document_type'))) LIKE '%gutschrift%' THEN 'credit_note'
      ELSE 'shipping_invoice'
    END,
    document_type_raw = JSON_UNQUOTE(JSON_EXTRACT(consensus_data, '$.document_type')),
    line_items_source = CASE
      WHEN csv_file_path IS NOT NULL THEN 'csv_parser'
      WHEN has_line_items = 1 THEN 'pdf_ocr'
      ELSE NULL
    END;
```

---

## 8. Per-Carrier Consolidated Views

### 8.1 Approach: Database VIEWs

Create separate SQL VIEWs per carrier that extract important columns from JSONB into proper columns.

**Benefits:**
- Real-time (always up-to-date with base table)
- No data duplication
- Type-safe column access
- Easy to modify column list later
- Works with existing SQL tools and exports

### 8.1.1 How VIEWs Work with Frontend

**VIEWs work exactly like regular tables** - the frontend doesn't know the difference:

```
+--------------+      +----------------------+      +---------------------+
|  Frontend    | -->  |  Backend API         | -->  |  MySQL VIEW         |
|  fetch()     |      |  SELECT * FROM view  |      |  (executes query)   |
+--------------+      +----------------------+      +---------------------+
                               |                              |
                               v                              v
                      Returns JSON array           Extracts JSONB->columns
                      with proper columns          on-the-fly
```

**Frontend code (unchanged from normal table queries):**
```typescript
// Frontend component
const { data } = await fetch('/api/invoice-ocr/line-items/consolidated/ups');
// data = [{ tracking_number: '1Z999...', net_charge: 45.50, weight_type: 'Dimensional', ... }]

// Use exactly like any other API response
data.map(row => (
  <tr key={row.id}>
    <td>{row.tracking_number}</td>
    <td>{row.net_charge}</td>
    <td>{row.weight_type}</td>
  </tr>
));
```

**Backend API (queries VIEW like a table):**
```typescript
// SELECT from VIEW - MySQL handles the JSONB extraction
const [rows] = await pool.query('SELECT * FROM ups_consolidated_view WHERE shipment_date > ?', [dateFrom]);
res.json({ data: rows }); // Returns normal JSON
```

The VIEW executes the `JSON_EXTRACT()` calls internally - the result is a standard row set with proper column names.

### 8.2 Configuration File (Define Important Columns)

Create a configuration file to define which columns to extract per carrier:

**File: `backend/src/config/carrier-consolidated-columns.ts`**

```typescript
export interface ConsolidatedColumnConfig {
  // Source: either common column name or JSON path in carrier_raw_data
  source: string;
  // Display name for the column in VIEW
  displayName: string;
  // SQL type for casting
  sqlType: 'VARCHAR(255)' | 'DECIMAL(15,2)' | 'INT' | 'DATE' | 'TEXT';
  // Whether this is from JSONB (true) or common column (false)
  fromJsonb: boolean;
}

export interface CarrierViewConfig {
  carrier: string;
  viewName: string;
  columns: ConsolidatedColumnConfig[];
}

export const CARRIER_VIEW_CONFIGS: CarrierViewConfig[] = [
  {
    carrier: 'UPS',
    viewName: 'ups_consolidated_view',
    columns: [
      // Common columns (already in table)
      { source: 'shipment_number', displayName: 'tracking_number', sqlType: 'VARCHAR(255)', fromJsonb: false },
      { source: 'shipment_date', displayName: 'pickup_date', sqlType: 'DATE', fromJsonb: false },
      { source: 'net_amount', displayName: 'net_charge', sqlType: 'DECIMAL(15,2)', fromJsonb: false },
      { source: 'weight_kg', displayName: 'billed_weight', sqlType: 'DECIMAL(15,2)', fromJsonb: false },

      // JSONB columns (carrier-specific)
      { source: '$.entered_weight', displayName: 'entered_weight', sqlType: 'DECIMAL(15,2)', fromJsonb: true },
      { source: '$.billed_weight_type', displayName: 'weight_type', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.charge_description_code', displayName: 'charge_code', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.charge_description', displayName: 'charge_description', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.incentive_amount', displayName: 'discount', sqlType: 'DECIMAL(15,2)', fromJsonb: true },
      { source: '$.package_dimensions', displayName: 'dimensions', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.sender_state', displayName: 'origin_state', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.receiver_state', displayName: 'dest_state', sqlType: 'VARCHAR(255)', fromJsonb: true },
    ],
  },
  {
    carrier: 'DHL',
    viewName: 'dhl_consolidated_view',
    columns: [
      // Common columns
      { source: 'shipment_number', displayName: 'awb_number', sqlType: 'VARCHAR(255)', fromJsonb: false },
      { source: 'shipment_date', displayName: 'shipment_date', sqlType: 'DATE', fromJsonb: false },
      { source: 'net_amount', displayName: 'net_amount', sqlType: 'DECIMAL(15,2)', fromJsonb: false },
      { source: 'gross_amount', displayName: 'gross_amount', sqlType: 'DECIMAL(15,2)', fromJsonb: false },

      // JSONB columns (carrier-specific)
      { source: '$.weight_flag', displayName: 'weight_type', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.line_type', displayName: 'record_type', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.xc1_code', displayName: 'surcharge_1_code', sqlType: 'VARCHAR(255)', fromJsonb: true },
      { source: '$.xc1_total', displayName: 'surcharge_1_amount', sqlType: 'DECIMAL(15,2)', fromJsonb: true },
      // ... add more as needed
    ],
  },
  // Add more carriers as needed (GLS, Hive, Eurosender, etc.)
];
```

### 8.3 Generated SQL VIEWs

Auto-generate VIEWs from configuration:

**Example: UPS Consolidated View**

```sql
CREATE OR REPLACE VIEW ups_consolidated_view AS
SELECT
  -- Base identifiers
  li.id,
  li.invoice_extraction_id,
  ie.invoice_number,
  ie.document_type_normalized,

  -- Common columns (direct access)
  li.shipment_number AS tracking_number,
  li.shipment_date AS pickup_date,
  li.shipment_reference_1 AS order_reference,
  li.origin_country_name,
  li.destination_country_name,
  li.net_amount AS net_charge,
  li.gross_amount AS gross_charge,
  li.weight_kg AS billed_weight,
  li.base_price,
  li.total_extra_charges,
  li.description,
  li.adjustment_type,

  -- JSONB extracted columns (UPS-specific)
  CAST(JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.entered_weight')) AS DECIMAL(15,2)) AS entered_weight,
  JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.billed_weight_type')) AS weight_type,
  JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.charge_description_code')) AS charge_code,
  JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.charge_description')) AS charge_description,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.incentive_amount')) AS DECIMAL(15,2)) AS discount,
  JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.package_dimensions')) AS dimensions,
  JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.sender_state')) AS origin_state,
  JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.receiver_state')) AS dest_state,
  JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '$.record_type')) AS record_type,

  -- Metadata
  li.booking_created_date,
  li.extraction_source,
  li.extracted_at

FROM support_logistics_invoice_line_items li
JOIN support_logistics_invoice_extractions ie ON li.invoice_extraction_id = ie.id
WHERE li.carrier = 'UPS';
```

### 8.4 VIEW Generation Script

**File: `backend/src/scripts/generate-carrier-views.ts`**

```typescript
import { CARRIER_VIEW_CONFIGS } from '../config/carrier-consolidated-columns';
import { logsPool } from '../utils/db';

export async function generateCarrierViews(): Promise<void> {
  for (const config of CARRIER_VIEW_CONFIGS) {
    const columnSelects: string[] = [
      'li.id',
      'li.invoice_extraction_id',
      'ie.invoice_number',
      'ie.document_type_normalized',
    ];

    for (const col of config.columns) {
      if (col.fromJsonb) {
        // Extract from JSONB with type casting
        const jsonPath = col.source;
        const cast = col.sqlType !== 'VARCHAR(255)'
          ? `CAST(JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '${jsonPath}')) AS ${col.sqlType})`
          : `JSON_UNQUOTE(JSON_EXTRACT(li.carrier_raw_data, '${jsonPath}'))`;
        columnSelects.push(`${cast} AS ${col.displayName}`);
      } else {
        // Direct column access
        columnSelects.push(`li.${col.source} AS ${col.displayName}`);
      }
    }

    const sql = `
      CREATE OR REPLACE VIEW ${config.viewName} AS
      SELECT
        ${columnSelects.join(',\n        ')}
      FROM support_logistics_invoice_line_items li
      JOIN support_logistics_invoice_extractions ie ON li.invoice_extraction_id = ie.id
      WHERE li.carrier = '${config.carrier}'
    `;

    await logsPool.execute(sql);
    console.log(`Created view: ${config.viewName}`);
  }
}
```

### 8.5 API Endpoint for Consolidated View

**GET `/api/invoice-ocr/line-items/consolidated/:carrier`**

```typescript
// Returns data from the carrier-specific VIEW
router.get('/line-items/consolidated/:carrier', async (req, res) => {
  const { carrier } = req.params;
  const viewName = `${carrier.toLowerCase()}_consolidated_view`;

  const [rows] = await logsPool.execute(
    `SELECT * FROM ${viewName} ORDER BY shipment_date DESC LIMIT ? OFFSET ?`,
    [req.query.limit || 100, req.query.offset || 0]
  );

  res.json({ data: rows, carrier, viewName });
});
```

### 8.6 Export to Excel with Carrier Columns

The accounting export can use the VIEW directly:

```typescript
async function exportCarrierToExcel(carrier: string): Promise<ExcelJS.Workbook> {
  const viewName = `${carrier.toLowerCase()}_consolidated_view`;
  const [rows] = await logsPool.execute(`SELECT * FROM ${viewName}`);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(carrier);

  // Headers from first row keys
  if (rows.length > 0) {
    sheet.columns = Object.keys(rows[0]).map(key => ({
      header: key,
      key: key,
      width: 15,
    }));
    sheet.addRows(rows);
  }

  return workbook;
}
```

### 8.7 How to Add New Carrier Columns Later

1. Edit `carrier-consolidated-columns.ts` -> add new column to carrier config
2. Run `generateCarrierViews()` -> recreates VIEW with new columns
3. No database schema changes needed!

```typescript
// Example: Adding a new UPS column later
{
  source: '$.new_field_from_csv',
  displayName: 'new_column_name',
  sqlType: 'VARCHAR(255)',
  fromJsonb: true,
}
```

---

## 9. Files to Modify

| File | Changes |
|------|---------|
| `shared/types/src/invoice-ocr.ts` | Add new types, update interfaces |
| `backend/src/services/invoice-ocr/vendor-mappings.ts` | Add documentTypePatterns, lineItemMappings |
| `backend/src/services/invoice-ocr/extractors/gemini.ts` | Update prompt for description, document type |
| `backend/src/services/invoice-ocr/extractors/mistral.ts` | Update prompt for description, document type |
| `backend/src/services/invoice-ocr/parsers/csv-parser.ts` | Add carrier_raw_data population |
| `backend/src/services/invoice-ocr/index.ts` | Add credit note linking logic |
| `backend/src/routes/invoice-ocr.routes.ts` | Add new endpoints, update responses |
| `frontend/components/invoices/*` | Update UI to show document types, linked invoices |

---

## 10. Verification Plan

### 10.1 Unit Tests
- [ ] Test document type detection for each carrier
- [ ] Test credit note linking algorithm
- [ ] Test JSONB serialization/deserialization
- [ ] Test description extraction from PDFs

### 10.2 Integration Tests
- [ ] Upload PDF invoice -> verify line items extracted with description
- [ ] Upload CSV invoice -> verify carrier_raw_data populated
- [ ] Upload credit note -> verify linked to original invoice
- [ ] Verify accounting view shows correct totals with credits

### 10.3 Manual Testing
1. Upload a DHL shipping invoice (PDF + CSV) -> verify all columns in carrier_raw_data
2. Upload a DHL credit note -> verify links to original and has negative amounts
3. Check accounting view -> verify credits reduce totals correctly
4. Export to Excel -> verify all data present

---

## 11. Summary

| Change | Status |
|--------|--------|
| Add document_type columns to invoices | Planned |
| Add parent_invoice_id for credit linking | Planned |
| Add description to line_items | Planned |
| Add carrier_raw_data JSONB | Planned |
| Add adjustment_type and original_line_item_id | Planned |
| Extend vendor mappings for document types | Planned |
| Update OCR prompts for description extraction | Planned |
| Add credit note linking logic | Planned |
| Database migrations | Planned |
| API updates | Planned |

---

**Last Updated**: 2026-03-22
