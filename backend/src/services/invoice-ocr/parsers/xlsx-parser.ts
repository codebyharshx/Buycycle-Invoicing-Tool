import ExcelJS from 'exceljs';
import { OCRLineItem } from '@shared/types';
import { logger } from '../../../utils/logger';
import { roundAmount } from '../utils';

/**
 * Map 2-letter country codes to full country names
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

function getCountryName(code: string | undefined): string {
  if (!code) return '';
  const upperCode = code.trim().toUpperCase();
  return COUNTRY_CODE_MAP[upperCode] || code;
}

/**
 * Parse Euro amount from various formats: "€318.11", "318.11", "€ 318,11"
 */
function parseEuroAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;

  const str = String(value)
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');

  return parseFloat(str) || 0;
}

/**
 * Parse date from Excel cell (can be Date object or string)
 * Returns empty string for invalid/unparseable dates to avoid database errors
 */
function parseExcelDate(value: unknown): string {
  if (!value) return '';

  try {
    if (value instanceof Date) {
      // Check if date is valid
      if (isNaN(value.getTime())) return '';
      return value.toISOString().split('T')[0];
    }

    const str = String(value).trim();
    if (!str) return '';

    // Handle YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      const dateStr = str.split('T')[0];
      // Validate the date
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) return '';
      return dateStr;
    }

    // Handle DD/MM/YYYY or D/M/YYYY format
    const slashParts = str.split('/');
    if (slashParts.length === 3) {
      const [day, month, year] = slashParts;
      const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) return '';
      return dateStr;
    }

    // Handle DD.MM.YYYY format (common in Europe)
    const dotParts = str.split('.');
    if (dotParts.length === 3) {
      const [day, month, year] = dotParts;
      const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) return '';
      return dateStr;
    }

    // Handle MM/DD/YYYY format (US style)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    }

    // Try generic Date parsing as last resort
    const genericParsed = new Date(str);
    if (!isNaN(genericParsed.getTime())) {
      return genericParsed.toISOString().split('T')[0];
    }

    return '';
  } catch {
    return '';
  }
}

/**
 * Parse "from-to" format like "IT-SE" or "DE-BG"
 */
function parseFromTo(fromTo: string | undefined): { from: string; to: string } {
  if (!fromTo) return { from: '', to: '' };
  const parts = fromTo.split('-');
  return {
    from: parts[0]?.trim() || '',
    to: parts[1]?.trim() || '',
  };
}

/**
 * S2C Overmax XLSX column mapping
 * Columns: reference, source reference, pickup date, from-to, tracking 1,
 *          1st leg charge, absorptions, disputability status/reason,
 *          tracking 2, 2nd leg charge, etc.
 */
interface S2COvermaxRow {
  reference: string;
  sourceReference?: string;
  pickupDate: string;
  fromTo: string;
  tracking1: string;
  firstLegCharge: number;
  firstLegAbsorbed?: number;
  firstLegAbsorptionReason?: string;
  disputabilityStatus?: string;
  disputabilityReason?: string;
  tracking2?: string;
  secondLegCharge?: number;
  secondLegAbsorbed?: number;
  boxType?: string;
  photoUrl?: string;
  photoEvaluation?: string;
}

/**
 * Parse S2C Overmax XLSX file for surcharge line items
 */
export async function parseS2COvermaxXLSX(xlsxPath: string): Promise<OCRLineItem[]> {
  logger.info({ xlsxPath }, 'Parsing S2C Overmax XLSX file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheet found in XLSX file');
  }

  // Get headers from first row
  const headers: string[] = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || '').toLowerCase().trim();
  });

  logger.info({ headers: headers.slice(0, 10) }, 'XLSX headers detected');

  // Find column indices
  const colIndices = {
    reference: headers.findIndex(h => h === 'reference' || h.includes('reference')),
    sourceReference: headers.findIndex(h => h === 'source reference'),
    pickupDate: headers.findIndex(h => h.includes('pickup date')),
    fromTo: headers.findIndex(h => h === 'from-to'),
    tracking1: headers.findIndex(h => h === 'tracking 1'),
    firstLegCharge: headers.findIndex(h => h.includes('1st leg charge')),
    firstLegAbsorbed: headers.findIndex(h => h.includes('1st leg charges absorbed')),
    absorptionReason: headers.findIndex(h => h.includes('absorption reason')),
    disputabilityStatus: headers.findIndex(h => h.includes('disputability status')),
    disputabilityReason: headers.findIndex(h => h.includes('disputability reason')),
    tracking2: headers.findIndex(h => h === 'tracking 2'),
    secondLegCharge: headers.findIndex(h => h.includes('2nd leg charge')),
    secondLegAbsorbed: headers.findIndex(h => h.includes('2nd leg charges absorbed')),
    boxType: headers.findIndex(h => h.includes('box type')),
    photo: headers.findIndex(h => h.includes('photo') && !h.includes('evaluation')),
    photoEvaluation: headers.findIndex(h => h.includes('photo evaluation')),
  };

  const lineItems: OCRLineItem[] = [];

  // Process data rows (skip header)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const reference = String(row.getCell(colIndices.reference + 1).value || '').trim();
    const tracking1 = String(row.getCell(colIndices.tracking1 + 1).value || '').trim();

    // Skip rows without reference or tracking
    if (!reference && !tracking1) return;

    const fromTo = parseFromTo(String(row.getCell(colIndices.fromTo + 1).value || ''));
    const firstLegCharge = parseEuroAmount(row.getCell(colIndices.firstLegCharge + 1).value);
    const firstLegAbsorbed = parseEuroAmount(row.getCell(colIndices.firstLegAbsorbed + 1).value);

    // Skip if charge is fully absorbed (net charge = 0)
    const netCharge = firstLegCharge - firstLegAbsorbed;
    if (netCharge <= 0) return;

    const pickupDate = parseExcelDate(row.getCell(colIndices.pickupDate + 1).value);
    const disputabilityStatus = String(row.getCell(colIndices.disputabilityStatus + 1).value || '').trim();
    const disputabilityReason = String(row.getCell(colIndices.disputabilityReason + 1).value || '').trim();
    const boxType = String(row.getCell(colIndices.boxType + 1).value || '').trim();
    const photoEvaluation = String(row.getCell(colIndices.photoEvaluation + 1).value || '').trim();

    // Build line item
    const lineItem: OCRLineItem = {
      vendor: 'S2C',
      line_item_type: 'surcharge',

      // Shipment info
      shipment_number: tracking1,
      shipment_reference_1: reference,
      shipment_reference_2: String(row.getCell(colIndices.tracking2 + 1).value || '').trim(),
      shipment_date: pickupDate,
      booking_date: pickupDate,

      // Product/Service
      product_name: 'Overmax Surcharge',
      description: `Overmax - ${disputabilityStatus || 'not disputable'}`,
      currency: 'EUR',

      // Origin/Destination
      origin_country: getCountryName(fromTo.from),
      origin_city: '',
      origin_postal_code: '',
      destination_country: getCountryName(fromTo.to),
      destination_city: '',
      destination_postal_code: '',

      // Pricing - net charge after absorptions
      base_price: roundAmount(netCharge),
      net_amount: roundAmount(netCharge),
      gross_amount: roundAmount(netCharge),
      total_surcharges: 0,
    };

    // Store extra metadata in xc fields
    if (disputabilityReason) {
      lineItem.xc1_name = 'Disputability';
      lineItem.xc1_charge = 0;
    }
    if (boxType) {
      lineItem.xc2_name = `Box: ${boxType}`;
      lineItem.xc2_charge = 0;
    }
    if (photoEvaluation) {
      lineItem.xc3_name = `Photo: ${photoEvaluation}`;
      lineItem.xc3_charge = 0;
    }

    lineItems.push(lineItem);

    // Handle 2nd leg charge if present
    const secondLegCharge = parseEuroAmount(row.getCell(colIndices.secondLegCharge + 1).value);
    const secondLegAbsorbed = parseEuroAmount(row.getCell(colIndices.secondLegAbsorbed + 1).value);
    const netSecondLeg = secondLegCharge - secondLegAbsorbed;

    if (netSecondLeg > 0) {
      const tracking2 = String(row.getCell(colIndices.tracking2 + 1).value || '').trim();

      const secondLegItem: OCRLineItem = {
        ...lineItem,
        shipment_number: tracking2 || tracking1,
        shipment_reference_2: tracking1, // Link back to 1st leg
        product_name: 'Overmax Surcharge (2nd Leg)',
        description: `Overmax 2nd Leg - ${disputabilityStatus || 'not disputable'}`,
        base_price: roundAmount(netSecondLeg),
        net_amount: roundAmount(netSecondLeg),
        gross_amount: roundAmount(netSecondLeg),
      };

      lineItems.push(secondLegItem);
    }
  });

  logger.info({ lineItemCount: lineItems.length }, 'S2C Overmax XLSX parsed successfully');
  return lineItems;
}

/**
 * S2C Credit Note XLSX has similar structure to Overmax but with credit amounts
 * Columns include: reference, pickup date, from-to, tracking, charges, credits, net balance
 */
export async function parseS2CCreditNoteXLSX(xlsxPath: string): Promise<OCRLineItem[]> {
  logger.info({ xlsxPath }, 'Parsing S2C Credit Note XLSX file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheet found in XLSX file');
  }

  // Get headers from first row
  const headers: string[] = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || '').toLowerCase().trim();
  });

  logger.info({ headers: headers.slice(0, 15) }, 'Credit Note XLSX headers detected');

  // Find column indices for credit note format
  const colIndices = {
    reference: headers.findIndex(h => h === 'reference'),
    pickupDate: headers.findIndex(h => h.includes('pickup date')),
    fromTo: headers.findIndex(h => h === 'from-to'),
    tracking1: headers.findIndex(h => h === 'tracking 1'),
    firstLegCharge: headers.findIndex(h => h.includes('1st leg charge')),
    firstLegCredit: headers.findIndex(h => h.includes('1st leg credit')),
    firstLegNetBalance: headers.findIndex(h => h.includes('1st leg net balance')),
    chargedSoFar: headers.findIndex(h => h.includes('charged to you so far')),
    creditedSoFar: headers.findIndex(h => h.includes('credited to you so far')),
    pendingCharges: headers.findIndex(h => h.includes('pending +charges/-credits')),
    disputabilityStatus: headers.findIndex(h => h.includes('disputability status')),
    disputabilityReason: headers.findIndex(h => h.includes('disputability reason')),
    tracking2: headers.findIndex(h => h === 'tracking 2'),
    secondLegCharge: headers.findIndex(h => h.includes('2nd leg charge')),
    secondLegCredit: headers.findIndex(h => h.includes('2nd leg credit')),
    boxType: headers.findIndex(h => h.includes('box type')),
    photoEvaluation: headers.findIndex(h => h.includes('photo evaluation')),
  };

  const lineItems: OCRLineItem[] = [];

  // Process data rows (skip header)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const reference = String(row.getCell(colIndices.reference + 1).value || '').trim();
    const tracking1 = String(row.getCell(colIndices.tracking1 + 1).value || '').trim();

    // Skip rows without reference or tracking
    if (!reference && !tracking1) return;

    const fromTo = parseFromTo(String(row.getCell(colIndices.fromTo + 1).value || ''));
    const pickupDate = parseExcelDate(row.getCell(colIndices.pickupDate + 1).value);

    // For credit notes, we look at pending credits (negative = credit to customer)
    // The "⚖️ 1st Pending +charges/-credits to you" column shows the net
    const pendingAmount = parseEuroAmount(row.getCell(colIndices.pendingCharges + 1).value);

    // Also check if there's a net balance or credit amount
    const firstLegCredit = parseEuroAmount(row.getCell(colIndices.firstLegCredit + 1).value);
    const chargedSoFar = parseEuroAmount(row.getCell(colIndices.chargedSoFar + 1).value);
    const creditedSoFar = parseEuroAmount(row.getCell(colIndices.creditedSoFar + 1).value);

    // Calculate credit amount - for disputable items that weren't credited yet
    // pendingAmount < 0 means credit is owed to customer
    const creditAmount = pendingAmount < 0 ? Math.abs(pendingAmount) :
                         (firstLegCredit > 0 ? firstLegCredit : 0);

    // Skip if no credit
    if (creditAmount <= 0) return;

    const disputabilityStatus = String(row.getCell(colIndices.disputabilityStatus + 1).value || '').trim();
    const disputabilityReason = String(row.getCell(colIndices.disputabilityReason + 1).value || '').trim();
    const boxType = String(row.getCell(colIndices.boxType + 1).value || '').trim();
    const photoEvaluation = String(row.getCell(colIndices.photoEvaluation + 1).value || '').trim();

    // Build credit line item (positive amount, as per existing pattern for credit notes)
    const lineItem: OCRLineItem = {
      vendor: 'S2C',
      line_item_type: 'credit',

      // Shipment info
      shipment_number: tracking1,
      shipment_reference_1: reference,
      shipment_reference_2: String(row.getCell(colIndices.tracking2 + 1).value || '').trim(),
      shipment_date: pickupDate,
      booking_date: pickupDate,

      // Product/Service
      product_name: 'Overmax Credit',
      description: `Credit - ${disputabilityReason || disputabilityStatus || 'disputable'}`,
      currency: 'EUR',

      // Origin/Destination
      origin_country: getCountryName(fromTo.from),
      origin_city: '',
      origin_postal_code: '',
      destination_country: getCountryName(fromTo.to),
      destination_city: '',
      destination_postal_code: '',

      // Pricing - credit amount (positive, as system stores credit notes with positive values)
      base_price: roundAmount(creditAmount),
      net_amount: roundAmount(creditAmount),
      gross_amount: roundAmount(creditAmount),
      total_surcharges: 0,
    };

    // Store metadata
    if (chargedSoFar > 0) {
      lineItem.xc1_name = 'Originally Charged';
      lineItem.xc1_charge = chargedSoFar;
    }
    if (boxType) {
      lineItem.xc2_name = `Box: ${boxType}`;
      lineItem.xc2_charge = 0;
    }
    if (photoEvaluation) {
      lineItem.xc3_name = `Photo: ${photoEvaluation}`;
      lineItem.xc3_charge = 0;
    }

    lineItems.push(lineItem);
  });

  logger.info({ lineItemCount: lineItems.length }, 'S2C Credit Note XLSX parsed successfully');
  return lineItems;
}

/**
 * Generic function to detect S2C XLSX type and parse accordingly
 */
export async function parseS2CXLSX(xlsxPath: string, isCredit: boolean = false): Promise<OCRLineItem[]> {
  if (isCredit) {
    return parseS2CCreditNoteXLSX(xlsxPath);
  }
  return parseS2COvermaxXLSX(xlsxPath);
}

/**
 * Eurosender XLSX column mapping (same structure as CSV)
 * Columns: Invoice Number, Order Code, Tracking Number, Booking Created Date,
 *          Manifest Date, Pickup Date, Service Type, Weight (kg),
 *          Origin Country, Destination Country, Pickup Address, Delivery Address,
 *          Packages NET Total, Refund NET Total
 */
const EUROSENDER_XLSX_COLS = {
  INVOICE_NUMBER: 0,
  ORDER_CODE: 1,
  TRACKING_NUMBER: 2,
  BOOKING_CREATED_DATE: 3,
  MANIFEST_DATE: 4,
  PICKUP_DATE: 5,
  SERVICE_TYPE: 6,
  WEIGHT_KG: 7,
  ORIGIN_COUNTRY: 8,
  DESTINATION_COUNTRY: 9,
  PICKUP_ADDRESS: 10,
  DELIVERY_ADDRESS: 11,
  PACKAGES_NET_TOTAL: 12,
  REFUND_NET_TOTAL: 13,
};

/**
 * Parse Eurosender address string to extract postcode and country
 * Format: "Street, City, Postcode, COUNTRY_CODE"
 */
function parseEurosenderXLSXAddress(address: string): { country_code: string; country_name: string; postcode: string } {
  if (!address) return { country_code: '', country_name: '', postcode: '' };

  const parts = address.split(',').map((p) => p.trim());
  const country_code = parts[parts.length - 1] || '';
  const postcode = parts[parts.length - 2] || '';
  const country_name = getCountryName(country_code);

  return { country_code, country_name, postcode };
}

/**
 * Parse Eurosender XLSX file
 * Same format as CSV but in Excel format
 */
export async function parseEurosenderXLSX(xlsxPath: string): Promise<OCRLineItem[]> {
  logger.info({ xlsxPath }, 'Parsing Eurosender XLSX file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheet found in Eurosender XLSX file');
  }

  const lineItems: OCRLineItem[] = [];
  let rowIndex = 0;

  worksheet.eachRow((row, rowNumber) => {
    // Skip header row
    if (rowNumber === 1) return;
    rowIndex++;

    const values = row.values as (string | number | Date | undefined)[];
    // ExcelJS row.values is 1-indexed (index 0 is empty)
    const getCell = (col: number) => values[col + 1];

    const orderCode = String(getCell(EUROSENDER_XLSX_COLS.ORDER_CODE) || '').trim();
    if (!orderCode) {
      logger.warn({ rowNumber }, 'Skipping Eurosender XLSX row with missing order code');
      return;
    }

    const trackingNumber = String(getCell(EUROSENDER_XLSX_COLS.TRACKING_NUMBER) || '').trim();
    const origin = parseEurosenderXLSXAddress(String(getCell(EUROSENDER_XLSX_COLS.PICKUP_ADDRESS) || ''));
    const destination = parseEurosenderXLSXAddress(String(getCell(EUROSENDER_XLSX_COLS.DELIVERY_ADDRESS) || ''));

    const packageNetPrice = parseEuroAmount(getCell(EUROSENDER_XLSX_COLS.PACKAGES_NET_TOTAL));
    const refundNetTotal = parseEuroAmount(getCell(EUROSENDER_XLSX_COLS.REFUND_NET_TOTAL));

    const serviceType = String(getCell(EUROSENDER_XLSX_COLS.SERVICE_TYPE) || '').trim() || 'Eurosender';
    const pickupAddress = String(getCell(EUROSENDER_XLSX_COLS.PICKUP_ADDRESS) || '').trim();
    const deliveryAddress = String(getCell(EUROSENDER_XLSX_COLS.DELIVERY_ADDRESS) || '').trim();

    const lineItem: OCRLineItem = {
      // Vendor identification
      vendor: 'Eurosender',
      line_item_type: 'shipment',

      // Invoice info
      invoice_number: String(getCell(EUROSENDER_XLSX_COLS.INVOICE_NUMBER) || '').trim(),
      currency: 'EUR',

      // Shipment info
      shipment_number: trackingNumber || '',
      booking_date: parseExcelDate(getCell(EUROSENDER_XLSX_COLS.BOOKING_CREATED_DATE)),
      shipment_date: parseExcelDate(getCell(EUROSENDER_XLSX_COLS.PICKUP_DATE)),
      shipment_reference_1: orderCode,

      // Product
      product_name: serviceType,
      description: serviceType,
      pieces: 1,

      // Weight
      weight_kg: parseFloat(String(getCell(EUROSENDER_XLSX_COLS.WEIGHT_KG) || '0')) || 0,
      weight_flag: 'kg',

      // Origin - aligned with DB column names
      origin_country: String(getCell(EUROSENDER_XLSX_COLS.ORIGIN_COUNTRY) || '').trim() || origin.country_name,
      origin_city: pickupAddress,
      origin_postal_code: origin.postcode,

      // Destination - aligned with DB column names
      destination_country: String(getCell(EUROSENDER_XLSX_COLS.DESTINATION_COUNTRY) || '').trim() || destination.country_name,
      destination_city: deliveryAddress,
      destination_postal_code: destination.postcode,

      // Pricing
      net_amount: roundAmount(packageNetPrice),
      gross_amount: roundAmount(packageNetPrice),
      base_price: roundAmount(packageNetPrice),
      total_tax: 0,
      total_surcharges: 0,
      total_surcharges_tax: 0,
    };

    // Handle refunds as negative extra charge
    if (refundNetTotal !== 0) {
      lineItem.xc1_name = 'Refund';
      lineItem.xc1_charge = roundAmount(-refundNetTotal);
      lineItem.net_amount = roundAmount(packageNetPrice - refundNetTotal);
      lineItem.gross_amount = roundAmount(packageNetPrice - refundNetTotal);
    }

    lineItems.push(lineItem);
  });

  logger.info({ lineItemCount: lineItems.length }, 'Eurosender XLSX parsed successfully');
  return lineItems;
}

/**
 * Red Stag Shipping XLSX column mapping
 * Sheet: "FedEx"
 * Row 1: Aggregated data (skip)
 * Row 2: Headers
 * Row 3+: Data
 *
 * Columns:
 * 1: Tracking ID, 2: Service Type, 3: Shipment Date (YYYYMMDD), 4: Order #,
 * 5: Order Reference, 6: Sku, 7: Actual Weight, 8: Rated Weight,
 * 9: Number of Pieces, 10: Dim Length, 11: Dim Width, 12: Dim Height,
 * 13: Dim Unit, 14: Dim Weight, 15: Zone Code, 16: Weight-Zone,
 * 17: Recipient Name, 18: Recipient Company, 19: Recipient Address Line1,
 * 20: Recipient Address Line2, 21: Recipient City, 22: Recipient State,
 * 23: Recipient Zip Code, 24: Recipient Country, 25: Shipper Company,
 * 26: Warehouse, 27: Original Client Reference, 28: Base Shipping Rate,
 * 29: Discount %, 30: Discounted Base, 31: Fuel Surcharge %,
 * 32: Fuel Surcharge, 33-48: Various surcharges, 49: Total Charges
 */
const RED_STAG_COLS = {
  TRACKING_ID: 1,
  SERVICE_TYPE: 2,
  SHIPMENT_DATE: 3,
  ORDER_NUMBER: 4,
  ORDER_REFERENCE: 5,
  SKU: 6,
  ACTUAL_WEIGHT: 7,
  RATED_WEIGHT: 8,
  PIECES: 9,
  DIM_LENGTH: 10,
  DIM_WIDTH: 11,
  DIM_HEIGHT: 12,
  DIM_UNIT: 13,
  DIM_WEIGHT: 14,
  ZONE_CODE: 15,
  WEIGHT_ZONE: 16,
  RECIPIENT_NAME: 17,
  RECIPIENT_COMPANY: 18,
  RECIPIENT_ADDRESS1: 19,
  RECIPIENT_ADDRESS2: 20,
  RECIPIENT_CITY: 21,
  RECIPIENT_STATE: 22,
  RECIPIENT_ZIP: 23,
  RECIPIENT_COUNTRY: 24,
  SHIPPER_COMPANY: 25,
  WAREHOUSE: 26,
  CLIENT_REFERENCE: 27,
  BASE_RATE: 28,
  DISCOUNT_PCT: 29,
  DISCOUNTED_BASE: 30,
  FUEL_SURCHARGE_PCT: 31,
  FUEL_SURCHARGE: 32,
  // Surcharge columns vary by invoice (33-48)
  TOTAL_CHARGES: 49,
};

/**
 * Parse Red Stag shipment date from YYYYMMDD format
 */
function parseRedStagDate(value: unknown): string {
  if (!value) return '';

  const str = String(value).trim();
  if (!str || str.length !== 8) return '';

  // Format: YYYYMMDD -> YYYY-MM-DD
  const year = str.slice(0, 4);
  const month = str.slice(4, 6);
  const day = str.slice(6, 8);

  const dateStr = `${year}-${month}-${day}`;

  // Validate the date
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return '';

  return dateStr;
}

/**
 * Parse Red Stag Shipping XLSX file (FedEx shipment details)
 * Used for: shipping_invoice_bcl_*_client_detail.xlsx
 */
export async function parseRedStagShippingXLSX(xlsxPath: string): Promise<OCRLineItem[]> {
  logger.info({ xlsxPath }, 'Parsing Red Stag Shipping XLSX file');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  // Red Stag uses "FedEx" as sheet name
  let worksheet = workbook.getWorksheet('FedEx');
  if (!worksheet) {
    // Fallback to first worksheet
    worksheet = workbook.worksheets[0];
  }

  if (!worksheet) {
    throw new Error('No worksheet found in Red Stag XLSX file');
  }

  logger.info({ sheetName: worksheet.name, rowCount: worksheet.rowCount }, 'Found worksheet');

  const lineItems: OCRLineItem[] = [];

  // Detect header row (row 2 has headers, row 1 might have aggregated data)
  // Find which row contains "Tracking ID" to confirm header location
  let headerRow = 2;
  const row1Cell = worksheet.getRow(1).getCell(1).value;
  const row2Cell = worksheet.getRow(2).getCell(1).value;

  if (String(row2Cell).toLowerCase().includes('tracking')) {
    headerRow = 2;
  } else if (String(row1Cell).toLowerCase().includes('tracking')) {
    headerRow = 1;
  }

  const dataStartRow = headerRow + 1;
  logger.info({ headerRow, dataStartRow }, 'Detected row structure');

  // Build dynamic surcharge column mapping from headers
  const surchargeColumns: { col: number; name: string }[] = [];
  const headerRowData = worksheet.getRow(headerRow);

  for (let col = 33; col <= 48; col++) {
    const headerValue = headerRowData.getCell(col).value;
    if (headerValue && String(headerValue).trim()) {
      surchargeColumns.push({ col, name: String(headerValue).trim() });
    }
  }

  logger.info({ surchargeCount: surchargeColumns.length }, 'Detected surcharge columns');

  // Process data rows
  for (let rowNum = dataStartRow; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);

    const getCell = (col: number): unknown => row.getCell(col).value;
    const getCellStr = (col: number): string => String(getCell(col) || '').trim();
    const getCellNum = (col: number): number => {
      const val = getCell(col);
      if (typeof val === 'number') return val;
      return parseFloat(String(val || '0').replace(/[,$]/g, '')) || 0;
    };

    const trackingId = getCellStr(RED_STAG_COLS.TRACKING_ID);

    // Skip empty rows or header rows that might have been repeated
    if (!trackingId || trackingId.toLowerCase() === 'tracking id') {
      continue;
    }

    const serviceType = getCellStr(RED_STAG_COLS.SERVICE_TYPE);
    const shipmentDate = parseRedStagDate(getCell(RED_STAG_COLS.SHIPMENT_DATE));
    const orderRef = getCellStr(RED_STAG_COLS.ORDER_REFERENCE);
    const recipientCity = getCellStr(RED_STAG_COLS.RECIPIENT_CITY);
    const recipientState = getCellStr(RED_STAG_COLS.RECIPIENT_STATE);
    const recipientZip = getCellStr(RED_STAG_COLS.RECIPIENT_ZIP);
    const recipientCountry = getCellStr(RED_STAG_COLS.RECIPIENT_COUNTRY);
    const warehouse = getCellStr(RED_STAG_COLS.WAREHOUSE);

    const actualWeight = getCellNum(RED_STAG_COLS.ACTUAL_WEIGHT);
    const pieces = getCellNum(RED_STAG_COLS.PIECES) || 1;
    const baseRate = getCellNum(RED_STAG_COLS.BASE_RATE);
    const fuelSurcharge = getCellNum(RED_STAG_COLS.FUEL_SURCHARGE);
    const totalCharges = getCellNum(RED_STAG_COLS.TOTAL_CHARGES);

    // Build dimensions string
    const dimLength = getCellNum(RED_STAG_COLS.DIM_LENGTH);
    const dimWidth = getCellNum(RED_STAG_COLS.DIM_WIDTH);
    const dimHeight = getCellNum(RED_STAG_COLS.DIM_HEIGHT);
    const dimUnit = getCellStr(RED_STAG_COLS.DIM_UNIT) || 'in';
    const packageDimensions = dimLength && dimWidth && dimHeight
      ? `${dimLength}x${dimWidth}x${dimHeight} ${dimUnit}`
      : '';

    // Build destination city with state
    const destinationCity = recipientState
      ? `${recipientCity}, ${recipientState}`
      : recipientCity;

    // Clean zip code (sometimes has extra digits like "02601292323")
    const cleanZip = recipientZip.length > 5 ? recipientZip.slice(0, 5) : recipientZip;

    // Calculate total surcharges (excluding fuel which is separate)
    let totalSurcharges = 0;
    const surchargeData: Record<string, number> = {};

    surchargeColumns.forEach(({ col, name }) => {
      const amount = getCellNum(col);
      if (amount !== 0) {
        surchargeData[name] = amount;
        totalSurcharges += amount;
      }
    });

    const lineItem: OCRLineItem = {
      // Vendor identification
      vendor: 'Red Stag',
      line_item_type: 'shipment',

      // Shipment info
      shipment_number: trackingId,
      shipment_date: shipmentDate,
      shipment_reference_1: orderRef,
      shipment_reference_2: getCellStr(RED_STAG_COLS.CLIENT_REFERENCE),

      // Product/service
      product_name: serviceType || 'FedEx',
      description: serviceType || 'FedEx Shipment',
      pieces: pieces,

      // Weight & dimensions
      weight_kg: actualWeight, // Note: Red Stag uses lbs, but field is weight_kg
      weight_flag: 'lbs',
      package_dimensions: packageDimensions,

      // Origin (warehouse)
      origin_country: 'United States',
      origin_city: warehouse,

      // Destination
      destination_country: getCountryName(recipientCountry) || recipientCountry,
      destination_city: destinationCity,
      destination_postal_code: cleanZip,

      // Pricing (USD)
      currency: 'USD',
      base_price: roundAmount(baseRate),
      net_amount: roundAmount(totalCharges),
      gross_amount: roundAmount(totalCharges),
      total_tax: 0,
      total_surcharges: roundAmount(totalSurcharges + fuelSurcharge),
    };

    // Add fuel surcharge as xc1
    if (fuelSurcharge !== 0) {
      lineItem.xc1_name = 'Fuel Surcharge';
      lineItem.xc1_charge = roundAmount(fuelSurcharge);
    }

    // Add other surcharges as xc2-xc9
    const surchargeEntries = Object.entries(surchargeData).filter(([, amt]) => amt !== 0);
    surchargeEntries.slice(0, 8).forEach(([name, amount], index) => {
      const xcNum = index + 2; // xc2, xc3, etc.
      (lineItem as Record<string, unknown>)[`xc${xcNum}_name`] = name;
      (lineItem as Record<string, unknown>)[`xc${xcNum}_charge`] = roundAmount(amount);
    });

    lineItems.push(lineItem);
  }

  logger.info({ lineItemCount: lineItems.length }, 'Red Stag Shipping XLSX parsed successfully');
  return lineItems;
}
