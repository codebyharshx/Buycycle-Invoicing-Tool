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
 */
function parseExcelDate(value: unknown): string {
  if (!value) return '';

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  const str = String(value).trim();

  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.split('T')[0];
  }

  // Handle DD/MM/YYYY or D/M/YYYY format
  const parts = str.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return str;
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
