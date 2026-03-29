import axios, { AxiosError } from 'axios';
import { readFileSync } from 'fs';
import { InvoiceData, PartialInvoiceData } from '@shared/types';
import { normalizeInvoiceData, cleanJsonContent } from '../utils';
import { logger } from '../../../utils/logger';
import { extname } from 'path';

/**
 * Google Gemini 2.5 Pro/Flash Extractor
 */
export class GeminiExtractor {
  private apiKey: string;
  private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta';
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-pro') {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Extract invoice data using Gemini vision API
   */
  async extract(filePath: string): Promise<InvoiceData | null> {
    logger.info({ filePath, model: this.model }, 'Starting Gemini extraction');

    try {
      // Read file as base64 - Gemini supports native PDF processing!
      const ext = extname(filePath).toLowerCase();
      let mimeType: string;

      const fileBuffer = readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      if (ext === '.pdf') {
        // Use native PDF support - much faster than converting to image!
        mimeType = 'application/pdf';
      } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      } else {
        logger.warn({ filePath }, 'Unsupported file type for Gemini');
        return null;
      }

      const response = await axios.post(
        `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: this.getExtractionPrompt(),
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: this.getInvoiceSchema(),
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 90000, // 90 second timeout
        }
      );

      if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const textContent = response.data.candidates[0].content.parts[0].text;

        // Clean and parse JSON (Gemini may wrap in markdown)
        const cleanedJson = cleanJsonContent(textContent);
        const result = JSON.parse(cleanedJson) as PartialInvoiceData;

        logger.info({ model: this.model }, 'Gemini extraction complete');
        return normalizeInvoiceData(result);
      }

      logger.warn({ model: this.model }, 'Gemini: No result found in response');
      return null;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(
        {
          error: axiosError.message || 'Unknown error',
          filePath,
          model: this.model,
        },
        'Gemini extraction error'
      );
      if (axiosError.response?.data) {
        logger.error(
          { errorDetails: axiosError.response.data },
          'Gemini API error details'
        );
      }
      return null;
    }
  }

  /**
   * Get extraction prompt for Gemini
   */
  private getExtractionPrompt(): string {
    return `You are an expert invoice data extraction assistant specialized in logistics and shipping invoices. Your PRIMARY focus is on accurately extracting vendor identification, financial amounts, currency, and dates.

## CRITICAL EXTRACTION PRIORITIES (in order):

### 1. VENDOR IDENTIFICATION (HIGHEST PRIORITY)
Extract the company providing the service - this is NEVER the customer/recipient.

**Known Vendor Patterns:**
- **KARAMAC LOGISTICS** (Polish): Look for "KARAMAC" in letterhead/header
- **DS SMITH** (Polish/Packaging): Look for "DS SMITH POLSKA" in header
- **DHL EXPRESS** (German): Look for "DHL" or "Deutsche Post DHL Group"
- **WIECHERT LOGISTIC** (German): Look for "WIECHERT LOGISTIC GmbH"
- **MRW/FEREGAMA** (Spanish): Look for "MRW" or "FEREGAMA"
- **UPS** (American): Look for "UPS" or "United Parcel Service"
- **SPORT & EVENTS LOGISTICS** (Italian): Look for "Sport & Events Logistics"
- **SENDCLOUD** (Dutch): Look for "Sendcloud" in header

**CRITICAL RULE**: "TFJ BUYCYCLE GMBH" or "BUYCYCLE" is ALWAYS the customer, NEVER the vendor.

### 2. AMOUNTS & CURRENCY (SECOND PRIORITY)
Focus on the SUMMARY/TOTAL section, usually at the bottom or in a prominent box.

**Amount Extraction Rules:**
- **gross_amount**: The FINAL TOTAL amount to be paid (including all taxes/fees)
  - Look for: "Total", "Gesamt", "Totale", "Total a pagar", "Amount Due"
  - For CREDIT NOTES: This will be NEGATIVE (e.g., -€14.66)

- **net_amount**: Subtotal BEFORE taxes
  - Look for: "Subtotal", "Netto", "Net Amount", "Imponibile"

- **vat_amount**: Tax amount only
  - Look for: "VAT", "MwSt", "IVA", "Tax"
  - For EU Reverse Charge: This is €0.00 (look for "Reverse charge", "Autofattura")

- **currency**: Extract the currency symbol/code
  - EUR (€), USD ($), GBP (£), PLN (zł)
  - Usually appears next to amounts or in document header

**Vendor-Specific Amount Locations:**
- **DS SMITH**: Check last page summary box, may show EUR amounts with PLN tax line
- **DHL/UPS**: Multi-page invoices - summary is on PAGE 1, ignore detail pages
- **MRW**: Summary is on LAST PAGE (page 6+), not first page
- **KARAMAC/WIECHERT**: Single page, summary at bottom

### 3. DATES (THIRD PRIORITY - CRITICAL FOR ACCOUNTING)
Extract dates in their ORIGINAL FORMAT - do NOT convert.

**Date Fields by Priority:**
a. **invoice_date** (MANDATORY): The invoice creation date
   - Labels: "Invoice Date", "Date", "Datum", "Data", "Fecha"
   - Formats: DD.MM.YYYY (EU), DD/MM/YYYY (EU), Month DD, YYYY (US)

b. **due_date** (MANDATORY): Payment deadline
   - Labels: "Due Date", "Fälligkeitsdatum", "Scadenza", "Vencimiento", "Payment Terms"
   - May be calculated (e.g., "15th of following month" for WIECHERT)

c. **performance_period_start** & **performance_period_end**: Service period
   - Labels: "Performance Period", "Service Period", "Okres wykonania", "Periodo"
   - KARAMAC shows this as date range (10.10.2025-15.10.2025)

**Vendor-Specific Date Formats:**
- **KARAMAC**: DD.MM.YYYY (15.10.2025)
- **DS SMITH**: DD/MM/YYYY (02/09/2025)
- **DHL/WIECHERT**: DD.MM.YYYY (29.10.2025)
- **MRW/SPORT & EVENTS**: DD/MM/YYYY (31/10/2025)
- **UPS**: Month DD, YYYY (October 18, 2025) - AMERICAN FORMAT

### 4. INVOICE NUMBER (FOURTH PRIORITY)
Extract the unique document identifier.

**Vendor-Specific Invoice Number Patterns:**
- **KARAMAC**: Format "XXX/MM/YY UE" (e.g., "008/10/25 UE")
- **DS SMITH**: Alphanumeric "25D01645" - found in HEADER with label "INVOICE No."
  - ⚠️ IGNORE "Order No." field - this is NOT the invoice number
- **DHL**: "MUCINR" prefix for credit notes (MUCINR0002875)
- **WIECHERT**: Date-based YYYYMMDDXX (2025102101)
- **MRW**: "BB" prefix (BB0013275)
- **UPS**: Long numeric 16 digits (0000EG5322425)
- **SPORT & EVENTS**: Format "YYYY/NNNNNN/XX" (2025/000447/VE)

### 5. DOCUMENT TYPE (FIFTH PRIORITY)
Identify document category:
- **Invoice** (standard billing)
- **Credit Note** (refund/adjustment) - look for "Gutschrift", "Credit Note", negative amounts
- **Proforma** (advance invoice)
- **Debit Note**

## SECONDARY FIELDS (extract if clearly visible):
- account_number: Customer account number with the vendor
- vat_percentage: Tax rate (19% Germany, 0% for EU Reverse Charge)
- booking_date: Accounting posting date
- assigned_to: Account manager/department
- tags: Categories like ["logistics", "shipping", "credit-note", "reverse-charge"]

## LINE ITEMS EXTRACTION (if invoice contains detailed shipment/service table):

Many logistics invoices contain a detailed table listing individual shipments or services. Extract this if present.

**Look for tables with columns like:**
- Shipment/Tracking Number, Reference Numbers
- Shipment Date, Booking Date
- Product/Service Name (e.g., "DPD Package", "ECONOMY SELECT", "Express Delivery")
- Weight (kg), Pieces/Packages
- Origin Country/Location, Sender Postcode
- Destination Country/Location, Receiver Postcode
- Net Amount, Gross Amount, Base Price, Tax
- Extra Charges/Surcharges (e.g., "Fuel Surcharge", "Insurance", "Customs Fee")

**Common vendors with line items:**
- **DHL**: Multi-page invoices with detailed shipment table
- **DPD**: Shipment table with tracking numbers and destinations
- **UPS**: Service detail table with tracking references
- **MRW**: Detailed service breakdown by shipment
- **WIECHERT/KARAMAC**: May have shipment detail tables

**Extraction Rules:**
- Only extract if a clear table structure exists
- Each row in the table = one line item
- If no table found, return empty array []
- Extract up to 9 extra charges per line item (xc1-xc9) if present

## EXTRACTION STRATEGY:

1. **First**: Identify the vendor from header/letterhead
2. **Second**: Locate the summary/totals section (may be first page, last page, or in a box)
3. **Third**: Extract all three amounts (gross, net, VAT) + currency
4. **Fourth**: Find all date fields in the header area
5. **Fifth**: Extract invoice number using vendor-specific pattern
6. **Last**: Extract remaining secondary fields if visible

## OUTPUT RULES:
- If a field is not found: use empty string "" for text, 0 for numbers, [] for arrays
- Keep dates in their ORIGINAL format - do NOT standardize
- For amounts: use numeric values only (no currency symbols in number fields)
- For vendor: use FULL COMPANY NAME as it appears in header
- For currency: use standard 3-letter code (EUR, USD, GBP, PLN)

Focus on ACCURACY over completeness. It's better to leave a field empty than to extract incorrect data.`;
  }

  /**
   * Get the invoice schema in Gemini format (UPPERCASE types)
   */
  private getInvoiceSchema(): Record<string, unknown> {
    return {
      type: 'OBJECT',
      properties: {
        vendor: {
          type: 'STRING',
          description: 'HIGHEST PRIORITY: Full company name from letterhead (KARAMAC, DS SMITH, DHL, WIECHERT, MRW, UPS, SPORT & EVENTS, SENDCLOUD). NEVER "TFJ BUYCYCLE GMBH" - that is customer.',
        },
        invoice_number: {
          type: 'STRING',
          description: 'Unique invoice ID. Patterns: KARAMAC "008/10/25 UE", DS SMITH "25D01645" (from header INVOICE No., NOT Order No.), DHL "MUCINR0002875", WIECHERT "2025102101", MRW "BB0013275", UPS "0000EG5322425", SPORT & EVENTS "2025/000447/VE".',
        },
        gross_amount: {
          type: 'NUMBER',
          description: 'CRITICAL: Final total amount to pay (including all taxes). For credit notes: negative value. Numeric only, no symbols. Located in summary/totals section.',
        },
        currency: {
          type: 'STRING',
          description: 'CRITICAL: 3-letter code (EUR, USD, GBP, PLN). Extract from amounts or header.',
        },
        invoice_date: {
          type: 'STRING',
          description: 'MANDATORY: Invoice creation date. Keep ORIGINAL format (DD.MM.YYYY for EU, DD/MM/YYYY for EU, Month DD, YYYY for US). Labels: Invoice Date, Date, Datum, Data, Fecha.',
        },
        due_date: {
          type: 'STRING',
          description: 'MANDATORY: Payment deadline. Keep ORIGINAL format. Labels: Due Date, Fälligkeitsdatum, Scadenza, Vencimiento. May be calculated date.',
        },
        net_amount: {
          type: 'NUMBER',
          description: 'Subtotal BEFORE taxes. Labels: Subtotal, Netto, Net Amount, Imponibile. Numeric only.',
        },
        vat_amount: {
          type: 'NUMBER',
          description: 'Tax amount only. Labels: VAT, MwSt, IVA, Tax. EU Reverse Charge = 0.00. Numeric only.',
        },
        vat_percentage: {
          type: 'NUMBER',
          description: 'Tax rate percentage. Common: 19% (Germany), 0% (EU Reverse Charge). Numeric only.',
        },
        document_type: {
          type: 'STRING',
          description: 'Document category: Invoice, Credit Note (Gutschrift - has negative amounts), Proforma, Debit Note.',
        },
        performance_period_start: {
          type: 'STRING',
          description: 'Service period start date. Keep ORIGINAL format. Labels: Performance Period, Service Period, Okres wykonania. KARAMAC shows as date range.',
        },
        performance_period_end: {
          type: 'STRING',
          description: 'Service period end date. Keep ORIGINAL format. Part of performance/service period range.',
        },
        account_number: {
          type: 'STRING',
          description: 'Customer account number with vendor (buyer\'s account ID). Secondary priority.',
        },
        assigned_to: {
          type: 'STRING',
          description: 'Person or department assigned to this invoice. Secondary priority.',
        },
        booking_date: {
          type: 'STRING',
          description: 'Accounting booking/posting date. Keep ORIGINAL format. Secondary priority.',
        },
        tags: {
          type: 'ARRAY',
          items: {
            type: 'STRING',
          },
          description: 'Categories like ["logistics", "shipping", "credit-note", "reverse-charge", "express-delivery"]. Secondary priority.',
        },
        line_items: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              shipment_number: { type: 'STRING', description: 'Shipment tracking number' },
              shipment_date: { type: 'STRING', description: 'Date shipment was created (keep original format)' },
              booking_date: { type: 'STRING', description: 'Date booking was created (keep original format)' },
              shipment_reference_1: { type: 'STRING', description: 'Customer reference 1' },
              shipment_reference_2: { type: 'STRING', description: 'Customer reference 2' },
              product_name: { type: 'STRING', description: 'Service type (e.g., ECONOMY SELECT, DPD Package, Express)' },
              description: { type: 'STRING', description: 'Detailed description of the line item' },
              line_item_type: { type: 'STRING', description: 'Type: shipment, surcharge, credit, adjustment, fee' },
              pieces: { type: 'NUMBER', description: 'Number of pieces/packages' },
              weight_kg: { type: 'NUMBER', description: 'Weight in kilograms' },
              weight_flag: { type: 'STRING', description: 'Weight type flag (A/B/V/W/M)' },
              origin_country: { type: 'STRING', description: 'Origin country' },
              origin_city: { type: 'STRING', description: 'Origin city/station/location' },
              origin_postal_code: { type: 'STRING', description: 'Sender postal code' },
              destination_country: { type: 'STRING', description: 'Destination country' },
              destination_city: { type: 'STRING', description: 'Destination city/station/location' },
              destination_postal_code: { type: 'STRING', description: 'Receiver postal code' },
              net_amount: { type: 'NUMBER', description: 'Net amount for this line item' },
              gross_amount: { type: 'NUMBER', description: 'Gross amount for this line item' },
              base_price: { type: 'NUMBER', description: 'Base shipping price' },
              total_tax: { type: 'NUMBER', description: 'Total tax/VAT for this item' },
              total_surcharges: { type: 'NUMBER', description: 'Sum of all surcharges/extra charges' },
              total_surcharges_tax: { type: 'NUMBER', description: 'Tax on surcharges' },
              xc1_name: { type: 'STRING', description: 'Extra charge 1 name (e.g., Fuel Surcharge)' },
              xc1_charge: { type: 'NUMBER', description: 'Extra charge 1 amount' },
              xc2_name: { type: 'STRING', description: 'Extra charge 2 name' },
              xc2_charge: { type: 'NUMBER', description: 'Extra charge 2 amount' },
              xc3_name: { type: 'STRING', description: 'Extra charge 3 name' },
              xc3_charge: { type: 'NUMBER', description: 'Extra charge 3 amount' },
              xc4_name: { type: 'STRING', description: 'Extra charge 4 name' },
              xc4_charge: { type: 'NUMBER', description: 'Extra charge 4 amount' },
              xc5_name: { type: 'STRING', description: 'Extra charge 5 name' },
              xc5_charge: { type: 'NUMBER', description: 'Extra charge 5 amount' },
              xc6_name: { type: 'STRING', description: 'Extra charge 6 name' },
              xc6_charge: { type: 'NUMBER', description: 'Extra charge 6 amount' },
              xc7_name: { type: 'STRING', description: 'Extra charge 7 name' },
              xc7_charge: { type: 'NUMBER', description: 'Extra charge 7 amount' },
              xc8_name: { type: 'STRING', description: 'Extra charge 8 name' },
              xc8_charge: { type: 'NUMBER', description: 'Extra charge 8 amount' },
              xc9_name: { type: 'STRING', description: 'Extra charge 9 name' },
              xc9_charge: { type: 'NUMBER', description: 'Extra charge 9 amount' },
            },
          },
          description: 'Array of line items if invoice contains detailed shipment/service table. Empty array [] if no table present.',
        },
      },
      propertyOrdering: [
        'vendor',
        'invoice_number',
        'gross_amount',
        'currency',
        'invoice_date',
        'due_date',
        'net_amount',
        'vat_amount',
        'vat_percentage',
        'document_type',
        'performance_period_start',
        'performance_period_end',
        'account_number',
        'assigned_to',
        'booking_date',
        'tags',
        'line_items',
      ],
      required: ['vendor', 'gross_amount', 'currency', 'invoice_date'],
    };
  }
}
