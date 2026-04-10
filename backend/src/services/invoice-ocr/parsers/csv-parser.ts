import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { OCRLineItem } from '@shared/types';
import { logger } from '../../../utils/logger';
import { roundAmount } from '../utils';

export interface CSVParserConfig {
  vendor: 'ups' | 'dhl' | 'eurosender' | 'mrw' | 'sendcloud' | 'gls' | 'hive' | 's2c';
  hasHeader: boolean;
  delimiter: string;
  encoding?: string;
}

/**
 * Type-safe helper to set extra charge fields (xc1-xc9) on OCRLineItem
 * Avoids unsafe type assertions while maintaining type safety
 */
function setExtraCharge(
  lineItem: OCRLineItem,
  index: number,
  name: string,
  charge: number
): void {
  if (index < 1 || index > 9) return;

  switch (index) {
    case 1: lineItem.xc1_name = name; lineItem.xc1_charge = charge; break;
    case 2: lineItem.xc2_name = name; lineItem.xc2_charge = charge; break;
    case 3: lineItem.xc3_name = name; lineItem.xc3_charge = charge; break;
    case 4: lineItem.xc4_name = name; lineItem.xc4_charge = charge; break;
    case 5: lineItem.xc5_name = name; lineItem.xc5_charge = charge; break;
    case 6: lineItem.xc6_name = name; lineItem.xc6_charge = charge; break;
    case 7: lineItem.xc7_name = name; lineItem.xc7_charge = charge; break;
    case 8: lineItem.xc8_name = name; lineItem.xc8_charge = charge; break;
    case 9: lineItem.xc9_name = name; lineItem.xc9_charge = charge; break;
  }
}

/**
 * Map 2-letter country codes to full country names
 * Used by GLS and other carriers that provide country codes instead of names
 */
const COUNTRY_CODE_MAP: Record<string, string> = {
  DE: 'Germany',
  AT: 'Austria',
  CH: 'Switzerland',
  NL: 'Netherlands',
  BE: 'Belgium',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  PT: 'Portugal',
  PL: 'Poland',
  CZ: 'Czechia',
  SK: 'Slovakia',
  HU: 'Hungary',
  SI: 'Slovenia',
  HR: 'Croatia',
  DK: 'Denmark',
  SE: 'Sweden',
  NO: 'Norway',
  FI: 'Finland',
  IE: 'Ireland',
  GB: 'United Kingdom',
  UK: 'United Kingdom',
  LU: 'Luxembourg',
  GR: 'Greece',
  RO: 'Romania',
  BG: 'Bulgaria',
  LT: 'Lithuania',
  LV: 'Latvia',
  EE: 'Estonia',
  US: 'United States',
};

/**
 * Convert country code to full country name
 */
function getCountryName(code: string | undefined): string {
  if (!code) return '';
  const upperCode = code.trim().toUpperCase();
  return COUNTRY_CODE_MAP[upperCode] || code;
}

/**
 * GLS CSV row structure (parsed with columns: true)
 */
interface GLSCSVRow {
  'Gepard Customer ID'?: string;
  'Document No.'?: string;
  'Document Date'?: string;
  'Parcel Number'?: string;
  'Date'?: string;
  'Inv.- Weight kg'?: string;
  'Net amount'?: string;
  'Article Number'?: string;
  'Description'?: string;
  'Reference(s) per parcel'?: string;
  'Delivery Country'?: string;
  'Consignee Zipcode'?: string;
  'Consignee City'?: string;
  'Consignee Street 1'?: string;
  'Recipient name'?: string;
  [key: string]: string | undefined;
}

/**
 * Hive CSV row structure (parsed with columns: true)
 */
interface HiveCSVRow {
  'Shipment Reference'?: string;
  'Shop Order ID'?: string;
  'Hive Order ID'?: string;
  'Shipment Date'?: string;
  'Order Type'?: string;
  'Destination Country'?: string;
  'Carrier'?: string;
  'Weight (kg)'?: string;
  'Delivery Price (€)'?: string;
  'B2C Fulfillment Price (€)'?: string;
  [key: string]: string | undefined;
}

/**
 * Sendcloud CSV row structure (parsed with columns: true)
 * Multiple rows per shipment: Type "Shipments" = base, "Surcharge" = surcharges
 */
interface SendcloudCSVRow {
  'Description'?: string;           // Service name (e.g., "UPS Standard 7-8kg 7-8kg")
  'Date'?: string;                  // Shipment date (e.g., "2026-02-04")
  'Reference'?: string;             // Tracking number (e.g., "1Z01CB726832266473")
  'Amount'?: string;                // Charge amount (e.g., "8.45")
  'Type'?: string;                  // "Shipments" or "Surcharge"
  'Order number'?: string;          // Order reference (e.g., "1653990S1")
  'Integration'?: string;           // Integration type (e.g., "api_v2")
  'From Address 1'?: string;
  'From Address 2'?: string;
  'From House Number'?: string;
  'From City'?: string;
  'From Postal Code'?: string;
  'From Country'?: string;
  'To Address 1'?: string;
  'To Address 2'?: string;
  'To House Number'?: string;
  'To City'?: string;
  'To Postal Code'?: string;
  'To Country'?: string;
  [key: string]: string | undefined;
}

/**
 * UPS CSV Column Indices (0-based)
 * Based on "Carrier level invoice column explanations.csv" specification
 *
 * Key fields with Include status:
 * - Invoice Date (4): Self explanatory
 * - Invoice Number (5): Self explanatory
 * - Invoice Currency Code (9): Self explanatory
 * - Invoice Amount (10): Total amount of invoice
 * - Transaction Date (11): Pickup date as per UPS
 * - Lead Shipment Number (13): Backup when Tracking Number is empty
 * - Shipment Reference Number 1 (15): Primary reference, fallback to #2
 * - Shipment Reference Number 2 (16): Secondary reference
 * - Tracking Number (20): Primary tracking identifier
 * - Entered Weight (26): Weight provided by buycycle while booking
 * - Entered Weight UoM (27): Weight measure by buycycle
 * - Billed Weight (28): Billed weight provided by UPS
 * - Billed Weight UoM (29): Billed weight measure by UPS
 * - Billed Weight Type (31): Final calculated weight type for charges
 * - Package Dimensions (32): Package dims measured by UPS
 * - Charge Description Code (44): Type of charge code
 * - Charge Description (45): Type of charge description - very important
 * - Incentive Amount (51): Discount provided by UPS as per contract
 * - Net Amount (52): Net charge - very important
 * - Invoice Due Date (70): Self explanatory
 * - Sender Name/Company/Address/City/State/Postal/Country (74-81)
 * - Receiver Name/Company/Address/City/State/Postal/Country (82-89)
 */
const UPS_COLS = {
  // Invoice info
  INVOICE_DATE: 4,
  INVOICE_NUMBER: 5,
  INVOICE_CURRENCY_CODE: 9,
  INVOICE_AMOUNT: 10,
  TRANSACTION_DATE: 11,        // Pickup date

  // Tracking - use TRACKING_NUMBER, fallback to LEAD_SHIPMENT_NUMBER
  LEAD_SHIPMENT_NUMBER: 13,    // Backup when tracking empty
  SHIPMENT_REF_1: 15,          // Primary reference
  SHIPMENT_REF_2: 16,          // Fallback reference
  TRACKING_NUMBER: 20,         // Primary tracking identifier

  // Weight fields
  ENTERED_WEIGHT: 26,          // buycycle's weight at booking
  ENTERED_WEIGHT_UOM: 27,
  BILLED_WEIGHT: 28,           // UPS measured/billed weight
  BILLED_WEIGHT_UOM: 29,
  BILLED_WEIGHT_TYPE: 31,      // Final weight type for billing
  PACKAGE_DIMENSIONS: 32,

  // Charge categorization
  RECORD_TYPE: 34,             // "SHP" for shipment, "ADJ" for adjustment
  CHARGE_CATEGORY: 43,         // "FRT" for freight, "ACC" for accessorial, "INF" for info
  CHARGE_DESCRIPTION_CODE: 44,
  CHARGE_DESCRIPTION: 45,

  // Pricing
  INCENTIVE_AMOUNT: 51,        // Discount from UPS contract
  NET_AMOUNT: 52,              // Billed charge

  // Due date
  INVOICE_DUE_DATE: 70,

  // Sender info (indices 74-81)
  SENDER_NAME: 74,
  SENDER_COMPANY: 75,
  SENDER_ADDRESS_1: 76,
  SENDER_ADDRESS_2: 77,
  SENDER_CITY: 78,
  SENDER_STATE: 79,
  SENDER_POSTAL: 80,
  SENDER_COUNTRY: 81,

  // Receiver info (indices 82-89)
  RECEIVER_NAME: 82,
  RECEIVER_COMPANY: 83,
  RECEIVER_ADDRESS_1: 84,
  RECEIVER_ADDRESS_2: 85,
  RECEIVER_CITY: 86,
  RECEIVER_STATE: 87,
  RECEIVER_POSTAL: 88,
  RECEIVER_COUNTRY: 89,
} as const;

/**
 * Parse UPS CSV and convert to OCRLineItem array
 */
export async function parseUPSCSV(csvPath: string): Promise<OCRLineItem[]> {
  logger.info({ csvPath }, 'Parsing UPS CSV file');

  const records: string[][] = [];

  return new Promise((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(
        parse({
          delimiter: ',',
          relax_column_count: true, // UPS CSVs may have variable columns
          skip_empty_lines: true,
        })
      )
      .on('data', (row: string[]) => {
        records.push(row);
      })
      .on('end', () => {
        try {
          const lineItems = transformUPSRows(records);
          logger.info(
            { lineItemCount: lineItems.length },
            'UPS CSV parsed successfully'
          );
          resolve(lineItems);
        } catch (error) {
          logger.error({ error }, 'Failed to transform UPS CSV rows');
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error, csvPath }, 'Failed to parse UPS CSV');
        reject(error);
      });
  });
}

/**
 * Get tracking number from row with fallback logic per spec:
 * - Use Tracking Number (col 20) as primary
 * - Fallback to Lead Shipment Number (col 13) if empty
 */
function getUPSTrackingNumber(row: string[]): string {
  const trackingNumber = row[UPS_COLS.TRACKING_NUMBER]?.trim();
  if (trackingNumber) return trackingNumber;

  // Fallback to Lead Shipment Number
  return row[UPS_COLS.LEAD_SHIPMENT_NUMBER]?.trim() || '';
}

/**
 * Get shipment reference with fallback logic per spec:
 * - Use Shipment Reference Number 1 as primary
 * - Fallback to Shipment Reference Number 2 if empty
 */
function getUPSShipmentReference(row: string[]): string {
  const ref1 = row[UPS_COLS.SHIPMENT_REF_1]?.trim();
  if (ref1) return ref1;

  return row[UPS_COLS.SHIPMENT_REF_2]?.trim() || '';
}

/**
 * Transform raw UPS CSV rows into OCRLineItem objects
 */
function transformUPSRows(rows: string[][]): OCRLineItem[] {
  const lineItems: OCRLineItem[] = [];
  const shipmentGroups = new Map<string, string[][]>();

  // Group rows by tracking number (with fallback logic)
  // UPS CSV has multiple rows per shipment (base charge + surcharges)
  rows.forEach((row) => {
    const trackingNumber = getUPSTrackingNumber(row);
    if (!trackingNumber) return;

    if (!shipmentGroups.has(trackingNumber)) {
      shipmentGroups.set(trackingNumber, []);
    }
    shipmentGroups.get(trackingNumber)!.push(row);
  });

  // Convert each shipment group to a LineItem
  shipmentGroups.forEach((shipmentRows, trackingNumber) => {
    const lineItem = buildLineItemFromShipment(shipmentRows, trackingNumber);
    if (lineItem) {
      lineItems.push(lineItem);
    }
  });

  return lineItems;
}

/**
 * Build a single OCRLineItem from multiple CSV rows for one shipment
 * Uses column indices from UPS_COLS based on CSV specification
 */
function buildLineItemFromShipment(
  rows: string[][],
  trackingNumber: string
): OCRLineItem | null {
  // Find the base shipment row (SHP type with FRT charge)
  const baseRow = rows.find(
    (r) => r[UPS_COLS.RECORD_TYPE] === 'SHP' && r[UPS_COLS.CHARGE_CATEGORY] === 'FRT'
  ) || rows[0];
  if (!baseRow) return null;

  // Get shipment reference with fallback logic (ref1 → ref2)
  const shipmentReference = getUPSShipmentReference(baseRow);

  // Get entered weight (buycycle's booking weight) and billed weight (UPS measured)
  const enteredWeight = parseFloat(baseRow[UPS_COLS.ENTERED_WEIGHT]) || 0;
  const billedWeight = parseFloat(baseRow[UPS_COLS.BILLED_WEIGHT]) || 0;
  const enteredWeightUom = baseRow[UPS_COLS.ENTERED_WEIGHT_UOM]?.trim() || 'L';
  const billedWeightUom = baseRow[UPS_COLS.BILLED_WEIGHT_UOM]?.trim() || 'L';
  const billedWeightType = baseRow[UPS_COLS.BILLED_WEIGHT_TYPE]?.trim() || '';

  // Get incentive/discount amount (contract discount from UPS)
  const incentiveAmount = parseFloat(baseRow[UPS_COLS.INCENTIVE_AMOUNT]) || 0;

  // Build sender address (for potential future use in origin_name)
  const senderFullAddress = [
    baseRow[UPS_COLS.SENDER_ADDRESS_1],
    baseRow[UPS_COLS.SENDER_ADDRESS_2],
    baseRow[UPS_COLS.SENDER_CITY],
    baseRow[UPS_COLS.SENDER_STATE],
  ].filter(Boolean).join(', ');

  // Build receiver address (for potential future use in destination_name)
  const receiverFullAddress = [
    baseRow[UPS_COLS.RECEIVER_ADDRESS_1],
    baseRow[UPS_COLS.RECEIVER_ADDRESS_2],
    baseRow[UPS_COLS.RECEIVER_CITY],
    baseRow[UPS_COLS.RECEIVER_STATE],
  ].filter(Boolean).join(', ');

  const lineItem: OCRLineItem = {
    // Vendor identification
    vendor: 'UPS',
    line_item_type: 'shipment',

    shipment_number: trackingNumber,
    shipment_date: baseRow[UPS_COLS.TRANSACTION_DATE] || '', // Pickup date
    shipment_reference_1: shipmentReference,                  // Combined ref with fallback
    shipment_reference_2: baseRow[UPS_COLS.INVOICE_NUMBER] || '', // Invoice number for reference

    // Invoice info
    invoice_number: baseRow[UPS_COLS.INVOICE_NUMBER] || '',
    invoice_date: baseRow[UPS_COLS.INVOICE_DATE] || '',
    invoice_due_date: baseRow[UPS_COLS.INVOICE_DUE_DATE] || '',
    currency: baseRow[UPS_COLS.INVOICE_CURRENCY_CODE] || 'USD',

    // Product/Service
    product_name: baseRow[UPS_COLS.CHARGE_DESCRIPTION] || 'UPS Ground',
    description: baseRow[UPS_COLS.CHARGE_DESCRIPTION] || 'UPS Ground',

    // Weight - store billed weight (what UPS charges for) with comparison data
    weight_kg: billedWeight || enteredWeight, // Use billed weight if available
    weight_flag: billedWeightUom || enteredWeightUom,

    // Additional weight fields for cost dispute analysis
    // Store in extra charge slots if there's a weight discrepancy
    // (entered vs billed weight comparison)

    // Package dimensions
    package_dimensions: baseRow[UPS_COLS.PACKAGE_DIMENSIONS] || '',

    // Origin (Sender) - aligned with DB column names
    origin_city: baseRow[UPS_COLS.SENDER_COMPANY] || baseRow[UPS_COLS.SENDER_NAME] || senderFullAddress || '',
    origin_country: baseRow[UPS_COLS.SENDER_COUNTRY] || 'US',
    origin_postal_code: baseRow[UPS_COLS.SENDER_POSTAL] || '',

    // Destination (Receiver) - aligned with DB column names
    destination_city: baseRow[UPS_COLS.RECEIVER_NAME] || baseRow[UPS_COLS.RECEIVER_COMPANY] || receiverFullAddress || '',
    destination_country: baseRow[UPS_COLS.RECEIVER_COUNTRY] || 'US',
    destination_postal_code: baseRow[UPS_COLS.RECEIVER_POSTAL] || '',

    // Pricing
    base_price: parseFloat(baseRow[UPS_COLS.NET_AMOUNT]) || 0,
    net_amount: parseFloat(baseRow[UPS_COLS.NET_AMOUNT]) || 0,
    gross_amount: parseFloat(baseRow[UPS_COLS.NET_AMOUNT]) || 0,

    // Discount from UPS contract
    incentive_amount: incentiveAmount,

    // Surcharges - will be calculated from surcharge rows (aligned with DB)
    total_surcharges: 0,
    total_surcharges_tax: 0,
    total_tax: 0,

    // Booking date (Invoice date for accounting) - aligned with DB
    booking_date: baseRow[UPS_COLS.INVOICE_DATE] || '',

    // Pieces (default to 1 for UPS packages)
    pieces: 1,
  };

  // Track weight discrepancy in notes if entered vs billed differ significantly
  if (enteredWeight > 0 && billedWeight > 0 && Math.abs(enteredWeight - billedWeight) > 0.5) {
    lineItem.weight_discrepancy = `Entered: ${enteredWeight}${enteredWeightUom}, Billed: ${billedWeight}${billedWeightUom} (${billedWeightType})`;
  }

  // Process ALL other rows: surcharges (ACC), adjustments (ADJ), corrections
  // Include rows that are:
  // - Not the base row
  // - Have non-zero amounts
  // - Not informational rows (INF)
  const adjustments = rows.filter(
    (r) => r !== baseRow &&
      parseFloat(r[UPS_COLS.NET_AMOUNT]) !== 0 &&
      r[UPS_COLS.CHARGE_CATEGORY] !== 'INF'
  );
  let extraChargeIndex = 1;
  let totalAdjustments = 0;
  let totalIncentives = incentiveAmount; // Start with base row incentive

  adjustments.forEach((adjRow) => {
    if (extraChargeIndex > 9) return; // Max 9 extra charges

    const chargeCode = adjRow[UPS_COLS.CHARGE_DESCRIPTION_CODE] || '';
    const chargeDesc = adjRow[UPS_COLS.CHARGE_DESCRIPTION] || '';
    const chargeAmount = parseFloat(adjRow[UPS_COLS.NET_AMOUNT]) || 0;
    const adjIncentive = parseFloat(adjRow[UPS_COLS.INCENTIVE_AMOUNT]) || 0;

    // Map to xc1_name, xc1_charge, xc2_name, xc2_charge, etc. using type-safe helper
    setExtraCharge(lineItem, extraChargeIndex, `${chargeCode}: ${chargeDesc}`, chargeAmount);

    totalAdjustments += chargeAmount; // Can be positive or negative
    totalIncentives += adjIncentive;  // Sum all incentives/discounts
    extraChargeIndex++;
  });

  lineItem.total_surcharges = totalAdjustments;
  lineItem.incentive_amount = totalIncentives;

  // Update gross and net amounts to include surcharges and adjustments
  lineItem.gross_amount = (lineItem.net_amount || 0) + totalAdjustments;
  lineItem.net_amount = lineItem.gross_amount; // In UPS, net = gross (no separate tax)

  return lineItem;
}

/**
 * Eurosender CSV Column Indices (0-based)
 * Native Eurosender invoice export format (12 columns)
 * Verified against actual Eurosender-Invoice1.csv file
 * Columns: Document name, Order code, Order date, Pickup date, Tracking number,
 *          Service type, Total calculated weight (kg), Pickup address, Delivery address,
 *          Total NET amount, Packages NET total, Refund NET total
 */
const EUROSENDER_COLS = {
  INVOICE_NUMBER: 0,          // "Document name" - Invoice number (e.g., "INV-26-025481")
  ORDER_CODE: 1,              // "Order code" - Order/shipment reference (e.g., "293515-26")
  BOOKING_CREATED_DATE: 2,    // "Order date" - Booking/order date (e.g., "2026-01-29")
  PICKUP_DATE: 3,             // "Pickup date" - Actual pickup/shipment date (e.g., "2026-02-09")
  TRACKING_NUMBER: 4,         // "Tracking number" - Carrier tracking (e.g., "888292165577")
  SERVICE_TYPE: 5,            // "Service type" - Service name (e.g., "Priority pallet")
  WEIGHT_KG: 6,               // "Total calculated weight (kg)" - Weight in kg (e.g., "97")
  PICKUP_ADDRESS: 7,          // "Pickup address" - Full pickup address with country code
  DELIVERY_ADDRESS: 8,        // "Delivery address" - Full delivery address with country code
  TOTAL_NET_AMOUNT: 9,        // "Total NET amount" - Invoice total (NOT per line item!)
  PACKAGES_NET_TOTAL: 10,     // "Packages NET total" - Individual line item price (e.g., "66.73")
  REFUND_NET_TOTAL: 11,       // "Refund NET total" - Refund amount (e.g., "0")
} as const;

/**
 * DHL CSV Column Indices (0-based)
 * VERIFIED against actual mucir00169682.csv file
 */
const DHL_COLS = {
  // Row identification
  LINE_TYPE: 0,              // "I" = Invoice summary, "S" = Shipment

  // Invoice info
  INVOICE_NUMBER: 3,
  INVOICE_DATE: 7,

  // Shipment info
  SHIPMENT_NUMBER: 23,
  SHIPMENT_DATE: 24,
  SHIPMENT_REF_1: 27,
  SHIPMENT_REF_2: 28,
  PRODUCT_NAME: 31,
  PIECES: 32,

  // Origin
  ORIGIN_NAME: 34,
  ORIGIN_COUNTRY_NAME: 36,
  SENDERS_POSTCODE: 41,

  // Destination
  DESTINATION_NAME: 47,
  DESTINATION_COUNTRY_NAME: 49,
  RECEIVERS_POSTCODE: 54,

  // Weight
  WEIGHT_FLAG: 67,           // A=Actual, B=Billed, V=Cust Vol, W=DHL Vol
  WEIGHT_KG: 68,

  // Pricing
  CURRENCY: 69,
  NET_AMOUNT: 70,            // Total amount (excl. VAT)
  GROSS_AMOUNT: 71,          // Total amount (incl. VAT)
  TOTAL_TAX: 73,
  WEIGHT_CHARGE: 76,         // This is the base_price

  // Extra charges summary
  TOTAL_EXTRA_CHARGES: 88,
  TOTAL_EXTRA_CHARGES_TAX: 89,

  // XC1-XC9 (each has 7 columns: Code, Name, Charge, Tax Code, Tax, Discount, Total)
  XC1: { CODE: 90, NAME: 91, CHARGE: 92 },
  XC2: { CODE: 97, NAME: 98, CHARGE: 99 },
  XC3: { CODE: 104, NAME: 105, CHARGE: 106 },
  XC4: { CODE: 111, NAME: 112, CHARGE: 113 },
  XC5: { CODE: 118, NAME: 119, CHARGE: 120 },
  XC6: { CODE: 125, NAME: 126, CHARGE: 127 },
  XC7: { CODE: 132, NAME: 133, CHARGE: 134 },
  XC8: { CODE: 139, NAME: 140, CHARGE: 141 },
  XC9: { CODE: 146, NAME: 147, CHARGE: 148 },
} as const;

/**
 * Parse European number format (comma as decimal separator)
 * Examples:
 *   "14,47" → 14.47
 *   "1.234,56" → 1234.56 (handles thousand separators)
 *   "" or undefined → 0
 */
function parseEuropeanNumber(value: string | undefined): number {
  if (!value || value.trim() === '') return 0;

  // Remove thousand separators (periods in European format)
  // Then convert comma to period for decimal
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');

  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Format DHL date from YYYYMMDD to YYYY-MM-DD
 * Examples:
 *   "20260206" → "2026-02-06"
 *   "" or invalid → ""
 */
function formatDHLDate(dateStr: string | undefined): string {
  if (!dateStr || dateStr.trim().length !== 8) return '';

  const trimmed = dateStr.trim();
  const year = trimmed.substring(0, 4);
  const month = trimmed.substring(4, 6);
  const day = trimmed.substring(6, 8);

  // Validate it's actually a date
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return '';
  }

  return `${year}-${month}-${day}`;
}

/**
 * DHL CSV has 150+ columns with the following key fields:
 * - col 0: line_type ("I" = invoice summary, "S" = shipment detail)
 * - col 3: invoice_number
 * - col 7: invoice_date
 * - col 23: shipment_number
 * - col 24: shipment_date
 * - col 27-28: references
 * - col 31: product_name
 * - col 32: pieces
 * - col 34-36: origin (name, country code, country name)
 * - col 47-49: destination (name, country code, country name)
 * - col 67-68: weight_flag, weight_kg
 * - col 70-71: net_amount, gross_amount
 * - col 73: total_tax
 * - col 76: base_price (weight charge)
 * - col 88-89: total_extra_charges, total_extra_charges_tax
 * - col 90-148: XC1-XC9 details (code, name, charge, tax code, tax, discount, total) × 9
 */
export async function parseDHLCSV(csvPath: string): Promise<OCRLineItem[]> {
  logger.info({ csvPath }, 'Parsing DHL CSV file');

  const records: string[][] = [];

  return new Promise((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(
        parse({
          delimiter: ',',
          skip_empty_lines: true,
          relax_column_count: true,  // Handle variable column counts
          from_line: 2,              // Skip header row (line 1)
        })
      )
      .on('data', (row: string[]) => {
        records.push(row);
      })
      .on('end', () => {
        try {
          const lineItems = transformDHLRows(records);
          logger.info(
            { lineItemCount: lineItems.length },
            'DHL CSV parsed successfully'
          );
          resolve(lineItems);
        } catch (error) {
          logger.error({ error }, 'Failed to transform DHL CSV rows');
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error, csvPath }, 'Failed to parse DHL CSV');
        reject(error);
      });
  });
}

/**
 * Transform raw DHL CSV rows into OCRLineItem objects
 * Filters for "S" (Shipment) rows only, skipping "I" (Invoice) rows
 */
function transformDHLRows(rows: string[][]): OCRLineItem[] {
  const lineItems: OCRLineItem[] = [];

  rows.forEach((row, index) => {
    const lineType = row[DHL_COLS.LINE_TYPE]?.trim();

    // Skip "I" (Invoice summary) rows - we only want "S" (Shipment) rows
    if (lineType !== 'S') {
      logger.debug({ lineType, rowIndex: index + 2 }, 'Skipping non-shipment row');
      return;
    }

    const lineItem = buildDHLLineItem(row);
    if (lineItem) {
      lineItems.push(lineItem);
    }
  });

  return lineItems;
}

/**
 * Build a single OCRLineItem from a DHL CSV row
 */
function buildDHLLineItem(row: string[]): OCRLineItem | null {
  // Validate minimum required fields
  const shipmentNumber = row[DHL_COLS.SHIPMENT_NUMBER]?.trim();
  if (!shipmentNumber) {
    logger.warn('Skipping DHL row with missing shipment number');
    return null;
  }

  // Format dates from YYYYMMDD to YYYY-MM-DD
  const shipmentDate = formatDHLDate(row[DHL_COLS.SHIPMENT_DATE]);
  const invoiceDate = formatDHLDate(row[DHL_COLS.INVOICE_DATE]);

  const lineItem: OCRLineItem = {
    // Vendor identification
    vendor: 'DHL',
    line_item_type: 'shipment',

    // Invoice info
    invoice_number: row[DHL_COLS.INVOICE_NUMBER]?.trim() || '',
    invoice_date: invoiceDate,
    currency: row[DHL_COLS.CURRENCY]?.trim() || 'EUR',

    // Shipment info
    shipment_number: shipmentNumber,
    // Use shipment_date as booking_date (DHL doesn't provide separate booking date) - aligned with DB
    booking_date: shipmentDate,
    shipment_date: shipmentDate,
    shipment_reference_1: row[DHL_COLS.SHIPMENT_REF_1]?.trim() || '',
    shipment_reference_2: row[DHL_COLS.SHIPMENT_REF_2]?.trim() || '',

    // Product
    product_name: row[DHL_COLS.PRODUCT_NAME]?.trim() || 'DHL Express',
    description: row[DHL_COLS.PRODUCT_NAME]?.trim() || 'DHL Express',
    pieces: parseInt(row[DHL_COLS.PIECES], 10) || 1,

    // Weight
    weight_kg: parseEuropeanNumber(row[DHL_COLS.WEIGHT_KG]),
    weight_flag: row[DHL_COLS.WEIGHT_FLAG]?.trim() || 'A',

    // Origin - aligned with DB column names
    origin_country: row[DHL_COLS.ORIGIN_COUNTRY_NAME]?.trim() || '',
    origin_city: row[DHL_COLS.ORIGIN_NAME]?.trim() || '',
    origin_postal_code: row[DHL_COLS.SENDERS_POSTCODE]?.trim() || '',

    // Destination - aligned with DB column names
    destination_country: row[DHL_COLS.DESTINATION_COUNTRY_NAME]?.trim() || '',
    destination_city: row[DHL_COLS.DESTINATION_NAME]?.trim() || '',
    destination_postal_code: row[DHL_COLS.RECEIVERS_POSTCODE]?.trim() || '',

    // Pricing (European number format)
    net_amount: parseEuropeanNumber(row[DHL_COLS.NET_AMOUNT]),
    gross_amount: parseEuropeanNumber(row[DHL_COLS.GROSS_AMOUNT]),
    base_price: parseEuropeanNumber(row[DHL_COLS.WEIGHT_CHARGE]),
    total_tax: parseEuropeanNumber(row[DHL_COLS.TOTAL_TAX]),

    // Surcharges totals - aligned with DB
    total_surcharges: parseEuropeanNumber(row[DHL_COLS.TOTAL_EXTRA_CHARGES]),
    total_surcharges_tax: parseEuropeanNumber(row[DHL_COLS.TOTAL_EXTRA_CHARGES_TAX]),
  };

  // Extract XC1-XC9 extra charges
  const xcMappings = [
    { ...DHL_COLS.XC1, prefix: 'xc1' },
    { ...DHL_COLS.XC2, prefix: 'xc2' },
    { ...DHL_COLS.XC3, prefix: 'xc3' },
    { ...DHL_COLS.XC4, prefix: 'xc4' },
    { ...DHL_COLS.XC5, prefix: 'xc5' },
    { ...DHL_COLS.XC6, prefix: 'xc6' },
    { ...DHL_COLS.XC7, prefix: 'xc7' },
    { ...DHL_COLS.XC8, prefix: 'xc8' },
    { ...DHL_COLS.XC9, prefix: 'xc9' },
  ];

  xcMappings.forEach((xc) => {
    const xcCode = row[xc.CODE]?.trim();
    const xcName = row[xc.NAME]?.trim();
    const xcCharge = parseEuropeanNumber(row[xc.CHARGE]);

    // Only add if there's a valid charge (code + name + non-zero amount)
    if (xcCode && xcCode !== '0' && xcName && xcName !== '0' && xcCharge !== 0) {
      const xcNameKey = `${xc.prefix}_name` as keyof OCRLineItem;
      const xcChargeKey = `${xc.prefix}_charge` as keyof OCRLineItem;
      // Use just the name (e.g., "FUEL SURCHARGE") without code prefix
      (lineItem as Record<string, unknown>)[xcNameKey] = xcName;
      (lineItem as Record<string, unknown>)[xcChargeKey] = xcCharge;
    }
  });

  return lineItem;
}

/**
 * Parse Eurosender address string to extract country code and full country name
 * Address format: "Street Address (-), City, Postcode, COUNTRY_CODE"
 * Example: "Helenestrasse 17 (-), Ludwigsfelde, 14974, DE"
 */
function parseEurosenderAddress(address: string): {
  country_code: string;
  country_name: string;
  postcode: string;
} {
  const parts = address.split(',').map((p) => p.trim());

  if (parts.length < 2) {
    return { country_code: '', country_name: '', postcode: '' };
  }

  // Last part is country code (2 letters)
  const country_code = parts[parts.length - 1] || '';

  // Second to last is postcode
  const postcode = parts[parts.length - 2] || '';

  // Map country codes to full names
  const countryMap: Record<string, string> = {
    'DE': 'Germany',
    'DK': 'Denmark',
    'ES': 'Spain',
    'FR': 'France',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'IT': 'Italy',
    'AT': 'Austria',
    'PL': 'Poland',
    'CZ': 'Czech Republic',
    'SE': 'Sweden',
    'NO': 'Norway',
    'FI': 'Finland',
    'PT': 'Portugal',
    'CH': 'Switzerland',
    'GB': 'United Kingdom',
    'UK': 'United Kingdom',
    'IE': 'Ireland',
    'LU': 'Luxembourg',
    'GR': 'Greece',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'SI': 'Slovenia',
    'SK': 'Slovakia',
    'LT': 'Lithuania',
    'LV': 'Latvia',
    'EE': 'Estonia',
  };

  const country_name = countryMap[country_code] || country_code;

  return { country_code, country_name, postcode };
}

/**
 * Eurosender CSV has 12 columns with the following fields:
 * - col 0: invoice_number (e.g., "INV-26-033571")
 * - col 1: order_code (shipment reference, e.g., "636091-26")
 * - col 2: tracking_number (e.g., "888588996595")
 * - col 3: booking_created_date (e.g., "2026-02-02")
 * - col 4: manifest_date (e.g., "2026-02-09")
 * - col 5: pickup_date (actual pickup, e.g., "2026-02-27")
 * - col 6: service_type (e.g., "Priority pallet")
 * - col 7: weight_kg (e.g., "97.0")
 * - col 8: origin_country (e.g., "Belgium")
 * - col 9: destination_country (e.g., "France")
 * - col 10: pickup_address (full address string)
 * - col 11: delivery_address (full address string)
 * - col 12: packages_net_total (shipment price, e.g., "66.73")
 * - col 13: refund_net_total (e.g., "0.0")
 */
export async function parseEurosenderCSV(csvPath: string): Promise<OCRLineItem[]> {
  logger.info({ csvPath }, 'Parsing Eurosender CSV file');

  const records: string[][] = [];

  return new Promise((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(
        parse({
          delimiter: ',',
          skip_empty_lines: true,
          from_line: 2,              // Skip header row (line 1)
        })
      )
      .on('data', (row: string[]) => {
        records.push(row);
      })
      .on('end', () => {
        try {
          const lineItems = transformEurosenderRows(records);
          logger.info(
            { lineItemCount: lineItems.length },
            'Eurosender CSV parsed successfully'
          );
          resolve(lineItems);
        } catch (error) {
          logger.error({ error }, 'Failed to transform Eurosender CSV rows');
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error, csvPath }, 'Failed to parse Eurosender CSV');
        reject(error);
      });
  });
}

/**
 * Transform raw Eurosender CSV rows into OCRLineItem objects
 */
function transformEurosenderRows(rows: string[][]): OCRLineItem[] {
  const lineItems: OCRLineItem[] = [];

  rows.forEach((row, index) => {
    const lineItem = buildEurosenderLineItem(row);
    if (lineItem) {
      lineItems.push(lineItem);
    } else {
      logger.warn({ rowIndex: index + 2 }, 'Skipped invalid Eurosender row');
    }
  });

  return lineItems;
}

/**
 * Build a single OCRLineItem from an Eurosender CSV row
 * Columns: Document name, Order code, Order date, Pickup date, Tracking number,
 *          Service type, Weight (kg), Pickup address, Delivery address,
 *          Total NET amount, Packages NET total, Refund NET total
 */
function buildEurosenderLineItem(row: string[]): OCRLineItem | null {
  // Get tracking number and order code
  const trackingNumber = row[EUROSENDER_COLS.TRACKING_NUMBER]?.trim() || '';
  const orderCode = row[EUROSENDER_COLS.ORDER_CODE]?.trim() || '';

  // Validate minimum required fields - need at least order code to identify the row
  if (!orderCode) {
    logger.warn('Skipping Eurosender row with missing order code');
    return null;
  }

  // Parse addresses to extract postcode and country
  // Address format: "Street (-), City, Postcode, COUNTRY_CODE"
  const origin = parseEurosenderAddress(row[EUROSENDER_COLS.PICKUP_ADDRESS] || '');
  const destination = parseEurosenderAddress(row[EUROSENDER_COLS.DELIVERY_ADDRESS] || '');

  // Parse amounts
  const packageNetPrice = parseFloat(row[EUROSENDER_COLS.PACKAGES_NET_TOTAL]) || 0;
  const refundNetTotal = parseFloat(row[EUROSENDER_COLS.REFUND_NET_TOTAL]) || 0;

  const lineItem: OCRLineItem = {
    // Vendor identification
    vendor: 'Eurosender',
    line_item_type: 'shipment',

    // Invoice info
    invoice_number: row[EUROSENDER_COLS.INVOICE_NUMBER]?.trim() || '',
    currency: 'EUR',

    // Shipment info
    shipment_number: trackingNumber || '', // Keep blank if no tracking number
    booking_date: row[EUROSENDER_COLS.BOOKING_CREATED_DATE]?.trim() || '',
    shipment_date: row[EUROSENDER_COLS.PICKUP_DATE]?.trim() || '',
    shipment_reference_1: orderCode,

    // Product
    product_name: row[EUROSENDER_COLS.SERVICE_TYPE]?.trim() || 'Eurosender',
    description: row[EUROSENDER_COLS.SERVICE_TYPE]?.trim() || 'Eurosender',
    pieces: 1, // Eurosender CSV doesn't specify pieces

    // Weight
    weight_kg: parseFloat(row[EUROSENDER_COLS.WEIGHT_KG]) || 0,
    weight_flag: 'kg',

    // Origin - aligned with DB column names
    origin_country: origin.country_name,
    origin_city: row[EUROSENDER_COLS.PICKUP_ADDRESS]?.trim() || '',
    origin_postal_code: origin.postcode,

    // Destination - aligned with DB column names
    destination_country: destination.country_name,
    destination_city: row[EUROSENDER_COLS.DELIVERY_ADDRESS]?.trim() || '',
    destination_postal_code: destination.postcode,

    // Pricing
    net_amount: packageNetPrice,
    gross_amount: packageNetPrice, // No tax breakdown in Eurosender CSV
    base_price: packageNetPrice,
    total_tax: 0,
    total_surcharges: 0,
    total_surcharges_tax: 0,
  };

  // Handle refunds as negative extra charge
  if (refundNetTotal !== 0) {
    lineItem.xc1_name = 'Refund';
    lineItem.xc1_charge = -refundNetTotal; // Negative for refunds
    lineItem.total_surcharges = -refundNetTotal;
    lineItem.gross_amount = packageNetPrice - refundNetTotal;
    lineItem.net_amount = lineItem.gross_amount;
  }

  return lineItem;
}

/**
 * Parse GLS CSV
 * Format: Semicolon-delimited with multiple rows per parcel (base charge + surcharges)
 * Columns: Gepard Customer ID, Document No., Document Date, Parcel Number, Date,
 *          Inv.- Weight kg, Net amount, Article Number, Description, Reference(s) per parcel,
 *          Delivery Country, Consignee Zipcode, Consignee City, Consignee Street 1, etc.
 */
export async function parseGLSCSV(csvPath: string): Promise<OCRLineItem[]> {
  logger.info({ csvPath }, 'Parsing GLS CSV file');

  return new Promise((resolve, reject) => {
    const rawRows: GLSCSVRow[] = [];

    createReadStream(csvPath)
      .pipe(
        parse({
          delimiter: ';',
          columns: true,
          skip_empty_lines: true,
          trim: true,
          quote: '"',
          relax_column_count: true,
          relax_quotes: true,
          skip_records_with_error: true,
          on_record: (record, context) => {
            // Log any parsing issues
            if (context.error) {
              logger.warn(
                { line: context.lines, error: context.error },
                'Skipped problematic GLS CSV record'
              );
            }
            return record;
          },
        })
      )
      .on('data', (row: GLSCSVRow) => {
        rawRows.push(row);
      })
      .on('end', () => {
        try {
          const lineItems = buildGLSLineItems(rawRows);
          logger.info(
            { lineItemCount: lineItems.length },
            'GLS CSV parsed successfully'
          );
          resolve(lineItems);
        } catch (error) {
          logger.error({ error }, 'Failed to transform GLS CSV rows');
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error, csvPath }, 'Failed to parse GLS CSV');
        reject(error);
      });
  });
}

/**
 * Format GLS date from DD.MM.YYYY to YYYY-MM-DD
 * Examples:
 *   "18.02.2026" → "2026-02-18"
 *   "" or invalid → ""
 */
function formatGLSDate(dateStr: string | undefined): string {
  if (!dateStr || dateStr.trim() === '' || dateStr.trim() === '-') return '';

  const trimmed = dateStr.trim();
  const parts = trimmed.split('.');

  if (parts.length !== 3) return '';

  const [day, month, year] = parts;

  // Validate
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) {
    return '';
  }

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Parse European number format for GLS (comma as decimal separator)
 */
function parseGLSNumber(value: string | undefined): number {
  if (!value || value.trim() === '') return 0;
  return parseFloat(value.replace(',', '.')) || 0;
}

/**
 * Determine if a GLS charge is a Base Charge or Surcharge
 * Based on Article Number and Description patterns
 */
function getGLSRecordType(articleNumber: string | undefined, description: string | undefined): string {
  const article = articleNumber?.trim() || '';
  const desc = description?.trim() || '';

  // Base charges: BusinessParcel (30000), EuroBusinessParcel (31003, 31007)
  if (article === '30000' || article === '31003' || article === '31007') {
    return 'Base Charge';
  }

  // Also check description for base charge keywords
  if (desc.includes('BusinessParcel') || desc.includes('EuroBusinessParcel')) {
    return 'Base Charge';
  }

  // Everything else is a surcharge
  return 'Surcharge';
}

/**
 * Build GLS line items by grouping rows by Parcel Number (tracking number)
 * Like UPS/Sendcloud - base charge + surcharges combined into one line item
 * Invoice-level surcharges (Parcel Number = "-") are kept as separate line items
 */
function buildGLSLineItems(rows: GLSCSVRow[]): OCRLineItem[] {
  // Separate invoice-level surcharges from shipment rows
  const invoiceLevelRows: GLSCSVRow[] = [];
  const shipmentGroups = new Map<string, GLSCSVRow[]>();

  for (const row of rows) {
    const parcelNumber = row['Parcel Number']?.trim();

    // Invoice-level surcharges (no parcel number)
    if (!parcelNumber || parcelNumber === '-') {
      invoiceLevelRows.push(row);
      continue;
    }

    // Group shipment rows by parcel number
    if (!shipmentGroups.has(parcelNumber)) {
      shipmentGroups.set(parcelNumber, []);
    }
    shipmentGroups.get(parcelNumber)!.push(row);
  }

  const lineItems: OCRLineItem[] = [];

  // Add invoice-level surcharges as separate line items
  for (const row of invoiceLevelRows) {
    try {
      const lineItem = buildGLSInvoiceSurchargeItem(row);
      if (lineItem) {
        lineItems.push(lineItem);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to build GLS invoice-level surcharge');
    }
  }

  // Process each shipment group (base + surcharges combined)
  for (const [parcelNumber, parcelRows] of shipmentGroups) {
    try {
      const lineItem = buildGLSGroupedLineItem(parcelNumber, parcelRows);
      if (lineItem) {
        lineItems.push(lineItem);
      }
    } catch (error) {
      logger.error({ error, parcelNumber }, 'Failed to build GLS line item');
    }
  }

  return lineItems;
}

/**
 * Build a GLS invoice-level surcharge as a separate line item
 * These are charges like "Energy", "Service flat rate" that apply to the whole invoice
 */
function buildGLSInvoiceSurchargeItem(row: GLSCSVRow): OCRLineItem | null {
  const description = row['Description']?.trim() || '';
  const netAmount = parseGLSNumber(row['Net amount']);

  if (!description && netAmount === 0) {
    return null;
  }

  return {
    // Vendor identification
    vendor: 'GLS',
    line_item_type: 'fee',

    invoice_number: row['Document No.']?.trim() || '',
    invoice_date: formatGLSDate(row['Document Date']),
    currency: 'EUR',
    shipment_number: '-',
    shipment_date: formatGLSDate(row['Date']),
    booking_date: '',
    product_name: description,
    description: description,
    weight_kg: 0,
    weight_flag: 'kg',
    destination_country: '',
    destination_city: '-',
    destination_postal_code: '',
    net_amount: roundAmount(netAmount),
    gross_amount: roundAmount(netAmount),
    base_price: 0,
    total_surcharges: roundAmount(netAmount),
  };
}

/**
 * Build a single GLS line item from grouped rows for one parcel
 * Base charge (BusinessParcel) + surcharges combined with xc1-xc9
 */
function buildGLSGroupedLineItem(
  parcelNumber: string,
  rows: GLSCSVRow[]
): OCRLineItem | null {
  if (rows.length === 0) return null;

  // Separate base charges from surcharges
  const baseRows: GLSCSVRow[] = [];
  const surchargeRows: GLSCSVRow[] = [];

  for (const row of rows) {
    const recordType = getGLSRecordType(row['Article Number'], row['Description']);
    if (recordType === 'Base Charge') {
      baseRows.push(row);
    } else {
      surchargeRows.push(row);
    }
  }

  // Use first base row for metadata, fallback to first row
  const metaRow = baseRows[0] || rows[0];

  // Sum base charges (some parcels have multiple base charge rows)
  let baseAmount = 0;
  let weight = 0;
  const baseDescriptions: string[] = [];

  for (const row of baseRows) {
    baseAmount += parseGLSNumber(row['Net amount']);
    const w = parseGLSNumber(row['Inv.- Weight kg']);
    if (w > 0) weight = w;
    const desc = row['Description']?.trim();
    if (desc && !baseDescriptions.includes(desc)) {
      baseDescriptions.push(desc);
    }
  }

  // Convert country code to full name
  const countryCode = metaRow['Delivery Country']?.trim() || '';
  const countryName = getCountryName(countryCode);

  const lineItem: OCRLineItem = {
    // Vendor identification
    vendor: 'GLS',
    line_item_type: 'shipment',

    // Invoice info
    invoice_number: metaRow['Document No.']?.trim() || '',
    invoice_date: formatGLSDate(metaRow['Document Date']),
    currency: 'EUR',

    // Shipment info
    shipment_number: parcelNumber,
    shipment_reference_1: metaRow['Reference(s) per parcel']?.trim() || '',
    shipment_date: formatGLSDate(metaRow['Date']),
    booking_date: '',

    // Product/Service
    product_name: baseDescriptions.join(', ') || 'GLS',
    description: baseDescriptions.join(', ') || 'GLS',

    // Weight
    weight_kg: weight,
    weight_flag: 'kg',

    // Destination - aligned with DB column names
    destination_country: countryName,
    destination_city: metaRow['Consignee City']?.trim() || '',
    destination_postal_code: metaRow['Consignee Zipcode']?.trim() || '',

    // Pricing - base charge
    base_price: roundAmount(baseAmount),
    net_amount: roundAmount(baseAmount),
    gross_amount: roundAmount(baseAmount),
    total_surcharges: 0,
  };

  // Add surcharges as xc1, xc2, etc. (like UPS/Sendcloud)
  let extraChargeIndex = 1;
  let totalSurcharges = 0;

  for (const surchargeRow of surchargeRows) {
    if (extraChargeIndex > 9) break; // Max 9 extra charges

    const surchargeName = surchargeRow['Description']?.trim() || '';
    const surchargeAmount = parseGLSNumber(surchargeRow['Net amount']);

    if (surchargeName) {
      setExtraCharge(lineItem, extraChargeIndex, surchargeName, surchargeAmount);
      totalSurcharges += surchargeAmount;
      extraChargeIndex++;
    }
  }

  // Update totals to include surcharges
  lineItem.total_surcharges = roundAmount(totalSurcharges);
  lineItem.net_amount = roundAmount(baseAmount + totalSurcharges);
  lineItem.gross_amount = roundAmount(baseAmount + totalSurcharges);

  return lineItem;
}

/**
 * Parse Hive CSV
 * Format: Shipment Reference, Shop Order ID, Shipment Date, Order Type, etc.
 */
export async function parseHiveCSV(csvPath: string): Promise<OCRLineItem[]> {
  logger.info({ csvPath }, 'Parsing Hive CSV file');

  return new Promise((resolve, reject) => {
    const lineItems: OCRLineItem[] = [];

    createReadStream(csvPath)
      .pipe(
        parse({
          delimiter: ',',
          columns: true, // Use first row as headers
          skip_empty_lines: true,
          trim: true,
        })
      )
      .on('data', (row: HiveCSVRow) => {
        try {
          const lineItem = buildHiveLineItem(row);
          if (lineItem) {
            lineItems.push(lineItem);
          }
        } catch (error) {
          logger.error({ error, row }, 'Failed to transform Hive CSV row');
        }
      })
      .on('end', () => {
        logger.info(
          { lineItemCount: lineItems.length },
          'Hive CSV parsed successfully'
        );
        resolve(lineItems);
      })
      .on('error', (error) => {
        logger.error({ error, csvPath }, 'Failed to parse Hive CSV');
        reject(error);
      });
  });
}

/**
 * Build a single OCRLineItem from a Hive CSV row
 */
function buildHiveLineItem(row: HiveCSVRow): OCRLineItem | null {
  const shipmentRef = row['Shipment Reference']?.trim();

  if (!shipmentRef) {
    logger.warn('Skipping Hive row with missing Shipment Reference');
    return null;
  }

  // Helper to get column value with flexible encoding handling
  const getColumnValue = (columnName: string): string => {
    // Try the column name as-is first
    if (row[columnName] !== undefined) {
      return row[columnName];
    }

    // Try to find the column with encoding variations
    // The CSV might have encoding issues with Euro symbol (€ vs â‚¬)
    const keys = Object.keys(row);
    const matchingKey = keys.find(key => {
      // Remove special chars for comparison
      const normalizedKey = key.replace(/[€â‚¬]/g, '').trim();
      const normalizedColumnName = columnName.replace(/[€]/g, '').trim();
      return normalizedKey === normalizedColumnName;
    });

    return matchingKey ? (row[matchingKey] ?? '') : '';
  };

  const deliveryPrice = getColumnValue('Delivery Price (€)');
  const fulfillmentPrice = getColumnValue('B2C Fulfillment Price (€)');

  const deliveryCharge = roundAmount(parseFloat(deliveryPrice?.replace(',', '.') || '0'));
  const handlingCharge = roundAmount(parseFloat(fulfillmentPrice?.replace(',', '.') || '0'));

  return {
    // Vendor identification
    vendor: 'Hive',
    line_item_type: 'shipment',

    shipment_number: shipmentRef,
    shipment_reference_1: row['Shop Order ID']?.trim() || '',
    shipment_date: row['Shipment Date']?.trim() || '', // Transaction date for sorting
    booking_date: row['Shipment Date']?.trim() || '',
    destination_country: row['Destination Country']?.trim() || '',
    product_name: row['Carrier']?.trim() || '',
    description: row['Carrier']?.trim() || '',
    weight_kg: parseFloat(row['Weight (kg)'] || '0'),
    base_price: deliveryCharge,
    xc1_name: 'Fulfillment',
    xc1_charge: handlingCharge,
    net_amount: roundAmount(deliveryCharge + handlingCharge),
    gross_amount: roundAmount(deliveryCharge + handlingCharge),
    total_surcharges: handlingCharge,
  };
}

/**
 * Parse Sendcloud CSV
 * Format: Comma-delimited with multiple rows per shipment (base + surcharges)
 * Columns: Description, Date, Reference, Amount, Type, Order number, Integration,
 *          From Address fields, To Address fields
 * Groups rows by Reference (tracking number) like UPS
 */
export async function parseSendcloudCSV(csvPath: string): Promise<OCRLineItem[]> {
  logger.info({ csvPath }, 'Parsing Sendcloud CSV file');

  return new Promise((resolve, reject) => {
    const rawRows: SendcloudCSVRow[] = [];

    createReadStream(csvPath)
      .pipe(
        parse({
          delimiter: ',',
          columns: true, // Use first row as headers
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        })
      )
      .on('data', (row: SendcloudCSVRow) => {
        rawRows.push(row);
      })
      .on('end', () => {
        try {
          const lineItems = buildSendcloudLineItems(rawRows);
          logger.info(
            { lineItemCount: lineItems.length },
            'Sendcloud CSV parsed successfully'
          );
          resolve(lineItems);
        } catch (error) {
          logger.error({ error }, 'Failed to transform Sendcloud CSV rows');
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error, csvPath }, 'Failed to parse Sendcloud CSV');
        reject(error);
      });
  });
}

/**
 * Extract weight from Sendcloud description
 * Examples: "UPS Standard 7-8kg 7-8kg" → 7.5, "DPD Classic 3-4kg" → 3.5
 */
function extractSendcloudWeight(description: string | undefined): number {
  if (!description) return 0;

  // Match patterns like "7-8kg" or "3-4kg"
  const match = description.match(/(\d+)-(\d+)\s*kg/i);
  if (match) {
    const low = parseFloat(match[1]);
    const high = parseFloat(match[2]);
    return (low + high) / 2; // Return average
  }

  // Match single weight like "5kg"
  const singleMatch = description.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (singleMatch) {
    return parseFloat(singleMatch[1]);
  }

  return 0;
}

/**
 * Build Sendcloud line items by grouping rows by Reference (tracking number)
 * Similar to UPS - base charge + surcharges combined into one line item
 */
function buildSendcloudLineItems(rows: SendcloudCSVRow[]): OCRLineItem[] {
  // Group rows by Reference (tracking number)
  const shipmentGroups = new Map<string, SendcloudCSVRow[]>();

  for (const row of rows) {
    const reference = row['Reference']?.trim();
    if (!reference) continue;

    if (!shipmentGroups.has(reference)) {
      shipmentGroups.set(reference, []);
    }
    shipmentGroups.get(reference)!.push(row);
  }

  const lineItems: OCRLineItem[] = [];

  // Process each shipment group
  for (const [reference, shipmentRows] of shipmentGroups) {
    try {
      const lineItem = buildSendcloudLineItem(reference, shipmentRows);
      if (lineItem) {
        lineItems.push(lineItem);
      }
    } catch (error) {
      logger.error({ error, reference }, 'Failed to build Sendcloud line item');
    }
  }

  return lineItems;
}

/**
 * Build a single Sendcloud line item from grouped rows for one shipment
 * Base charge (Type="Shipments") + surcharges (Type="Surcharge") combined
 */
function buildSendcloudLineItem(
  reference: string,
  rows: SendcloudCSVRow[]
): OCRLineItem | null {
  if (rows.length === 0) return null;

  // Find base charge row (Type = "Shipments")
  const baseRow = rows.find((r) => r['Type']?.trim() === 'Shipments');
  const surchargeRows = rows.filter((r) => r['Type']?.trim() === 'Surcharge');

  // Use base row for metadata, fallback to first row
  const metaRow = baseRow || rows[0];

  // Parse base charge amount
  const baseAmount = baseRow ? parseFloat(baseRow['Amount'] || '0') : 0;

  // Extract weight from description
  const weight = extractSendcloudWeight(metaRow['Description']);

  // Build origin address
  const originAddress = [
    metaRow['From Address 1'],
    metaRow['From House Number'],
    metaRow['From City'],
  ]
    .filter(Boolean)
    .join(', ');

  // Build destination address
  const destAddress = [
    metaRow['To Address 1'],
    metaRow['To House Number'],
    metaRow['To City'],
  ]
    .filter(Boolean)
    .join(', ');

  const lineItem: OCRLineItem = {
    // Vendor identification
    vendor: 'Sendcloud',
    line_item_type: 'shipment',

    // Shipment info
    shipment_number: reference,
    shipment_reference_1: metaRow['Order number']?.trim() || '',
    shipment_date: metaRow['Date']?.trim() || '',
    booking_date: metaRow['Date']?.trim() || '',

    // Product/Service
    product_name: metaRow['Description']?.trim() || 'Sendcloud',
    description: metaRow['Description']?.trim() || 'Sendcloud',
    currency: 'EUR',

    // Weight
    weight_kg: weight,
    weight_flag: 'kg',

    // Origin - aligned with DB column names
    origin_country: getCountryName(metaRow['From Country']),
    origin_city: originAddress,
    origin_postal_code: metaRow['From Postal Code']?.trim() || '',

    // Destination - aligned with DB column names
    destination_country: getCountryName(metaRow['To Country']),
    destination_city: destAddress,
    destination_postal_code: metaRow['To Postal Code']?.trim() || '',

    // Pricing - base charge
    base_price: roundAmount(baseAmount),
    net_amount: roundAmount(baseAmount),
    gross_amount: roundAmount(baseAmount),
    total_surcharges: 0,
  };

  // Add surcharges as xc1, xc2, etc. (like UPS)
  let extraChargeIndex = 1;
  let totalSurcharges = 0;

  for (const surchargeRow of surchargeRows) {
    if (extraChargeIndex > 9) break; // Max 9 extra charges

    const surchargeName = surchargeRow['Description']?.trim() || '';
    const surchargeAmount = parseFloat(surchargeRow['Amount'] || '0');

    if (surchargeName && surchargeAmount !== 0) {
      setExtraCharge(lineItem, extraChargeIndex, surchargeName, surchargeAmount);
      totalSurcharges += surchargeAmount;
      extraChargeIndex++;
    }
  }

  // Update totals to include surcharges
  lineItem.total_surcharges = roundAmount(totalSurcharges);
  lineItem.net_amount = roundAmount(baseAmount + totalSurcharges);
  lineItem.gross_amount = roundAmount(baseAmount + totalSurcharges);

  return lineItem;
}

// S2C CSV column indices (0-based)
const S2C_COLS = {
  INVOICE_MONTH: 0,      // "Invoice Month" e.g., "February 2026"
  INVOICE_DATE: 1,       // "Invoice date" e.g., "2026-02-28"
  INVOICE_NUMBER: 2,     // "Invoice Number" e.g., "2026/000078/VE"
  REFERENCE_NUMBER: 3,   // "Reference number" - buycycle booking ID
  REQUIRED_PICKUP: 4,    // "Required pickup" - pickup date
  FROM_TO: 5,            // "From - To" e.g., "IT-ES"
  FROM: 6,               // "From" - origin country code
  TO: 7,                 // "To" - destination country code
  TRACKING_1: 8,         // "Tracking 1" - primary tracking number
  TRACKING_2: 9,         // "Tracking 2" - secondary tracking (if split shipment)
  BASE_PRICE: 10,        // "Base Price" e.g., "81.00 €"
  SURCHARGE_COST: 11,    // "Surcharge cost"
  SURCHARGE_REASON: 12,  // "Surcharge reason (invoiced)"
  TOTAL_COST: 13,        // "Total cost"
  UPS_DIMENSIONS: 14,    // "UPS dimensions"
  OVERALL_DIMENSIONS: 15,// "Overall dimensions"
  ADDITIONAL_COMMENTS: 16,// "Additional comments"
};

/**
 * Parse S2C (Ship to Cycle / Sport & Events Logistics) CSV file
 * CSV format: Invoice Month, Invoice date, Invoice Number, Reference number,
 *             Required pickup, From - To, From, To, Tracking 1, Tracking 2,
 *             Base Price, Surcharge cost, Surcharge reason, Total cost,
 *             UPS dimensions, Overall dimensions, Additional comments
 */
export async function parseS2CCSV(csvPath: string): Promise<OCRLineItem[]> {
  logger.info({ csvPath }, 'Parsing S2C CSV file');

  const records: string[][] = [];

  return new Promise((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(
        parse({
          delimiter: ',',
          skip_empty_lines: true,
          from_line: 2, // Skip header row
        })
      )
      .on('data', (row: string[]) => {
        records.push(row);
      })
      .on('end', () => {
        try {
          const lineItems = transformS2CRows(records);
          logger.info(
            { lineItemCount: lineItems.length },
            'S2C CSV parsed successfully'
          );
          resolve(lineItems);
        } catch (error) {
          logger.error({ error }, 'Failed to transform S2C CSV rows');
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error, csvPath }, 'Failed to parse S2C CSV');
        reject(error);
      });
  });
}

/**
 * Transform raw S2C CSV rows into OCRLineItem objects
 */
function transformS2CRows(rows: string[][]): OCRLineItem[] {
  const lineItems: OCRLineItem[] = [];

  rows.forEach((row, index) => {
    const lineItem = buildS2CLineItem(row);
    if (lineItem) {
      lineItems.push(lineItem);
    } else {
      logger.warn({ rowIndex: index + 2 }, 'Skipped invalid S2C row');
    }
  });

  return lineItems;
}

/**
 * Parse S2C Euro amount format: "81.00 €" or "81,00 €" or just "81.00"
 */
function parseS2CEuroAmount(amountStr: string | undefined): number {
  if (!amountStr) return 0;
  // Remove Euro symbol, spaces, and handle comma as decimal separator
  const cleaned = amountStr
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  return parseFloat(cleaned) || 0;
}

/**
 * Parse S2C date format: "12/1/2026" (M/D/YYYY) or "2026-02-28" (ISO)
 */
function parseS2CDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();

  // If already ISO format (YYYY-MM-DD), return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed;
  }

  // Parse M/D/YYYY format
  const parts = trimmed.split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return trimmed;
}

/**
 * Build a single OCRLineItem from an S2C CSV row
 */
function buildS2CLineItem(row: string[]): OCRLineItem | null {
  // Validate minimum required fields
  const referenceNumber = row[S2C_COLS.REFERENCE_NUMBER]?.trim() || '';
  const trackingNumber = row[S2C_COLS.TRACKING_1]?.trim() || '';

  // Skip rows without reference or tracking
  if (!referenceNumber && !trackingNumber) {
    return null;
  }

  // Parse amounts
  const basePrice = parseS2CEuroAmount(row[S2C_COLS.BASE_PRICE]);
  const surchargeAmount = parseS2CEuroAmount(row[S2C_COLS.SURCHARGE_COST]);
  const totalCost = parseS2CEuroAmount(row[S2C_COLS.TOTAL_COST]);

  // Use total cost if available, otherwise calculate
  const netAmount = totalCost > 0 ? totalCost : basePrice + surchargeAmount;

  // Parse dates
  const shipmentDate = parseS2CDate(row[S2C_COLS.REQUIRED_PICKUP]);
  const invoiceDate = parseS2CDate(row[S2C_COLS.INVOICE_DATE]);

  // Build line item
  const lineItem: OCRLineItem = {
    vendor: 'S2C',
    line_item_type: 'shipment',

    // Invoice info
    invoice_number: row[S2C_COLS.INVOICE_NUMBER]?.trim() || '',

    // Shipment info
    shipment_number: trackingNumber,
    shipment_reference_1: referenceNumber,
    shipment_reference_2: row[S2C_COLS.TRACKING_2]?.trim() || '',
    shipment_date: shipmentDate || invoiceDate,
    booking_date: invoiceDate,

    // Product/Service
    product_name: 'S2C Shipping',
    description: row[S2C_COLS.ADDITIONAL_COMMENTS]?.trim() || 'S2C Shipment',
    currency: 'EUR',

    // Origin - country code (e.g., "IT")
    origin_country: getCountryName(row[S2C_COLS.FROM]),
    origin_city: '',
    origin_postal_code: '',

    // Destination - may include special suffixes like "NL-TVAL"
    destination_country: getCountryName(row[S2C_COLS.TO]?.split('-')[0]), // Handle "NL-TVAL" -> "NL"
    destination_city: '',
    destination_postal_code: '',

    // Pricing
    base_price: roundAmount(basePrice),
    net_amount: roundAmount(netAmount),
    gross_amount: roundAmount(netAmount),
    total_surcharges: roundAmount(surchargeAmount),
  };

  // Add surcharge as xc1 if present
  if (surchargeAmount > 0) {
    const surchargeReason = row[S2C_COLS.SURCHARGE_REASON]?.trim() || 'Surcharge';
    setExtraCharge(lineItem, 1, surchargeReason, surchargeAmount);
  }

  // Store dimensions in vendor_raw_data-like fields if available
  const upsDimensions = row[S2C_COLS.UPS_DIMENSIONS]?.trim() || '';
  const overallDimensions = row[S2C_COLS.OVERALL_DIMENSIONS]?.trim() || '';
  if (upsDimensions || overallDimensions) {
    lineItem.description = [
      lineItem.description,
      upsDimensions ? `UPS Dims: ${upsDimensions}` : '',
      overallDimensions ? `Overall Dims: ${overallDimensions}` : '',
    ].filter(Boolean).join(' | ');
  }

  return lineItem;
}

/**
 * Parse logistics CSV based on vendor type
 */
export async function parseLogisticsCSV(
  csvPath: string,
  config: CSVParserConfig
): Promise<OCRLineItem[]> {
  switch (config.vendor) {
    case 'ups':
      return await parseUPSCSV(csvPath);

    case 'dhl':
      return await parseDHLCSV(csvPath);

    case 'eurosender':
      return await parseEurosenderCSV(csvPath);

    case 'gls':
      return await parseGLSCSV(csvPath);

    case 'hive':
      return await parseHiveCSV(csvPath);

    case 'sendcloud':
      return await parseSendcloudCSV(csvPath);

    case 's2c':
      return await parseS2CCSV(csvPath);

    default:
      throw new Error(`Unsupported vendor for CSV parsing: ${config.vendor}`);
  }
}
