/**
 * MRW PDF Line Item Extractor
 * Extracts shipment line items directly from MRW PDF invoices (no CSV available)
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { OCRLineItem } from '@shared/types';
import { logger } from '../../../utils/logger';

/**
 * MRW-specific line item schema
 * Matches the expected CSV output format
 */
const mrwLineItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    invoice_number: {
      type: SchemaType.STRING,
      description: 'Invoice number (e.g., BB0013275)',
    },
    invoice_date: {
      type: SchemaType.STRING,
      description: 'Invoice date in YYYY-MM-DD format',
    },
    line_items: {
      type: SchemaType.ARRAY,
      description: 'Array of shipment line items extracted from the invoice',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          tracking_number: {
            type: SchemaType.STRING,
            description: 'Albarán number (e.g., 00604A198067)',
          },
          reference_number: {
            type: SchemaType.STRING,
            description: 'Reference number from (Ref: XXXXXXX), e.g., 1190314S2',
          },
          shipment_date: {
            type: SchemaType.STRING,
            description: 'Shipment date from "del DD/MM/YYYY" in YYYY-MM-DD format',
          },
          service_type: {
            type: SchemaType.STRING,
            description: 'Service type (e.g., ECOM Nacional, UMARITIMO Nacional, ECOM Provincial)',
          },
          weight: {
            type: SchemaType.NUMBER,
            description: 'Weight in kilograms from the Kilos column',
          },
          quantity: {
            type: SchemaType.INTEGER,
            description: 'Number of packages from the Bultos column',
          },
          net_amount: {
            type: SchemaType.NUMBER,
            description: 'Net amount in euros from the Importe column',
          },
        },
        required: [
          'tracking_number',
          'reference_number',
          'shipment_date',
          'service_type',
          'weight',
          'quantity',
          'net_amount',
        ],
      },
    },
    fuel_surcharge: {
      type: SchemaType.NUMBER,
      description: 'Fuel surcharge amount (Plus Combustible) if present, otherwise 0',
      nullable: true,
    },
  },
  required: ['invoice_number', 'invoice_date', 'line_items'],
};

/**
 * Extraction prompt for MRW invoices
 */
const MRW_EXTRACTION_PROMPT = `You are extracting shipment line items from an MRW logistics invoice PDF.

**CRITICAL INSTRUCTIONS:**

1. **Extract ALL shipment line items** that start with "* Albarán"
2. For each shipment, extract:
   - **Tracking Number**: The Albarán number (e.g., 00604A198067)
   - **Reference Number**: The reference after "(Ref: XXXXXXX)" (e.g., 1190314S2)
   - **Shipment Date**: The date after "del DD/MM/YYYY" - convert to YYYY-MM-DD format
   - **Service Type**: The service name after the date (e.g., "ECOM Nacional", "UMARITIMO Nacional")
   - **Weight**: The number from the "Kilos" column (right side of page)
   - **Quantity**: The number from the "Bultos" column (packages/parcels)
   - **Net Amount**: The price from the "Importe" column in euros

3. **Fuel Surcharge**: Look for "*Plus Combustible" line (usually on page 5) and extract the amount

4. **Date Format**: Convert all dates from DD/MM/YYYY to YYYY-MM-DD

5. **Decimal Format**: MRW uses European format with comma (e.g., 69,90€ → 69.9)

**EXAMPLE LINE ITEM:**
* Albarán 00604A198067 (Ref: 1190314S2) del 01/10/2025 ECOM Nacional    1    15    69,90€

Should extract as:
{
  "tracking_number": "00604A198067",
  "reference_number": "1190314S2",
  "shipment_date": "2025-10-01",
  "service_type": "ECOM Nacional",
  "quantity": 1,
  "weight": 15,
  "net_amount": 69.9
}

**IMPORTANT:**
- Extract EVERY shipment across ALL pages
- Do NOT skip any line items
- Preserve exact tracking numbers and references
- Convert amounts to decimal format (comma → period)
- The invoice typically has 50-60 shipments across multiple pages`;

/**
 * Extract line items from MRW PDF using Gemini
 */
export async function extractMRWLineItems(
  pdfPath: string,
  geminiApiKey: string
): Promise<{ invoice_number: string; invoice_date: string; line_items: OCRLineItem[]; fuel_surcharge: number }> {
  logger.info({ pdfPath }, 'Extracting MRW line items from PDF');

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Gemini schema type requires any
      responseSchema: mrwLineItemSchema as any,
    },
  });

  // Read PDF file as base64
  const pdfData = readFileSync(pdfPath);
  const base64Pdf = pdfData.toString('base64');

  logger.info({ pdfPath, modelName: 'gemini-2.5-flash' }, 'Starting MRW PDF extraction');

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: base64Pdf,
      },
    },
    { text: MRW_EXTRACTION_PROMPT },
  ]);

  const response = result.response.text();
  const parsed = JSON.parse(response);

  logger.info(
    {
      invoice_number: parsed.invoice_number,
      lineItemCount: parsed.line_items?.length || 0,
      fuelSurcharge: parsed.fuel_surcharge,
    },
    'MRW PDF extraction complete'
  );

  // Convert to OCRLineItem format
  // Include invoice_number on each line item for proper tracking
  const lineItems: OCRLineItem[] = parsed.line_items.map((item: { tracking_number: string; reference_number: string; shipment_date: string; service_type: string; weight: number; quantity: number; net_amount: number }) => ({
    // Vendor identification
    vendor: 'MRW',
    line_item_type: 'shipment' as const,

    invoice_number: parsed.invoice_number,
    invoice_date: parsed.invoice_date,
    currency: 'EUR',
    shipment_number: item.tracking_number,
    shipment_reference_1: item.reference_number,
    shipment_date: item.shipment_date,
    // booking_date not available in MRW PDF - would need lookup via reference number
    product_name: item.service_type,
    description: item.service_type,
    weight_kg: item.weight,
    pieces: item.quantity,
    net_amount: item.net_amount,
    gross_amount: item.net_amount, // MRW net = gross (no separate tax)
    base_price: item.net_amount,
    total_tax: 0,
    total_surcharges: 0,
    total_surcharges_tax: 0,
    // Leave origin/destination empty (not easily extractable from MRW text)
    origin_country: 'Spain', // MRW is Spanish carrier
    destination_country: '', // Mixed destinations
  }));

  // Add fuel surcharge and other invoice-level charges as "Other charges" row
  // This matches the MR-Line-items.csv spec format
  if (parsed.fuel_surcharge && parsed.fuel_surcharge > 0) {
    lineItems.push({
      // Vendor identification
      vendor: 'MRW',
      line_item_type: 'fee' as const,

      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      currency: 'EUR',
      shipment_number: '',
      shipment_reference_1: '',
      shipment_date: '',
      product_name: 'Other charges',
      description: 'Fuel surcharge and other invoice-level charges',
      weight_kg: undefined,
      pieces: undefined,
      net_amount: parsed.fuel_surcharge,
      gross_amount: parsed.fuel_surcharge,
      base_price: parsed.fuel_surcharge,
      total_tax: 0,
      total_surcharges: 0,
      total_surcharges_tax: 0,
    });
  }

  return {
    invoice_number: parsed.invoice_number,
    invoice_date: parsed.invoice_date,
    line_items: lineItems,
    fuel_surcharge: parsed.fuel_surcharge || 0,
  };
}
