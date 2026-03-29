/**
 * CSV Parser for Multi-Line Item Invoices
 * Handles parsing of CSV files with detailed line items (e.g., DHL invoices)
 * Supports both RAW DHL format (155 columns) and simplified template format (39 columns)
 */

import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { InvoiceLineItem } from '@shared/types';

// Maximum number of line items allowed per invoice (prevent memory issues with huge files)
const MAX_LINE_ITEMS = 10000;

/**
 * Raw DHL CSV row structure (155+ columns from DHL export)
 */
interface DHLRawCSVRow {
  'Line Type': string;
  'Invoice Number': string;
  'Shipment Number': string;
  'Shipment Date': string;
  'Shipment Reference 1': string;
  'Shipment Reference 2': string;
  'Product Name': string;
  'Pieces': string;
  'Weight (kg)': string;
  'Weight Flag': string;
  'Orig Country Name': string;
  'Dest Country Name': string;
  'Total amount (excl. VAT)': string;
  'Total amount (incl. VAT)': string;
  'Weight Charge': string;
  'Total Extra Charges (XC)': string;
  'Total Tax': string;
  'Orig Name': string;
  'Senders Postcode': string;
  'Dest Name': string;
  'Receivers Postcode': string;
  'Total Extra Charges Tax': string;
  'XC1 Name': string;
  'XC1 Charge': string;
  'XC2 Name': string;
  'XC2 Charge': string;
  'XC3 Name': string;
  'XC3 Charge': string;
  'XC4 Name': string;
  'XC4 Charge': string;
  'XC5 Name': string;
  'XC5 Charge': string;
  'XC6 Name': string;
  'XC6 Charge': string;
  'XC7 Name': string;
  'XC7 Charge': string;
  'XC8 Name': string;
  'XC8 Charge': string;
  'XC9 Name': string;
  'XC9 Charge': string;
  'Invoice Date': string;
}

/**
 * Simplified template CSV row structure (39 columns)
 */
interface DHLTemplateCSVRow {
  'Invoice Number': string;
  'Shipment Number': string;
  'Shipment Date': string;
  'Booking Created Date': string;
  'Shipment Reference 1': string;
  'Shipment Reference 2': string;
  'Product Name': string;
  'Pieces': string;
  'Weight (kg)': string;
  'Weight Flag': string;
  'Origin Country Name': string;
  'Destination Country Name': string;
  'Net amount': string;
  'Gross amount': string;
  'Base Price': string;
  'Total Extra Charges (XC)': string;
  'Total Tax': string;
  'Origin Name': string;
  'Senders Postcode': string;
  'Destination Name': string;
  'Receivers Postcode': string;
  'Total Extra Charges Tax': string;
  'XC1 Name': string;
  'XC1 Charge': string;
  'XC2 Name': string;
  'XC2 Charge': string;
  'XC3 Name': string;
  'XC3 Charge': string;
  'XC4 Name': string;
  'XC4 Charge': string;
  'XC5 Name': string;
  'XC5 Charge': string;
  'XC6 Name': string;
  'XC6 Charge': string;
  'XC7 Name': string;
  'XC7 Charge': string;
  'XC8 Name': string;
  'XC8 Charge': string;
  'XC9 Name': string;
  'XC9 Charge': string;
}

/**
 * Parse a date string in various formats to ISO date (YYYY-MM-DD)
 * Supports:
 *   - ISO format: YYYY-MM-DD
 *   - Compact format: YYYYMMDD (DHL exports use this!)
 *   - European format: DD/MM/YYYY or DD.MM.YYYY
 *   - US format: MM/DD/YYYY
 */
function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr || dateStr.trim() === '') return null;

  const trimmed = dateStr.trim();

  // Handle YYYYMMDD format (DHL exports use this - e.g., "20251215")
  // Must check this BEFORE trying new Date() because new Date('20251215') fails
  if (/^\d{8}$/.test(trimmed)) {
    const year = trimmed.substring(0, 4);
    const month = trimmed.substring(4, 6);
    const day = trimmed.substring(6, 8);
    // Validate the parsed date is real
    const parsed = new Date(`${year}-${month}-${day}`);
    if (!isNaN(parsed.getTime())) {
      return `${year}-${month}-${day}`;
    }
  }

  // Handle DD/MM/YYYY or DD.MM.YYYY (European format)
  const euMatch = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (euMatch) {
    const [, day, month, year] = euMatch;
    const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(parsed.getTime())) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Try parsing as ISO date or other JS-recognizable format
  try {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // Ignore parsing errors
  }

  return null;
}

/**
 * Parse a number string, handling empty values and European number format
 * Supports both formats:
 *   - US: "1234.56" or "1,234.56"
 *   - European: "1234,56" or "1.234,56"
 * Returns null only for truly empty/whitespace strings, not for zero values
 * All amounts are rounded to 2 decimal places to fix floating point precision errors
 */
function parseNumber(numStr: string | null | undefined): number | null {
  if (!numStr || numStr.trim() === '') {
    return null;
  }

  const trimmed = numStr.trim();

  // Detect format based on comma/period usage
  const hasComma = trimmed.includes(',');
  const hasPeriod = trimmed.includes('.');

  let normalized: string;

  if (hasComma && hasPeriod) {
    // Has both - determine which is decimal separator
    const lastComma = trimmed.lastIndexOf(',');
    const lastPeriod = trimmed.lastIndexOf('.');

    if (lastComma > lastPeriod) {
      // European: "1.234,56" → remove periods, convert comma to period
      normalized = trimmed.replace(/\./g, '').replace(',', '.');
    } else {
      // US: "1,234.56" → remove commas
      normalized = trimmed.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only comma - assume European decimal separator
    // "14,47" → "14.47"
    normalized = trimmed.replace(',', '.');
  } else {
    // Only period or no separator - use as is
    normalized = trimmed;
  }

  const parsed = parseFloat(normalized);
  if (isNaN(parsed)) {
    return null;
  }

  // Round to 2 decimal places to fix floating point precision errors
  return Math.round(parsed * 100) / 100;
}

/**
 * Parse a string, handling empty values
 */
function parseString(str: string | null | undefined): string | null {
  if (!str || str.trim() === '') return null;
  return str.trim();
}

/**
 * Convert RAW DHL CSV row to line item object
 */
function convertRawDHLRowToLineItem(row: DHLRawCSVRow): Omit<InvoiceLineItem, 'id' | 'invoice_extraction_id' | 'created_at' | 'updated_at'> {
  return {
    vendor: 'DHL',
    description: parseString(row['Product Name']),
    line_item_type: 'shipment',
    adjustment_type: null,
    original_shipment_number: null,

    invoice_number: parseString(row['Invoice Number']),
    shipment_number: parseString(row['Shipment Number']),
    shipment_date: parseDate(row['Shipment Date']),
    booking_date: parseDate(row['Invoice Date']), // Use Invoice Date as booking date

    shipment_reference_1: parseString(row['Shipment Reference 1']),
    shipment_reference_2: parseString(row['Shipment Reference 2']),

    product_name: parseString(row['Product Name']),
    pieces: parseNumber(row['Pieces']),
    weight_kg: parseNumber(row['Weight (kg)']),
    weight_flag: parseString(row['Weight Flag']),

    origin_country: parseString(row['Orig Country Name']),
    origin_city: parseString(row['Orig Name']),
    origin_postal_code: parseString(row['Senders Postcode']),

    destination_country: parseString(row['Dest Country Name']),
    destination_city: parseString(row['Dest Name']),
    destination_postal_code: parseString(row['Receivers Postcode']),

    net_amount: parseNumber(row['Total amount (excl. VAT)']),
    gross_amount: parseNumber(row['Total amount (incl. VAT)']),
    base_price: parseNumber(row['Weight Charge']),
    total_tax: parseNumber(row['Total Tax']),

    total_surcharges: parseNumber(row['Total Extra Charges (XC)']),
    total_surcharges_tax: parseNumber(row['Total Extra Charges Tax']),

    xc1_name: parseString(row['XC1 Name']),
    xc1_charge: parseNumber(row['XC1 Charge']),
    xc2_name: parseString(row['XC2 Name']),
    xc2_charge: parseNumber(row['XC2 Charge']),
    xc3_name: parseString(row['XC3 Name']),
    xc3_charge: parseNumber(row['XC3 Charge']),
    xc4_name: parseString(row['XC4 Name']),
    xc4_charge: parseNumber(row['XC4 Charge']),
    xc5_name: parseString(row['XC5 Name']),
    xc5_charge: parseNumber(row['XC5 Charge']),
    xc6_name: parseString(row['XC6 Name']),
    xc6_charge: parseNumber(row['XC6 Charge']),
    xc7_name: parseString(row['XC7 Name']),
    xc7_charge: parseNumber(row['XC7 Charge']),
    xc8_name: parseString(row['XC8 Name']),
    xc8_charge: parseNumber(row['XC8 Charge']),
    xc9_name: parseString(row['XC9 Name']),
    xc9_charge: parseNumber(row['XC9 Charge']),
  };
}

/**
 * Convert template CSV row to line item object
 */
function convertTemplateRowToLineItem(row: DHLTemplateCSVRow): Omit<InvoiceLineItem, 'id' | 'invoice_extraction_id' | 'created_at' | 'updated_at'> {
  return {
    invoice_number: parseString(row['Invoice Number']),
    shipment_number: parseString(row['Shipment Number']),
    shipment_date: parseDate(row['Shipment Date']),
    booking_date: parseDate(row['Booking Created Date']),

    shipment_reference_1: parseString(row['Shipment Reference 1']),
    shipment_reference_2: parseString(row['Shipment Reference 2']),

    product_name: parseString(row['Product Name']),
    pieces: parseNumber(row['Pieces']),
    weight_kg: parseNumber(row['Weight (kg)']),
    weight_flag: parseString(row['Weight Flag']),

    origin_country: parseString(row['Origin Country Name']),
    origin_city: parseString(row['Origin Name']),
    origin_postal_code: parseString(row['Senders Postcode']),

    destination_country: parseString(row['Destination Country Name']),
    destination_city: parseString(row['Destination Name']),
    destination_postal_code: parseString(row['Receivers Postcode']),

    net_amount: parseNumber(row['Net amount']),
    gross_amount: parseNumber(row['Gross amount']),
    base_price: parseNumber(row['Base Price']),
    total_tax: parseNumber(row['Total Tax']),

    total_surcharges: parseNumber(row['Total Extra Charges (XC)']),
    total_surcharges_tax: parseNumber(row['Total Extra Charges Tax']),

    vendor: 'DHL',
    line_item_type: 'shipment',
    description: null,
    adjustment_type: null,
    original_shipment_number: null,

    xc1_name: parseString(row['XC1 Name']),
    xc1_charge: parseNumber(row['XC1 Charge']),
    xc2_name: parseString(row['XC2 Name']),
    xc2_charge: parseNumber(row['XC2 Charge']),
    xc3_name: parseString(row['XC3 Name']),
    xc3_charge: parseNumber(row['XC3 Charge']),
    xc4_name: parseString(row['XC4 Name']),
    xc4_charge: parseNumber(row['XC4 Charge']),
    xc5_name: parseString(row['XC5 Name']),
    xc5_charge: parseNumber(row['XC5 Charge']),
    xc6_name: parseString(row['XC6 Name']),
    xc6_charge: parseNumber(row['XC6 Charge']),
    xc7_name: parseString(row['XC7 Name']),
    xc7_charge: parseNumber(row['XC7 Charge']),
    xc8_name: parseString(row['XC8 Name']),
    xc8_charge: parseNumber(row['XC8 Charge']),
    xc9_name: parseString(row['XC9 Name']),
    xc9_charge: parseNumber(row['XC9 Charge']),
  };
}

/**
 * UPS Simplified CSV row structure (16 columns with Record Type)
 */
interface UPSSimplifiedCSVRow {
  'Invoice Number': string;
  'Shipment Number': string;
  'Reference Number 1': string;
  'Reference Number 2': string;
  'Booking Created Date': string;
  'Shipment Date': string;
  'Service Type': string;
  'Quantity': string;
  'Origin Country': string;
  'Destination Country': string;
  'Sender City': string;
  'Recipient City': string;
  'Weight': string;
  'Customer Scale Weight': string;
  'Net Amount': string;
  'Record Type': string;
}

/**
 * Convert UPS Simplified CSV rows to line items
 * Groups rows by Shipment Number and sums all charges
 * Handles standalone adjustments that don't have a Shipment row
 */
function convertUPSSimplifiedToLineItems(
  rows: UPSSimplifiedCSVRow[]
): Omit<InvoiceLineItem, 'id' | 'invoice_extraction_id' | 'created_at' | 'updated_at'>[] {
  // Group rows by Shipment Number
  const shipmentGroups = new Map<string, UPSSimplifiedCSVRow[]>();

  rows.forEach((row) => {
    const shipmentNumber = parseString(row['Shipment Number']);
    if (!shipmentNumber) return;

    if (!shipmentGroups.has(shipmentNumber)) {
      shipmentGroups.set(shipmentNumber, []);
    }
    shipmentGroups.get(shipmentNumber)!.push(row);
  });

  // Convert each shipment group to a LineItem
  const lineItems: Omit<InvoiceLineItem, 'id' | 'invoice_extraction_id' | 'created_at' | 'updated_at'>[] = [];

  shipmentGroups.forEach((shipmentRows, shipmentNumber) => {
    // Find the main Shipment row (Record Type = "Shipment")
    const shipmentRow = shipmentRows.find(r => r['Record Type'] === 'Shipment');

    // If no shipment row, check if this is a standalone adjustment
    if (!shipmentRow) {
      // Check if all rows for this tracking number are adjustments
      const allAdjustments = shipmentRows.every(r => r['Record Type'] === 'Adjustment');
      if (allAdjustments) {
        // Create a line item for standalone adjustments
        const firstAdjustment = shipmentRows[0];
        const totalAdjustmentAmount = shipmentRows.reduce(
          (sum, row) => sum + (parseNumber(row['Net Amount']) || 0),
          0
        );

        // Use Record type to allow dynamic xc field assignment
        const adjustmentLineItem: Record<string, string | number | null> = {
          invoice_number: parseString(firstAdjustment['Invoice Number']),
          shipment_number: shipmentNumber,
          shipment_date: parseDate(firstAdjustment['Shipment Date']),
          booking_date: parseDate(firstAdjustment['Booking Created Date']),

          shipment_reference_1: parseString(firstAdjustment['Reference Number 1']),
          shipment_reference_2: parseString(firstAdjustment['Reference Number 2']),

          product_name: parseString(firstAdjustment['Service Type']),
          pieces: parseNumber(firstAdjustment['Quantity']) || 0,
          weight_kg: parseNumber(firstAdjustment['Customer Scale Weight']) || parseNumber(firstAdjustment['Weight']) || 0,
          weight_flag: 'L',

          origin_country: parseString(firstAdjustment['Origin Country']),
          origin_city: parseString(firstAdjustment['Sender City']),
          origin_postal_code: null,

          destination_country: parseString(firstAdjustment['Destination Country']),
          destination_city: parseString(firstAdjustment['Recipient City']),
          destination_postal_code: null,

          base_price: 0, // No base shipment charge
          net_amount: totalAdjustmentAmount, // Can be negative
          gross_amount: totalAdjustmentAmount,
          total_tax: 0,

          total_surcharges: totalAdjustmentAmount,
          total_surcharges_tax: 0,

          vendor: 'UPS',
          line_item_type: 'adjustment',
          description: null,
          adjustment_type: null,
          original_shipment_number: null,
        };

        // Add individual adjustments as extra charges
        let extraChargeIndex = 1;
        shipmentRows.forEach((adj) => {
          if (extraChargeIndex > 9) return;
          const chargeAmount = parseNumber(adj['Net Amount']) || 0;
          const chargeName = parseString(adj['Service Type']) || 'Adjustment';

          adjustmentLineItem[`xc${extraChargeIndex}_name`] = chargeName;
          adjustmentLineItem[`xc${extraChargeIndex}_charge`] = chargeAmount; // Keep sign!

          extraChargeIndex++;
        });

        // Cast to proper type - the Record has all required InvoiceLineItem fields
        lineItems.push(adjustmentLineItem as unknown as Omit<InvoiceLineItem, 'id' | 'invoice_extraction_id' | 'created_at' | 'updated_at'>);
      }
      return;
    }

    // Get base amount from Shipment row
    const baseAmount = parseNumber(shipmentRow['Net Amount']) || 0;

    // Get surcharges (Record Type = "Surcharge")
    const surcharges = shipmentRows.filter(r => r['Record Type'] === 'Surcharge');

    // Get adjustments (Record Type = "Adjustment")
    const adjustments = shipmentRows.filter(r => r['Record Type'] === 'Adjustment');

    // Calculate total surcharges
    let totalSurcharges = 0;
    let extraChargeIndex = 1;
    // Create line item with known fields, extra charge fields added dynamically
    // Use Record type to allow dynamic xc field assignment
    const lineItem: Record<string, string | number | null> = {
      invoice_number: parseString(shipmentRow['Invoice Number']),
      shipment_number: shipmentNumber,
      shipment_date: parseDate(shipmentRow['Shipment Date']),
      booking_date: parseDate(shipmentRow['Booking Created Date']),

      shipment_reference_1: parseString(shipmentRow['Reference Number 1']),
      shipment_reference_2: parseString(shipmentRow['Reference Number 2']),

      product_name: parseString(shipmentRow['Service Type']),
      pieces: parseNumber(shipmentRow['Quantity']),
      weight_kg: parseNumber(shipmentRow['Customer Scale Weight']) || parseNumber(shipmentRow['Weight']),
      weight_flag: 'L', // UPS typically uses lbs

      origin_country: parseString(shipmentRow['Origin Country']),
      origin_city: parseString(shipmentRow['Sender City']),
      origin_postal_code: null,

      destination_country: parseString(shipmentRow['Destination Country']),
      destination_city: parseString(shipmentRow['Recipient City']),
      destination_postal_code: null,

      base_price: baseAmount,
      net_amount: baseAmount,
      gross_amount: baseAmount,
      total_tax: 0,

      total_surcharges: 0,
      total_surcharges_tax: 0,

      vendor: 'UPS',
      line_item_type: 'shipment',
      description: null,
      adjustment_type: null,
      original_shipment_number: null,
    };

    // Add surcharges as extra charges
    surcharges.forEach((surcharge) => {
      if (extraChargeIndex > 9) return; // Max 9 extra charges

      const chargeAmount = parseNumber(surcharge['Net Amount']) || 0;
      const chargeName = parseString(surcharge['Service Type']) || 'Surcharge';

      lineItem[`xc${extraChargeIndex}_name`] = chargeName;
      lineItem[`xc${extraChargeIndex}_charge`] = chargeAmount; // Keep sign!

      totalSurcharges += chargeAmount; // Can be positive or negative
      extraChargeIndex++;
    });

    // Add adjustments as extra charges
    adjustments.forEach((adjustment) => {
      if (extraChargeIndex > 9) return; // Max 9 extra charges

      const chargeAmount = parseNumber(adjustment['Net Amount']) || 0;
      const chargeName = parseString(adjustment['Service Type']) || 'Adjustment';

      lineItem[`xc${extraChargeIndex}_name`] = chargeName;
      lineItem[`xc${extraChargeIndex}_charge`] = chargeAmount; // Keep sign!

      totalSurcharges += chargeAmount; // Can be positive or negative
      extraChargeIndex++;
    });

    // Update totals
    lineItem.total_surcharges = totalSurcharges;
    lineItem.gross_amount = baseAmount + totalSurcharges;
    lineItem.net_amount = lineItem.gross_amount as number;

    // Cast to proper type - the Record has all required InvoiceLineItem fields
    lineItems.push(lineItem as unknown as Omit<InvoiceLineItem, 'id' | 'invoice_extraction_id' | 'created_at' | 'updated_at'>);
  });

  return lineItems;
}

/**
 * Detect CSV format based on headers
 */
function detectCSVFormat(headers: string[]): 'raw' | 'template' | 'ups' | 'ups_simplified' | 'eurosender' | 'gls' | 'hive' | 'unknown' {
  const headerStr = headers.join('|').toLowerCase();

  // GLS format has specific headers like "Gepard Customer ID", "Parcel Number", "Document No."
  const hasGepardCustomerId = headers.includes('Gepard Customer ID');
  const hasParcelNumber = headers.includes('Parcel Number');
  const hasDocumentNo = headers.includes('Document No.');

  if (hasGepardCustomerId && hasParcelNumber && hasDocumentNo) {
    return 'gls';
  }

  // Hive format has specific headers like "Shipment Reference", "Shop Order ID", "Hive Order ID"
  const hasShipmentReference = headers.includes('Shipment Reference');
  const hasShopOrderId = headers.includes('Shop Order ID');
  const hasHiveOrderId = headers.includes('Hive Order ID');

  if (hasShipmentReference && hasShopOrderId && hasHiveOrderId) {
    return 'hive';
  }

  // Eurosender format has specific headers like "Document name", "Order code", "Pickup date"
  // Typical headers: Document name, Order code, Order date, Pickup date, Tracking number, Service type, Total calculated weight (kg), Pickup address, Delivery address, Total NET amount, Packages NET total, Refund NET total
  const hasDocumentName = headers.includes('Document name');
  const hasOrderCode = headers.includes('Order code');
  const hasPickupDate = headers.includes('Pickup date');
  const hasTrackingNumber = headers.includes('Tracking number');
  const hasServiceType = headers.includes('Service type');
  const hasPackagesNetTotal = headers.includes('Packages NET total');

  if (hasDocumentName && hasOrderCode && hasPickupDate && hasTrackingNumber && hasServiceType && hasPackagesNetTotal) {
    return 'eurosender';
  }

  // UPS Simplified format (has headers with Record Type column)
  // Headers: Invoice Number, Shipment Number, ..., Record Type
  // This is a pre-parsed UPS format with Shipment/Surcharge/Adjustment rows
  if (headers.includes('Record Type') && headers.includes('Net Amount') && headers.includes('Shipment Number')) {
    return 'ups_simplified';
  }

  // UPS RAW format has NO header row - first row is data
  // When csv-parse reads with columns:true, it treats first row as headers
  // This means the "headers" array actually contains VALUES from the first row
  // UPS CSV characteristics:
  //   - Contains "2.1" or "2.0" (version)
  //   - Contains UPS tracking numbers like "1ZEG532..." (18 chars starting with 1Z)
  //   - Does NOT contain proper column names (no spaces, not titlecase like "Invoice Number")
  const hasUPSVersion = headers.includes('2.1') || headers.includes('2.0');
  const hasTrackingPattern = headers.some(h => /^1Z[A-Z0-9]{16}$/.test(h)); // UPS tracking format (exactly 18 chars)

  // Check for actual DHL-style column names (titlecase with spaces like "Invoice Number")
  const hasProperColumnNames = headers.some(h =>
    h === 'Invoice Number' ||
    h === 'Shipment Number' ||
    h === 'Shipment Date' ||
    h === 'Line Type' ||
    h === 'Booking Created Date'
  );

  // UPS RAW CSV has version + tracking but NO proper column names
  if (hasUPSVersion && hasTrackingPattern && !hasProperColumnNames) {
    return 'ups';
  }

  // RAW DHL format has "Line Type" and uses "Orig" / "Dest"
  if (headerStr.includes('line type') && headerStr.includes('orig country')) {
    return 'raw';
  }

  // Template DHL format has "Booking Created Date" and uses "Origin" / "Destination"
  if (headerStr.includes('booking created date') && headerStr.includes('origin country')) {
    return 'template';
  }

  return 'unknown';
}

/**
 * Parse invoice CSV file and return array of line items
 * Automatically detects RAW vs Template format
 *
 * @param filePath - Path to the CSV file
 * @returns Array of line item objects (without id, invoice_extraction_id, timestamps)
 */
export function parseInvoiceCSV(
  filePath: string
): Array<Omit<InvoiceLineItem, 'id' | 'invoice_extraction_id' | 'created_at' | 'updated_at'>> {
  const fileContent = readFileSync(filePath, 'utf-8');

  // Auto-detect delimiter from first line
  const firstLine = fileContent.split('\n')[0];
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  // Parse CSV
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true, // Handle UTF-8 BOM if present
    delimiter: delimiter,
    relax_quotes: true,
    relax_column_count: true,
    skip_records_with_error: true,
  });

  if (records.length === 0) {
    throw new Error('CSV file is empty or has no valid rows');
  }

  // Validate row count (prevent memory issues)
  if (records.length > MAX_LINE_ITEMS) {
    throw new Error(`CSV file has too many rows (${records.length}). Maximum allowed is ${MAX_LINE_ITEMS}.`);
  }

  // Detect format based on headers
  const headers = Object.keys(records[0]);
  const format = detectCSVFormat(headers);

  if (format === 'unknown') {
    throw new Error(
      `Unsupported CSV format. Expected DHL (RAW/Template), UPS (RAW/Simplified), Eurosender, or similar format. Found headers: ${headers.slice(0, 5).join(', ')}...`
    );
  }

  // UPS format should be handled by csv-parser.ts (parseUPSCSV) not here
  if (format === 'ups') {
    throw new Error(
      'UPS RAW format detected but should be handled by parseUPSCSV in csv-parser.ts. This is a programming error.'
    );
  }

  // Eurosender format should be handled by csv-parser.ts (parseEurosenderCSV) not here
  if (format === 'eurosender') {
    throw new Error(
      'Eurosender format detected but should be handled by parseEurosenderCSV in csv-parser.ts. This is a programming error.'
    );
  }

  // GLS format should be handled by csv-parser.ts (parseGLSCSV) not here
  if (format === 'gls') {
    throw new Error(
      'GLS format detected but should be handled by parseGLSCSV in csv-parser.ts. This is a programming error.'
    );
  }

  // Hive format should be handled by csv-parser.ts (parseHiveCSV) not here
  if (format === 'hive') {
    throw new Error(
      'Hive format detected but should be handled by parseHiveCSV in csv-parser.ts. This is a programming error.'
    );
  }

  // Convert rows based on detected format
  if (format === 'raw') {
    // DHL RAW format: Filter to only include "S" (Shipment) rows, exclude "I" (Invoice header) rows
    return records
      .filter((row: DHLRawCSVRow) => row['Line Type'] === 'S')
      .map((row: DHLRawCSVRow) => convertRawDHLRowToLineItem(row));
  } else if (format === 'template') {
    // DHL Template format: All rows are shipments
    return records.map((row: DHLTemplateCSVRow) => convertTemplateRowToLineItem(row));
  } else if (format === 'ups_simplified') {
    // UPS Simplified format: Group rows by shipment number
    return convertUPSSimplifiedToLineItems(records as UPSSimplifiedCSVRow[]);
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Validate CSV file before processing
 * Returns validation result with row count or error message
 */
export function validateInvoiceCSV(filePath: string): { valid: boolean; error?: string; rowCount?: number } {
  try {
    const fileContent = readFileSync(filePath, 'utf-8');

    // Basic checks
    if (!fileContent || fileContent.trim().length === 0) {
      return { valid: false, error: 'CSV file is empty' };
    }

    // Auto-detect delimiter from first line
    const firstLine = fileContent.split('\n')[0];
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ';' : ',';

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      delimiter: delimiter,
      relax_quotes: true,
      relax_column_count: true,
      skip_records_with_error: true,
    });

    if (records.length === 0) {
      return { valid: false, error: 'CSV file has no valid data rows' };
    }

    // Validate row count
    if (records.length > MAX_LINE_ITEMS) {
      return {
        valid: false,
        error: `CSV file has too many rows (${records.length}). Maximum allowed is ${MAX_LINE_ITEMS}.`,
      };
    }

    // Check format
    const headers = Object.keys(records[0]);
    const format = detectCSVFormat(headers);

    if (format === 'unknown') {
      return {
        valid: false,
        error: `Unsupported CSV format. Expected DHL (RAW/Template), UPS, Eurosender, GLS, or Hive format. Found headers: ${headers.slice(0, 5).join(', ')}...`,
      };
    }

    // For GLS, Hive, and UPS RAW format, skip column validation (will be parsed by csv-parser)
    if (format === 'ups' || format === 'gls' || format === 'hive') {
      return { valid: true, rowCount: records.length };
    }

    // For Eurosender format, skip column validation (will be parsed by csv-parser)
    if (format === 'eurosender') {
      return { valid: true, rowCount: records.length };
    }

    // Validate required columns based on format
    let requiredColumns: string[] = [];
    if (format === 'raw') {
      // DHL RAW format
      requiredColumns = ['Invoice Number', 'Shipment Number', 'Shipment Date'];
    } else if (format === 'template') {
      // DHL Template format
      requiredColumns = ['Invoice Number', 'Shipment Number', 'Shipment Date', 'Booking Created Date'];
    } else if (format === 'ups_simplified') {
      // UPS Simplified format
      requiredColumns = ['Invoice Number', 'Shipment Number', 'Record Type', 'Net Amount'];
    }

    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    if (missingColumns.length > 0) {
      return {
        valid: false,
        error: `Missing required columns: ${missingColumns.join(', ')}`,
      };
    }

    return { valid: true, rowCount: records.length };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
