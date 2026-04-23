# Buycycle Invoice OCR System - Comprehensive Report

**Generated:** 2026-03-19
**Version:** 1.0

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [End-to-End Flow](#2-end-to-end-flow)
3. [AI Models & Confidence Thresholds](#3-ai-models--confidence-thresholds)
4. [Carrier Summary](#4-carrier-summary)
5. [Carrier Schema Details](#5-carrier-schema-details)
6. [Database Structure](#6-database-structure)
7. [Data Usage & Accounting](#7-data-usage--accounting)
8. [Next Steps & Roadmap](#8-next-steps--roadmap)

---

## 1. System Overview

The Invoice OCR System automates the extraction, validation, and management of logistics invoices from multiple carriers. It uses a multi-model AI approach with consensus analysis to ensure accuracy.

### Key Features

- **Multi-Model AI Extraction**: Gemini, DeepSeek, Mistral with smart fallback
- **Hybrid PDF+CSV Processing**: Combines AI extraction with structured CSV data
- **Carrier-Specific Schemas**: Optimized prompts and field mappings per vendor
- **Confidence Scoring**: 90% threshold for extraction quality
- **Accounting View**: Monthly pivot tables for financial reconciliation
- **Email Ingestion**: Automated invoice processing via SendGrid

---

## 2. End-to-End Flow

### Step 1: Invoice Upload

```
┌─────────────────────────────────────────────────────────────┐
│                      UPLOAD SOURCES                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Manual Upload          Email Ingestion                    │
│   (Frontend)             (SendGrid Webhook)                 │
│       │                        │                            │
│       ▼                        ▼                            │
│   POST /api/              POST /api/webhooks/               │
│   invoice-ocr/extract     invoice-email                     │
│       │                        │                            │
│       └────────────┬───────────┘                            │
│                    ▼                                        │
│            Save PDF to Railway Volume                       │
│            /data/uploads/invoices/{timestamp}-{filename}    │
└─────────────────────────────────────────────────────────────┘
```

### Step 2: Vendor Detection

```
┌─────────────────────────────────────────────────────────────┐
│                    VENDOR DETECTION                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. Parse first page of PDF with pdf-parse                 │
│   2. Scan text for known vendor keywords:                   │
│      - "DHL", "UPS", "KARAMAC", "DS SMITH", etc.           │
│   3. Match against VENDOR_MAPPINGS aliases                  │
│   4. If CSV provided, detect vendor from filename           │
│                                                             │
│   Output: detectedVendor = "DHL" | "UPS" | null            │
└─────────────────────────────────────────────────────────────┘
```

### Step 3: Extraction Routing

```
┌─────────────────────────────────────────────────────────────┐
│                   EXTRACTION ROUTING                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Has CSV + Vendor supports CSV?                            │
│   (UPS, DHL, GLS, Hive, Eurosender, Sendcloud)             │
│        │                                                    │
│    YES │                    NO                              │
│        ▼                     │                              │
│   ┌─────────────┐            │   Is MRW?                    │
│   │ HYBRID MODE │            │      │                       │
│   │ PDF + CSV   │            │  YES │        NO             │
│   └─────────────┘            │      ▼         │             │
│                              │   ┌────────┐   ▼             │
│                              │   │ MRW    │  ┌────────────┐ │
│                              │   │ PDF    │  │ MULTI-MODEL│ │
│                              │   │ ONLY   │  │ EXTRACTION │ │
│                              │   └────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Step 4: AI Extraction (Multi-Model)

```
┌─────────────────────────────────────────────────────────────┐
│              MULTI-MODEL AI EXTRACTION                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Model Priority: Gemini → DeepSeek → Mistral               │
│   Confidence Threshold: 90%                                 │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Model 1: Gemini 2.5 Pro                             │   │
│   │   • Native PDF support                              │   │
│   │   • Vendor-specific prompt with field hints         │   │
│   │   • Structured JSON schema output                   │   │
│   └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│              Confidence >= 90%?                             │
│                    │                                        │
│              YES   │   NO                                   │
│               │    │    │                                   │
│               ▼    │    ▼                                   │
│            STOP    │  ┌─────────────────────────────────┐   │
│                    │  │ Model 2: DeepSeek OCR           │   │
│                    │  │   • Two-stage pipeline          │   │
│                    │  │   • Stage 1: DeepSeek OCR text  │   │
│                    │  │   • Stage 2: Gemini structures  │   │
│                    │  └─────────────────────────────────┘   │
│                    │                │                       │
│                    │                ▼                       │
│                    │     Confidence >= 90%?                 │
│                    │          │                             │
│                    │    YES   │   NO                        │
│                    │     │    │    │                        │
│                    │     ▼    │    ▼                        │
│                    │   STOP   │  ┌─────────────────────┐    │
│                    │          │  │ Model 3: Mistral    │    │
│                    │          │  │   • Dedicated OCR   │    │
│                    │          │  │   • Last resort     │    │
│                    │          │  └─────────────────────┘    │
│                    │          │                             │
└────────────────────┴──────────┴─────────────────────────────┘
```

### Step 5: Consensus Analysis

```
┌─────────────────────────────────────────────────────────────┐
│                  CONSENSUS ANALYSIS                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   For each field (vendor, invoice_number, amounts, etc.):   │
│                                                             │
│   1. Collect values from all models                         │
│   2. Calculate field consistency (% agreement)              │
│   3. Determine consensus value (majority vote)              │
│   4. Identify conflicts (models disagree)                   │
│   5. Mark missing fields (no model extracted)               │
│                                                             │
│   Output:                                                   │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ consensus_data: { vendor, amounts, dates, ... }     │   │
│   │ conflicts_data: { field: { gemini: X, mistral: Y }} │   │
│   │ missing_data: { field: "Not found in any model" }   │   │
│   │ confidence_score: 0-100                             │   │
│   │ review_needed: ["field1", "field2"]                 │   │
│   │ low_confidence_fields: ["field3"]                   │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Step 6: CSV Line Items Parsing (Hybrid Mode)

```
┌─────────────────────────────────────────────────────────────┐
│                CSV LINE ITEMS PARSING                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. Detect CSV format from headers                         │
│      • UPS: Headerless, 90+ columns, position-based         │
│      • DHL: Headers, 150+ columns, comma-delimited          │
│      • GLS: Headers, semicolon-delimited                    │
│      • Hive/Sendcloud: Headers, comma-delimited             │
│                                                             │
│   2. Parse using vendor-specific column mappings            │
│      • UPS_COLS.TRACKING_NUMBER = column 20                 │
│      • DHL_COLS.SHIPMENT_NUMBER = column 23                 │
│                                                             │
│   3. Group rows by tracking number                          │
│      • Base charge + surcharges → single line item          │
│      • Up to 9 extra charges (xc1-xc9)                      │
│                                                             │
│   4. Build OCRLineItem objects with:                        │
│      • shipment_number, shipment_date                       │
│      • origin/destination countries and postcodes           │
│      • net_amount, gross_amount, base_price                 │
│      • extra charges (fuel surcharge, insurance, etc.)      │
└─────────────────────────────────────────────────────────────┘
```

### Step 7: Database Storage

```
┌─────────────────────────────────────────────────────────────┐
│                   DATABASE STORAGE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   INSERT INTO support_logistics_invoice_extractions:        │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ file_name, file_path, file_size                     │   │
│   │ invoice_number (extracted)                          │   │
│   │ models_used: ["gemini", "deepseek"]                 │   │
│   │ confidence_score: 92.5                              │   │
│   │ consensus_data: { vendor, amounts, dates... }       │   │
│   │ conflicts_data: { ... }                             │   │
│   │ raw_results: { gemini: {...}, deepseek: {...} }     │   │
│   │ status: "pending"                                   │   │
│   │ has_line_items: true                                │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   INSERT INTO support_logistics_invoice_line_items:         │
│   (one row per shipment from CSV)                           │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ invoice_extraction_id, shipment_number              │   │
│   │ origin_country, destination_country                 │   │
│   │ net_amount, gross_amount, base_price                │   │
│   │ xc1_name: "Fuel Surcharge", xc1_charge: 12.50      │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Step 8: Review & Approval Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                 REVIEW & APPROVAL WORKFLOW                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Status Flow:                                              │
│                                                             │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ PENDING  │───▶│ APPROVED │───▶│   PAID   │             │
│   └──────────┘    └──────────┘    └──────────┘             │
│        │                                                    │
│        ▼                                                    │
│   ┌──────────┐                                              │
│   │ ON_HOLD  │  (needs manual review)                       │
│   └──────────┘                                              │
│        │                                                    │
│        ▼                                                    │
│   ┌──────────┐                                              │
│   │ REJECTED │  (invalid/duplicate)                         │
│   └──────────┘                                              │
│                                                             │
│   Review Actions:                                           │
│   • Edit consensus_data fields                              │
│   • Assign to agent                                         │
│   • Add tags (urgent, disputed, etc.)                       │
│   • Add notes via threads system                            │
│   • Re-upload CSV for line items                            │
│   • Set payment_date and payment_method                     │
└─────────────────────────────────────────────────────────────┘
```

### Step 9: Accounting & Export

```
┌─────────────────────────────────────────────────────────────┐
│                  ACCOUNTING & EXPORT                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Monthly Accounting View:                                  │
│   • Pivot table: Vendors × Months                           │
│   • Aggregates line items by booking_created_date           │
│   • Shows shipment counts and net amounts per month         │
│                                                             │
│   Export Options:                                           │
│   • CSV export of line items                                │
│   • Excel export with formatting                            │
│   • DATEV-compatible accounting format                      │
│                                                             │
│   Dashboard Stats:                                          │
│   • Open invoices: count, total net, total gross            │
│   • On-hold invoices                                        │
│   • Ready for payment                                       │
│   • Vendor breakdown                                        │
│   • Monthly heatmap                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. AI Models & Confidence Thresholds

### Models Used

| Model | Provider | Type | Use Case |
|-------|----------|------|----------|
| **Gemini 2.5 Pro** | Google | Vision LLM | Primary extractor, native PDF |
| **DeepSeek OCR** | Replicate | OCR + LLM | Two-stage pipeline for complex PDFs |
| **Mistral OCR** | Mistral AI | Dedicated OCR | Fallback for edge cases |
| **Claude 3.7 Sonnet** | OpenRouter | Vision LLM | Optional, not in default list |

### Confidence Thresholds

| Threshold | Value | Purpose |
|-----------|-------|---------|
| **Smart Fallback** | **90%** | Stop calling more models when confidence ≥ 90% |
| **Low Confidence Field** | **70%** | Fields below 70% are flagged for manual review |
| **Hybrid Mode** | **95%** | CSV data gives automatic 95% confidence |
| **MRW PDF-Only** | **90%** | Structured MRW extraction confidence |

### Confidence Score Calculation

```
Overall Confidence = Average of:
  • Field extraction rate (% of fields successfully extracted)
  • Cross-model agreement (% of fields where models agree)
  • Validation pass rate (% of fields passing format checks)
```

### Review Triggers

The system marks invoices for review when:
- `confidence_score < 90%`
- `low_confidence_fields.length > 0`
- `conflicts_data` has unresolved conflicts
- Critical fields missing (vendor, gross_amount, invoice_number)

---

## 4. Carrier Summary

### Total Carriers: 21

| # | Carrier | Country | Currency | CSV Support | Full Schema |
|---|---------|---------|----------|-------------|-------------|
| 1 | **DHL** | Germany | EUR | ✅ Yes | ✅ Yes |
| 2 | **UPS** | USA | EUR | ✅ Yes | ✅ Yes |
| 3 | **GLS** | Germany | EUR | ✅ Yes | ✅ Yes |
| 4 | **Hive** | Germany | EUR | ✅ Yes | ✅ Yes |
| 5 | **Eurosender** | EU | EUR | ✅ Yes | ⚠️ Partial |
| 6 | **Sendcloud** | Netherlands | EUR | ✅ Yes | ⚠️ Partial |
| 7 | **MRW** | Spain | EUR | ❌ PDF Only | ✅ Yes |
| 8 | **Wiechert** | Germany | EUR | ❌ No | ✅ Yes |
| 9 | **DS Smith** | Poland | EUR | ❌ No | ✅ Yes |
| 10 | **Karamac** | Poland | EUR | ❌ No | ✅ Yes |
| 11 | **Mimas** | Poland | PLN | ❌ No | ✅ Yes |
| 12 | **BRT** | Italy | EUR | ❌ No | ✅ Yes |
| 13 | **BikeExchange** | USA | USD | ❌ No | ✅ Yes |
| 14 | **Weltweitversenden** | Germany | EUR | ❌ No | ✅ Yes |
| 15 | **Red Stag** | USA | USD | ❌ No | ✅ Yes |
| 16 | **S2C (Sport & Events)** | Italy | EUR | ❌ No | ✅ Yes |
| 17 | **EasyLox** | Germany | EUR | ❌ No | ✅ Yes |
| 18 | **DPD** | Germany | EUR | ❌ No | ❌ No |
| 19 | **Cargoboard** | Germany | EUR | ❌ No | ❌ No |
| 20 | **Horna** | - | - | ❌ No | ❌ No |
| 21 | **Flowspace** | USA | USD | ❌ No | ❌ No |
| 22 | **Omnipack** | - | - | ❌ No | ❌ No |

### Summary

- **With Full Schema**: 15 carriers
- **With CSV Parsing**: 6 carriers
- **Without Schema (AI-only)**: 6 carriers

---

## 5. Carrier Schema Details

### Schema Structure

Each carrier schema in `vendor-mappings.ts` contains:

```typescript
interface VendorMapping {
  vendorName: string;           // Full legal name
  standardName: string;         // Normalized DB name
  aliases: string[];            // Name variations for detection
  country: string;
  currency: string;
  fieldMappings: {
    documentType: string[];     // Labels for document type
    netAmount: string[];        // Labels for net amount
    vatAmount: string[];        // Labels for VAT
    grossInvoiceAmount: string[];
    issueDate: string[];
    dueDate: string[];
    performancePeriod: string[];
    invoiceNumber: string[];
    customerNumber?: string[];
    orderNumber?: string[];
    paymentTerms?: string[];
  };
  specialNotes: string[];       // Extraction hints for AI
  examples: {
    invoiceNumber: string;      // Example format
    grossAmount: string;        // Example amount
  };
}
```

---

### DHL Express (Germany)

```yaml
Standard Name: DHL
Country: Germany
Currency: EUR
CSV Support: Yes (150+ columns)

Aliases:
  - DHL
  - DHL Express
  - DHL Express Germany GmbH
  - Deutsche Post DHL Group
  - DHL Paket GmbH

Field Mappings:
  Document Type: Invoice, Rechnung
  Net Amount: Net Amount, Nettobetrag, Total amount (excl. VAT)
  VAT Amount: VAT, MwSt., Mehrwertsteuer, Total Tax
  Gross Amount: Total, Gesamtbetrag, Total amount (incl. VAT)
  Issue Date: Invoice Date, Rechnungsdatum, Date
  Due Date: Due Date, Fälligkeitsdatum, Payment Due
  Invoice Number: Invoice Number, Rechnungsnummer, Invoice No.
  Customer Number: Account Number, Kundennummer, Customer No.

Special Notes:
  - DHL invoices often come with CSV line item details
  - CSV format: RAW (155 columns) or Template (39 columns)
  - Multiple shipments per invoice with individual tracking numbers
  - Extra charges (XC1-XC9) for fuel surcharges, customs, etc.

Example:
  Invoice Number: MUCIR00169682
  Gross Amount: €5,275.29

CSV Column Mappings:
  LINE_TYPE: 0          # "I" = Invoice, "S" = Shipment
  INVOICE_NUMBER: 3
  INVOICE_DATE: 7
  SHIPMENT_NUMBER: 23
  SHIPMENT_DATE: 24
  SHIPMENT_REF_1: 27
  PRODUCT_NAME: 31
  PIECES: 32
  ORIGIN_COUNTRY_NAME: 36
  DESTINATION_COUNTRY_NAME: 49
  WEIGHT_KG: 68
  CURRENCY: 69
  NET_AMOUNT: 70
  GROSS_AMOUNT: 71
  XC1-XC9: columns 90-148
```

---

### UPS (United Parcel Service)

```yaml
Standard Name: UPS
Country: USA
Currency: EUR
CSV Support: Yes (90+ columns, headerless)

Aliases:
  - UPS
  - United Parcel Service
  - UPS Deutschland
  - UPS Germany
  - UPS Europe

Field Mappings:
  Document Type: Invoice
  Net Amount: Net Amount, Subtotal
  VAT Amount: VAT, Tax
  Gross Amount: Total, Amount Due
  Issue Date: Invoice Date
  Due Date: Due Date, Payment Due
  Invoice Number: Invoice Number, Invoice No.
  Customer Number: Account Number

Special Notes:
  - UPS invoices often come with CSV line item details
  - CSV has Shipment/Surcharge/Adjustment record types
  - American date format: Month DD, YYYY
  - Tracking numbers start with 1Z

Example:
  Invoice Number: 0000F12345678
  Gross Amount: $1,234.56

CSV Column Mappings:
  INVOICE_DATE: 4
  INVOICE_NUMBER: 5
  INVOICE_CURRENCY_CODE: 9
  INVOICE_AMOUNT: 10
  TRANSACTION_DATE: 11      # Pickup date
  LEAD_SHIPMENT_NUMBER: 13  # Fallback tracking
  SHIPMENT_REF_1: 15
  SHIPMENT_REF_2: 16
  TRACKING_NUMBER: 20       # Primary tracking
  ENTERED_WEIGHT: 26        # Weight at booking
  BILLED_WEIGHT: 28         # UPS measured weight
  RECORD_TYPE: 34           # SHP/ADJ
  CHARGE_CATEGORY: 43       # FRT/ACC/INF
  CHARGE_DESCRIPTION: 45
  INCENTIVE_AMOUNT: 51      # Contract discount
  NET_AMOUNT: 52
  SENDER_COUNTRY: 81
  RECEIVER_COUNTRY: 89
```

---

### GLS (General Logistics Systems)

```yaml
Standard Name: GLS
Country: Germany
Currency: EUR
CSV Support: Yes (semicolon-delimited)

Aliases:
  - GLS
  - GLS Germany
  - GLS Parcel
  - General Logistics Systems
  - GLS Group

Field Mappings:
  Document Type: Invoice, Rechnung
  Net Amount: Net Amount, Netto
  VAT Amount: VAT, MwSt.
  Gross Amount: Total, Gesamt
  Issue Date: Invoice Date, Rechnungsdatum
  Due Date: Due Date, Fälligkeitsdatum
  Invoice Number: Invoice Number, Document No.

Special Notes:
  - GLS invoices require CSV for line item details
  - CSV has Gepard Customer ID and Parcel Number columns
  - Multiple rows per shipment (base + surcharges)
  - Date format: DD.MM.YYYY

CSV Columns:
  - Gepard Customer ID
  - Document No.
  - Document Date
  - Parcel Number (tracking)
  - Date (shipment date)
  - Inv.- Weight kg
  - Net amount
  - Article Number (determines base vs surcharge)
  - Description
  - Reference(s) per parcel
  - Delivery Country (2-letter code)
  - Consignee Zipcode
  - Consignee City
```

---

### Hive Logistics

```yaml
Standard Name: Hive
Country: Germany
Currency: EUR
CSV Support: Yes

Aliases:
  - Hive
  - Hive Logistics
  - HIVE
  - Hive Fulfillment

Field Mappings:
  Document Type: Invoice
  Net Amount: Net Amount
  VAT Amount: VAT
  Gross Amount: Total
  Issue Date: Invoice Date
  Due Date: Due Date
  Invoice Number: Invoice Number

Special Notes:
  - Hive invoices require CSV for line item details
  - CSV has Shipment Reference, Shop Order ID, Hive Order ID columns

CSV Columns:
  - Shipment Reference
  - Shop Order ID
  - Hive Order ID
  - Shipment Date
  - Order Type
  - Destination Country
  - Carrier
  - Weight (kg)
  - Delivery Price (€)
  - B2C Fulfillment Price (€)
```

---

### Eurosender

```yaml
Standard Name: Eurosender
Country: EU
Currency: EUR
CSV Support: Yes (12 columns)

CSV Columns:
  0: Document name (invoice number)
  1: Order code (shipment reference)
  2: Order date (booking date)
  3: Pickup date
  4: Tracking number
  5: Service type
  6: Total calculated weight (kg)
  7: Pickup address
  8: Delivery address
  9: Total NET amount (invoice total)
  10: Packages NET total (line item price)
  11: Refund NET total

Special Notes:
  - Address format: "Street (-), City, Postcode, COUNTRY_CODE"
  - Country code is last part of address (DE, NL, FR, etc.)
```

---

### Sendcloud

```yaml
Standard Name: Sendcloud
Country: Netherlands
Currency: EUR
CSV Support: Yes

CSV Columns:
  - Description (service name, e.g., "UPS Standard 7-8kg")
  - Date (shipment date)
  - Reference (tracking number)
  - Amount (charge amount)
  - Type ("Shipments" or "Surcharge")
  - Order number
  - Integration
  - From Address 1, From City, From Postal Code, From Country
  - To Address 1, To City, To Postal Code, To Country

Special Notes:
  - Multiple rows per shipment (base + surcharges)
  - Group by Reference (tracking) to build line items
  - Weight extracted from description (e.g., "7-8kg")
```

---

### MRW (Spain)

```yaml
Standard Name: MRW
Country: Spain
Currency: EUR
CSV Support: No (PDF-only with line items)

Aliases:
  - MRW
  - VALENCIA VALENCIA
  - Motoroads World
  - MRW Spain
  - MRW Transporte

Field Mappings:
  Document Type: Factura, Invoice
  Net Amount: Base Imponible, Net Amount
  VAT Amount: IVA, VAT
  Gross Amount: Total Factura, Total
  Issue Date: Fecha Factura, Invoice Date
  Due Date: Fecha Vencimiento, Due Date
  Invoice Number: Nº Factura, Invoice Number
  Customer Number: Código Cliente, Customer Code

Special Notes:
  - MRW is a Spanish courier/logistics company
  - May appear as "VALENCIA VALENCIA" in some systems
  - Spanish date format: DD/MM/YYYY
  - 21% IVA (VAT) standard rate in Spain
  - Uses specialized PDF extraction with Gemini for line items

Example:
  Invoice Number: BB0013275
  Gross Amount: €500.00
```

---

### Wiechert Logistic (Germany)

```yaml
Standard Name: Wiechert
Country: Germany
Currency: EUR
CSV Support: No

Aliases:
  - Wiechert Logistic GmbH
  - Wiechert Logistic
  - Wiechert

Field Mappings:
  Document Type: Rechnung / Invoice, Rechnung, Invoice
  Net Amount: Summe, Netto, netto
  VAT Amount: Mehrwertsteuer 19%, MwSt. 19%
  Gross Amount: Gesamtbetrag, Total
  Issue Date: Datum, Rechnungsdatum
  Due Date: Zahlungsbedingungen, Fälligkeitsdatum
  Performance Period: Leistungsdatum, Service date
  Invoice Number: Rechnungs-Nr., Invoice Number
  Customer Number: Kunden-Nr., Customer Number

Special Notes:
  - Invoice format: "YYYYMMDDnn" (e.g., "2025111810")
  - Company address: "Rita-Maiburg-Straße 6, DE 88074 Meckenbeuren"
  - Net amount shown as "X.XXX,XX € netto"
  - VAT calculation: "Mehrwertsteuer 19% auf X.XXX,XX € netto: XXX,XX €"
  - Due date: "Die Rechnung ist am 15. des Folgemonats zur Zahlung fällig"
  - 19% VAT standard rate
  - Date format: DD.MM.YYYY

Example:
  Invoice Number: 2025111810
  Gross Amount: €3,208.37
```

---

### DS Smith (Poland)

```yaml
Standard Name: DS Smith
Country: Poland
Currency: EUR
CSV Support: No

Aliases:
  - DS Smith Polska SP. Z O.O.
  - DS Smith Polska
  - DS Smith
  - DSSmith

Field Mappings:
  Document Type: INVOICE VAT, Invoice VAT
  Net Amount: NET AMOUNT, Net amount
  VAT Amount: VAT AMOUNT, VAT %, VAT(PLN)
  Gross Amount: TO BE PAID EUR, TO BE PAID, Amount due, TOTAL
  Issue Date: From, Invoice date
  Due Date: Due date, Payment due
  Performance Period: Date of sale, Data sprzedaży
  Invoice Number: INVOICE No., Invoice number
  Order Number: Order No., Zamówienie
  Customer Number: Customer No., Kod klienta

Special Notes:
  - Invoice format: "YYDnnnnn" (e.g., "25D02108")
  - ⚠️ CRITICAL: Invoice number is in HEADER with "INVOICE No." - NOT "Order No."
  - Customer number format: "Customer No. : 31178"
  - Gross amount appears as "TO BE PAID EUR: X,XXX.XX"
  - Payment terms: "transfer 30 DAYS NET"
  - 0% VAT for EU reverse charge
  - Date format: DD/MM/YYYY

Example:
  Invoice Number: 25D02108
  Gross Amount: €3,511.35
```

---

### Karamac Logistics (Poland)

```yaml
Standard Name: Karamac
Country: Poland
Currency: EUR
CSV Support: No

Aliases:
  - KARAMAC LOGISTICS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
  - KARAMAC
  - Karamac Logistics
  - KARAMAC LOGISTICS

Field Mappings:
  Document Type: FAKTURA / INVOICE, FAKTURA, ORYGINAŁ / ORIGINAL
  Net Amount: Wartość netto / Net value, RAZEM / TOTAL
  VAT Amount: Wartość VAT / Tax value, Stawka VAT / Tax rate
  Gross Amount: DO ZAPŁATY / AMOUNT DUE, Wartość brutto / Gross value
  Issue Date: Data wystawienia/Invoice date
  Due Date: Data i sposób płatności / Due in
  Performance Period: zał.-rozł., Loading-Unloading dates
  Invoice Number: Nr dokumentu/Number
  Customer Number: NIP (customer)

Special Notes:
  - Invoice format: "Invoice XXX/MM/YY UE" (e.g., "Invoice 005/11/25 UE")
  - Bilingual labels: Polish / English format throughout
  - NP = Nie Podlega (VAT exempt/reverse charge)
  - Odwrotne obciążenie = Reverse charge (VAT = €0.00)
  - PRZELEW = Bank transfer payment method
  - Performance period from line item: "zał.-rozł.: DD.MM.YYYY-DD.MM.YYYY"
  - Date format: DD.MM.YYYY

Example:
  Invoice Number: Invoice 005/11/25 UE
  Gross Amount: €3,250.00
```

---

### Mimas Technik (Poland)

```yaml
Standard Name: Mimas
Country: Poland
Currency: PLN
CSV Support: No

Aliases:
  - MIMAS TECHNIK
  - Mimas Technik
  - MIMAS

Field Mappings:
  Document Type: Invoice FS, Faktura Sprzedaży
  Net Amount: Net value, Wartość netto
  VAT Amount: Tax value, Wartość VAT
  Gross Amount: Gross value, Total, Wartość brutto
  Issue Date: Invoice date, Data wystawienia
  Due Date: due date, Termin płatności
  Performance Period: Date of supply completion
  Invoice Number: Invoice number, Numer faktury
  Order Number: based on order, Zamówienie

Special Notes:
  - Invoice format: "FS XXX/WT/YYYY" (e.g., "FS 757/WT/2025")
  - Order reference format: "ZK XXX/WT/YYYY"
  - szt (sztuk) = pieces (unit of measure)
  - Niemcy = Germany
  - 0% VAT for international services

Example:
  Invoice Number: FS 757/WT/2025
  Gross Amount: 20,869.20 PLN
```

---

### BRT S.p.A. (Italy)

```yaml
Standard Name: BRT
Country: Italy
Currency: EUR
CSV Support: No

Aliases:
  - BRT S.p.A.
  - BRT SpA
  - BRT
  - Sede Operativa ed Amministrativa

Field Mappings:
  Document Type: Fattura, Tipo documento, Fattura - EUR
  Net Amount: IMPONIBILE, Imponibile, Net amount
  VAT Amount: IVA, Totale IVA, BOLLI
  Gross Amount: TOTALE FATTURA, Totale documento, Importo
  Issue Date: DATA FATTURA, Data
  Due Date: Data scadenza pagamento
  Performance Period: nel mese di, RIFERIMENTO DATA
  Invoice Number: N. FATTURA, Numero Fattura
  Customer Number: CODICE CLIENTE, Cod.Cli.Bollettazione

Special Notes:
  - Customer number format: "CODICE CLIENTE: 1721465 (172) (996)"
  - Invoice number may have parenthetical reference: "674062 (996)"
  - BOLLI = Stamp duty (typically €2.00, added separately from VAT)
  - INVERSIONE CONTABILE ART.7 TER = Reverse charge Article 7 ter
  - Date format: DD/MM/YY or DD/MM/YYYY

Example:
  Invoice Number: 674062 (996)
  Gross Amount: €402.88
```

---

### BikeExchange / Kitzuma (USA)

```yaml
Standard Name: BikeExchange
Country: USA
Currency: USD
CSV Support: No

Aliases:
  - BikeExchange Inc.
  - Kitzuma Corp.
  - BikeExchange
  - Kitzuma

Field Mappings:
  Document Type: Invoice
  Net Amount: Untaxed Amount, Subtotal
  VAT Amount: TAXES, Tax
  Gross Amount: Total, Invoice Total
  Issue Date: Invoice Date
  Due Date: Due Date
  Invoice Number: Invoice Number, INV

Special Notes:
  - American date format: MM/DD/YYYY (e.g., 07/31/2025)
  - Partial payments shown: "Paid on [date]: $XXX.XX"
  - Amount Due = Total - Partial Payments
  - No VAT/sales tax typically applied
  - Payment terms typically 5 days

Example:
  Invoice Number: 22837
  Gross Amount: $3,930.11
```

---

### Weltweitversenden / myGermany (Germany)

```yaml
Standard Name: Weltweitversenden
Country: Germany
Currency: EUR
CSV Support: No

Aliases:
  - weltweitversenden GmbH
  - weltweitversenden
  - myGermany
  - my Germany

Field Mappings:
  Document Type: Shipping Invoice, Rechnung
  Net Amount: Net Price, Netto
  VAT Amount: VAT 0%, MwSt. 0%
  Gross Amount: TOTAL Gross Price, Gesamtbetrag
  Issue Date: Invoice Date, Rechnungsdatum
  Due Date: Within 7 working days
  Performance Period: Service Period, Leistungszeitraum
  Invoice Number: Invoice Number, Rechnungsnummer
  Customer Number: Customer Number, Kundennummer

Special Notes:
  - Invoice format: "YYYYMMDDnn" (e.g., "2025091006")
  - MRN = Movement Reference Number (customs export)
  - 0% VAT for cross-border shipping (§ 4 Nr. 3 a) aa) UStG)
  - Service period format: DD.MM.-DD.MM.YYYY

Example:
  Invoice Number: 2025091006
  Gross Amount: €11,674.32
```

---

### Red Stag Fulfillment (USA)

```yaml
Standard Name: Red Stag
Country: USA
Currency: USD
CSV Support: No

Aliases:
  - Red Stag Fulfillment, LLC
  - Red Stag Fulfillment
  - RedStag
  - Red Stag

Field Mappings:
  Document Type: Invoice
  Net Amount: Subtotal
  VAT Amount: Tax
  Gross Amount: Amount Due (USD), Total
  Issue Date: Invoice Date
  Due Date: Payment Terms
  Invoice Number: Invoice #, Invoice Number

Special Notes:
  - Invoice format: "BCL_YYYY.MM_N" (e.g., "BCL_2025.11_2")
  - No VAT/sales tax (B2B fulfillment service)
  - Multi-page invoices with line items spanning pages
  - Line items grouped by location (Salt Lake City, Sweetwater)
  - Service categories: Storage, Outbound, Returns, Other
  - American date format: MM/DD/YYYY
  - Payment terms: "3 Business Days"

Example:
  Invoice Number: BCL_2025.11_2
  Gross Amount: $4,096.07
```

---

### S2C / Sport & Events Logistics (Italy)

```yaml
Standard Name: S2C
Country: Italy
Currency: EUR
CSV Support: No

Aliases:
  - SPORT & EVENTS LOGISTICS SRL Società Benefit
  - SPORT & EVENTS LOGISTICS SRL
  - Sport & Events Logistics
  - S2C
  - Società Benefit

Field Mappings:
  Document Type: INVOICE, Document Type, ORIGINALE
  Net Amount: Total, Amount
  VAT Amount: Vat Amount, IVA
  Gross Amount: Document Total, EURO
  Issue Date: Date
  Due Date: Paymenti Terms, Payment Terms
  Invoice Number: Nr.document, Document Number
  Customer Number: ORIGINALE

Special Notes:
  - Invoice format: "YYYY / NNNNNN / VE" (e.g., "2025 / 000516 / VE")
  - Customer code appears after "ORIGINALE" label
  - Currency shown as "Curren: EURO"
  - VAT Code 7 = Art. 7-ter Reverse Charge (0% VAT)
  - Date format: DD/MM/YYYY

Example:
  Invoice Number: 2025 / 000516 / VE
  Gross Amount: €1,835.22
```

---

### EasyLox / Paket.ag (Germany)

```yaml
Standard Name: EasyLox
Country: Germany
Currency: EUR
CSV Support: No

Aliases:
  - Paket.ag & EasyLox GmbH
  - Paket.ag
  - EasyLox GmbH
  - EASYLOX

Field Mappings:
  Document Type: Rechnung
  Net Amount: Netto
  VAT Amount: MwSt. 19%, Mehrwertsteuer
  Gross Amount: Gesamt, Gesamtbetrag
  Issue Date: Datum, Rechnungsdatum
  Due Date: Fälligkeitsdatum, Zahlbar bis
  Performance Period: Leistungszeitraum
  Invoice Number: Rechnung Nr., Rechnungs-Nr.
  Customer Number: Kunde Nr., Kunden-Nr.

Special Notes:
  - Invoice format: "P&E_YYYYnnnnnnn" (e.g., "P&E_20252047597")
  - Company address: "Mühlweg 3A, 67105 Schifferstadt"
  - Auto-debit payment: "Betrag wird eingezogen"
  - 19% VAT standard rate
  - Date format: DD.MM.YYYY

Example:
  Invoice Number: P&E_20252047597
  Gross Amount: €170.35
```

---

## 6. Database Structure

### Tables Overview

All invoice tables are stored in PostgreSQL (Neon):

| Table | Database | Purpose |
|-------|----------|---------|
| `invoice_extractions` | PostgreSQL (Neon) | Main invoice records |
| `invoice_line_items` | PostgreSQL (Neon) | Shipment line items |
| `invoice_files` | PostgreSQL (Neon) | Uploaded PDF/CSV files |
| `invoice_users` | PostgreSQL (Neon) | User authentication |
| `invoice_threads` | PostgreSQL (Neon) | Comments with @mentions |
| `invoice_notifications` | PostgreSQL (Neon) | User notifications |
| `invoice_data_sources` | PostgreSQL (Neon) | Email/SFTP endpoints |
| `invoice_data_source_logs` | PostgreSQL (Neon) | Ingestion activity logs |

### ERD

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL (Neon) - All Invoice Tables                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────┐     ┌─────────────────────────────┐   │
│  │ invoice_extractions             │     │ invoice_line_items          │   │
│  ├─────────────────────────────────┤     ├─────────────────────────────┤   │
│  │ id (PK)                         │──┬──│ invoice_id (FK)             │   │
│  │ file_id (FK to files)           │  │  │ shipment_number             │   │
│  │ invoice_number, vendor          │  │  │ origin/destination          │   │
│  │ consensus_data (JSONB)          │  │  │ net_amount, gross_amount    │   │
│  │ confidence_score                │  │  │ vendor_raw_data (JSONB)     │   │
│  │ status, payment_status          │  │  └─────────────────────────────┘   │
│  │ viewed_by (JSONB)               │  │                                    │
│  └─────────────────────────────────┘  │  ┌─────────────────────────────┐   │
│           │                           │  │ invoice_threads             │   │
│           │ file_id                   │  ├─────────────────────────────┤   │
│           ▼                           └──│ entity_id (FK)              │   │
│  ┌─────────────────────────────────┐     │ author_id, content          │   │
│  │ invoice_files                   │     │ mentioned_user_ids[]        │   │
│  ├─────────────────────────────────┤     └─────────────────────────────┘   │
│  │ id (PK)                         │                                       │
│  │ file_hash (unique)              │     ┌─────────────────────────────┐   │
│  │ s3_key, local_path              │     │ invoice_users               │   │
│  │ source, status                  │     ├─────────────────────────────┤   │
│  └─────────────────────────────────┘     │ id (PK), email (unique)     │   │
│                                          │ role (admin/manager/member) │   │
│  ┌─────────────────────────────────┐     └─────────────────────────────┘   │
│  │ invoice_data_sources            │                                       │
│  ├─────────────────────────────────┤     ┌─────────────────────────────┐   │
│  │ id (PK)                         │──┬──│ invoice_data_source_logs    │   │
│  │ email_address (unique)          │  │  ├─────────────────────────────┤   │
│  │ vendor_hint, auto_process       │  └──│ data_source_id (FK)         │   │
│  │ connection_type, host           │     │ event_type, status          │   │
│  └─────────────────────────────────┘     │ invoice_extraction_id       │   │
│                                          └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Data Usage & Accounting

### Monthly Accounting View

The accounting endpoint (`/api/invoice-ocr/accounting`) provides a pivot table view:

```
                  │ Jan 2026 │ Feb 2026 │ Q1 Total │ Unmapped │
──────────────────┼──────────┼──────────┼──────────┼──────────┤
DHL               │          │          │          │          │
  MUCIR00169682   │ 45 ships │ 12 ships │ 57 ships │ 2 ships  │
                  │ €4,200   │ €1,100   │ €5,300   │ €75      │
──────────────────┼──────────┼──────────┼──────────┼──────────┤
UPS               │          │          │          │          │
  0000EG5322425   │ 23 ships │ 31 ships │ 54 ships │ 0 ships  │
                  │ €2,100   │ €2,800   │ €4,900   │ €0       │
──────────────────┼──────────┼──────────┼──────────┼──────────┤
GRAND TOTAL       │ €6,300   │ €3,900   │ €10,200  │ €75      │
```

### Export Formats

1. **CSV Export**: All line items with full detail
2. **Excel Export**: Formatted with headers and totals
3. **DATEV Format**: German accounting software compatible

### Dashboard Metrics

- **Open Invoices**: Pending + On-Hold count and totals
- **Ready for Payment**: Approved invoices
- **Discrepancies**: Invoices with conflicts or low confidence
- **Vendor Breakdown**: Totals by carrier
- **Monthly Heatmap**: Invoice volume over time

---

## 8. Next Steps & Roadmap

### Missing Carrier Schemas (Priority)

| Carrier | Priority | Notes |
|---------|----------|-------|
| **DPD** | High | Common carrier, needs full mapping |
| **Cargoboard** | Medium | German freight forwarder |
| **Horna** | Low | Limited usage |
| **Flowspace** | Low | US fulfillment |
| **Omnipack** | Low | Limited usage |

### Feature Improvements

1. **Auto-Matching to Orders**
   - Match line items to buycycle orders via tracking number
   - Calculate cost per order for margin analysis

2. **Duplicate Detection**
   - Prevent duplicate invoice uploads
   - Merge logic for re-uploaded invoices

3. **Approval Workflow Enhancements**
   - Multi-level approval for high-value invoices
   - Automatic approval for low-value + high-confidence

4. **Cost Allocation**
   - Split invoice costs to cost centers
   - Warehouse/region allocation

5. **Discrepancy Alerts**
   - Weight discrepancy detection (booked vs billed)
   - Price variance from contracted rates

### Technical Debt

- [ ] Add schemas for DPD, Cargoboard, Horna, Flowspace, Omnipack
- [ ] Implement field-level validation rules
- [ ] Add unit tests for CSV parsers
- [ ] Performance: Batch insert for large CSVs
- [ ] Monitoring: Alert on extraction failures

---

## Appendix: Quick Reference

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/invoice-ocr/extract` | POST | Upload and extract invoice |
| `/api/invoice-ocr/extractions` | GET | List all invoices |
| `/api/invoice-ocr/extractions/:id` | GET | Get single invoice |
| `/api/invoice-ocr/extractions/:id` | PATCH | Update invoice |
| `/api/invoice-ocr/extractions/:id/mark-read` | POST | Mark as viewed |
| `/api/invoice-ocr/accounting` | GET | Monthly pivot table |
| `/api/invoice-ocr/dashboard` | GET | Dashboard stats |
| `/api/invoice-ocr/vendors` | GET | Vendor list with totals |

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Newly uploaded, awaiting review |
| `approved` | Verified, ready for payment |
| `on_hold` | Needs manual investigation |
| `rejected` | Invalid or duplicate |
| `paid` | Payment completed |

### Confidence Thresholds

| Threshold | Value | Action |
|-----------|-------|--------|
| Smart Fallback | 90% | Stop calling more AI models |
| Low Confidence | 70% | Flag field for review |
| Hybrid Mode | 95% | CSV data confidence |

---

*Report generated from codebase analysis. Last updated: 2026-03-19*
