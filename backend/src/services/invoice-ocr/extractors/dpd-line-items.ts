import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { OCRLineItem } from '@shared/types';
import { logger } from '../../../utils/logger';

// Lazy-load pdfjs-dist as ES module
// Using Function constructor to create a dynamic import that TypeScript won't transpile
let pdfjsLib: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;
async function getPdfJS() {
  if (!pdfjsLib) {
    // Use indirect eval via Function to preserve dynamic import at runtime
    // This is safer than direct eval as it doesn't have access to local scope
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    pdfjsLib = await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLib;
}

// Country code mapping for DPD invoices
const COUNTRY_CODE_MAP: Record<string, string> = {
  NLD: 'Netherlands',
  AUT: 'Austria',
  ESP: 'Spain',
  BEL: 'Belgium',
  DNK: 'Denmark',
  FRA: 'France',
  ITA: 'Italy',
  DEU: 'Germany',
  POL: 'Poland',
  CZE: 'Czech Republic',
  SVK: 'Slovakia',
  HUN: 'Hungary',
  ROM: 'Romania',
  BGR: 'Bulgaria',
  HRV: 'Croatia',
  SVN: 'Slovenia',
  GRC: 'Greece',
  PRT: 'Portugal',
  SWE: 'Sweden',
  NOR: 'Norway',
  FIN: 'Finland',
  CHE: 'Switzerland',
  GBR: 'United Kingdom',
  IRL: 'Ireland',
  LUX: 'Luxembourg',
};

// Service code mapping for DPD
const SERVICE_NAME_MAP: Record<string, string> = {
  P: 'Predict',
  N: 'Nachnahme',
  S: 'Saturday Delivery',
  R: 'Return',
};

interface DPDLineItemRaw {
  position: string;
  shipment_number: string;
  shipment_date: string;
  destination_postcode: string;
  service_code: string;
  weight: string;
  amount: string;
  services: string;
}

/**
 * Extract text from PDF using pdfjs-dist
 */
async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    const pdfjs = await getPdfJS();
    if (!pdfjs) {
      throw new Error('Failed to load pdfjs-dist');
    }
    const loadingTask = pdfjs.getDocument(filePath);
    const pdf = await loadingTask.promise;

    let fullText = '';

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? (item as TextItem).str : ''))
        .join(' ');
      fullText += pageText + '\n';
    }

    return fullText;
  } catch (error) {
    logger.error({ error, filePath }, 'Failed to extract text from PDF');
    throw new Error(`PDF text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse DPD line items from PDF text using regex
 * Pattern matches lines extracted by pdfjs which come in this order:
 * "DEU-81671 P 2 17.03.25 5,00€ 328 1806810977548 0,75 kg"
 * Format: zuOrt Services Pos Date Betrag ServiceCode PaketNr Gewicht
 */
function parseDPDLineItems(text: string, invoiceNumber: string): OCRLineItem[] {
  const lineItems: OCRLineItem[] = [];

  // DPD invoice line item pattern for pdfjs-dist text extraction
  // Format: zuOrt Services Pos Date Betrag ServiceCode PaketNr Gewicht
  // Example: DEU-81671 P 2 17.03.25 5,00€ 328 1806810977548 0,75 kg
  // Note: Weight can be "0,75 kg" or "k.A." (not available)
  const pattern = /([\w-]+)\s+([A-Z,N]+)\s+(\d+)\s+(\d{2}\.\d{2}\.\d{2})\s+([\d,]+)€\s+(\d+)\s+(\d+)\s+([\d,]+\s*kg|k\.A\.)/g;

  const matches = [...text.matchAll(pattern)];

  if (matches.length === 0) {
    logger.warn('No DPD line items found in PDF text');
    return lineItems;
  }

  logger.info({ count: matches.length }, 'Found DPD line items in PDF');

  for (const match of matches) {
    const weightStr = match[8] || 'k.A.';
    const rawItem: DPDLineItemRaw = {
      position: match[3],
      shipment_number: match[7],
      shipment_date: match[4],
      destination_postcode: match[1],
      service_code: match[6],
      weight: weightStr === 'k.A.' ? '0' : weightStr.replace(' kg', ''),
      amount: match[5],
      services: match[2]?.trim() || '',
    };

    // Parse weight (convert comma to dot for decimal)
    const weightKg = parseFloat(rawItem.weight.replace(',', '.')) || 0;

    // Parse amount (convert comma to dot for decimal)
    const amount = parseFloat(rawItem.amount.replace(',', '.')) || 0;

    // Extract country from destination postcode (e.g., "NLD-721EX" -> "Netherlands")
    const destination = rawItem.destination_postcode;
    const countryCode = destination.split('-')[0];
    const destinationCountry = COUNTRY_CODE_MAP[countryCode] || countryCode;

    // Parse services (e.g., "P,N" -> separate into XC1, XC2)
    const services = rawItem.services.split(',').map(s => s.trim()).filter(s => s);

    const lineItem: OCRLineItem = {
      shipment_number: rawItem.shipment_number,
      shipment_date: rawItem.shipment_date,
      booking_date: rawItem.shipment_date, // Same as shipment date for DPD
      shipment_reference_1: undefined,
      shipment_reference_2: undefined,
      product_name: 'DPD Package',
      pieces: 1,
      weight_kg: weightKg,
      weight_flag: undefined,
      origin_country: undefined,
      origin_city: 'TFJ buycycle GmbH', // Default sender
      origin_postal_code: undefined,
      destination_country: destinationCountry,
      destination_city: 'Customer',
      destination_postal_code: destination,
      net_amount: amount,
      gross_amount: amount,
      base_price: amount,
      total_tax: 0,
      total_surcharges: 0,
      total_surcharges_tax: 0,
      xc1_name: services[0] ? SERVICE_NAME_MAP[services[0]] || services[0] : undefined,
      xc1_charge: 0,
      xc2_name: services[1] ? SERVICE_NAME_MAP[services[1]] || services[1] : undefined,
      xc2_charge: 0,
      vendor: 'DPD',
      line_item_type: 'shipment',
    };

    lineItems.push(lineItem);
  }

  logger.info({ count: lineItems.length, invoiceNumber }, 'Parsed DPD line items');
  return lineItems;
}

/**
 * Check if a PDF is a DPD invoice by looking for DPD-specific markers
 */
export async function isDPDInvoice(filePath: string): Promise<boolean> {
  try {
    const text = await extractTextFromPDF(filePath);

    // Look for DPD-specific markers
    const dpdMarkers = [
      /DPD\s+(Deutschland|GmbH|Depot)/i,
      /Paket.*Depot/i,
      /DPDgroup/i,
    ];

    const hasDPDMarker = dpdMarkers.some(marker => marker.test(text));

    logger.info({ hasDPDMarker, filePath }, 'DPD invoice detection result');
    return hasDPDMarker;
  } catch (error) {
    logger.error({ error, filePath }, 'Failed to detect DPD invoice');
    return false;
  }
}

/**
 * Extract line items from a DPD invoice PDF
 */
export async function extractDPDLineItems(filePath: string, invoiceNumber: string): Promise<OCRLineItem[]> {
  try {
    logger.info({ filePath, invoiceNumber }, 'Starting DPD line items extraction');

    // Extract text from PDF
    const text = await extractTextFromPDF(filePath);

    // Parse line items
    const lineItems = parseDPDLineItems(text, invoiceNumber);

    if (lineItems.length === 0) {
      logger.warn({ filePath }, 'No line items found in DPD invoice');
    }

    return lineItems;
  } catch (error) {
    logger.error({ error, filePath }, 'DPD line items extraction failed');
    throw error;
  }
}
