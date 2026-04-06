import { readFileSync } from 'fs';
import { extname } from 'path';
import { InvoiceData, PartialInvoiceData, OCRLineItem } from '@shared/types';

/**
 * Valid document types for invoice_extractions table
 */
export type DocumentType = 'shipping_invoice' | 'credit_note' | 'surcharge_invoice' | 'correction' | 'proforma';

/**
 * Normalize document type from raw OCR extraction
 * Detects credit notes, corrections, surcharges based on keywords and amounts
 *
 * @param rawDocumentType - Raw document type string from OCR extraction
 * @param netAmount - Net amount (negative values indicate credit notes)
 * @param invoiceNumber - Invoice number (some patterns indicate credit notes)
 * @returns Normalized document type
 *
 * @example
 * normalizeDocumentType('Credit Note', -100) → 'credit_note'
 * normalizeDocumentType('Gutschrift', -50) → 'credit_note'
 * normalizeDocumentType('Invoice', -25) → 'credit_note' (negative amount)
 * normalizeDocumentType('Invoice', 100) → 'shipping_invoice'
 * normalizeDocumentType('Surcharge Invoice', 50) → 'surcharge_invoice'
 */
export function normalizeDocumentType(
  rawDocumentType: string | undefined | null,
  netAmount?: number,
  invoiceNumber?: string
): DocumentType {
  const raw = (rawDocumentType || '').toLowerCase().trim();
  const invNum = (invoiceNumber || '').toUpperCase();

  // Credit note detection - check keywords first
  const creditKeywords = [
    'credit', 'kredit', 'gutschrift', 'nota di credito', 'nota credito',
    'abono', 'avoir', 'refund', 'rückerstattung', 'reembolso',
    'storno', 'stornorechnung', 'korrektur'
  ];

  if (creditKeywords.some(keyword => raw.includes(keyword))) {
    return 'credit_note';
  }

  // DHL credit note invoice number patterns
  // MUCINR = Credit Note, MUCNR = Credit Note (Munich)
  // INR suffix typically indicates credit/internal reference
  if (invNum.includes('INR') || invNum.includes('MUCINR') || invNum.includes('MUCNR')) {
    return 'credit_note';
  }

  // Correction detection
  const correctionKeywords = ['correction', 'korrektur', 'berichtigung', 'rettifica'];
  if (correctionKeywords.some(keyword => raw.includes(keyword))) {
    return 'correction';
  }

  // Surcharge detection
  const surchargeKeywords = ['surcharge', 'zuschlag', 'nachbelastung', 'supplemento', 'recargo'];
  if (surchargeKeywords.some(keyword => raw.includes(keyword))) {
    return 'surcharge_invoice';
  }

  // Proforma detection
  const proformaKeywords = ['proforma', 'pro forma', 'pro-forma'];
  if (proformaKeywords.some(keyword => raw.includes(keyword))) {
    return 'proforma';
  }

  // Fallback: negative net amount indicates credit note
  if (typeof netAmount === 'number' && netAmount < 0) {
    return 'credit_note';
  }

  // Default to shipping invoice
  return 'shipping_invoice';
}

/**
 * Extract parent invoice number from credit note
 * Credit notes often reference the original invoice they're crediting
 *
 * @param rawData - Raw extraction data containing potential references
 * @returns Parent invoice number if found, undefined otherwise
 */
export function extractParentInvoiceNumber(
  rawData: PartialInvoiceData
): string | undefined {
  // Check if parent_invoice_number was directly extracted
  if (rawData.parent_invoice_number) {
    return rawData.parent_invoice_number;
  }

  // TODO: Add pattern matching for common reference formats
  // e.g., "Reference: INV-12345", "Original Invoice: 12345"

  return undefined;
}

/**
 * Round amount to maximum 2 decimal places
 * Fixes floating point precision issues (e.g., 4312.350000000003 → 4312.35)
 *
 * @param amount - Amount to round
 * @returns Amount rounded to 2 decimal places
 *
 * @example
 * roundAmount(4312.350000000003) → 4312.35
 * roundAmount(123.456) → 123.46
 * roundAmount(100) → 100
 */
export function roundAmount(amount: number | null | undefined): number {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}

/**
 * Normalize date to DD/MM/YYYY format (European standard)
 * Since most vendors are European, we standardize on DD/MM/YYYY for consistency.
 *
 * @param dateStr - Date string in various formats
 * @returns Date in DD/MM/YYYY format, or empty string if invalid
 *
 * @example
 * normalizeDateToEU('04.12.2025') → '04/12/2025' (European DD.MM.YYYY - kept as is)
 * normalizeDateToEU('2025-12-04') → '04/12/2025' (ISO YYYY-MM-DD → DD/MM/YYYY)
 * normalizeDateToEU('12/04/2025') → '12/04/2025' (Ambiguous - assume European DD/MM/YYYY)
 * normalizeDateToEU('December 29, 2025') → '29/12/2025' (US text format → DD/MM/YYYY)
 */
export function normalizeDateToEU(dateStr: string): string {
  if (!dateStr || dateStr.trim() === '') {
    return '';
  }

  const trimmed = dateStr.trim();

  // ISO format: YYYY-MM-DD or YYYY/MM/DD → DD/MM/YYYY
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }

  // European format with dots: DD.MM.YYYY → DD/MM/YYYY
  const europeanDotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (europeanDotMatch) {
    const [, day, month, year] = europeanDotMatch;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }

  // Format with slashes: DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, first, second, year] = slashMatch;

    // If second number > 12, it MUST be MM/DD/YYYY (US format) - convert to DD/MM/YYYY
    // Example: 01/29/2025 - 29 can't be a month, so it's MM/DD → swap to 29/01/2025
    if (parseInt(second, 10) > 12) {
      // US format: MM/DD/YYYY → DD/MM/YYYY (swap first and second)
      return `${second.padStart(2, '0')}/${first.padStart(2, '0')}/${year}`;
    }

    // If first number > 12, it MUST be DD/MM/YYYY (European) - already correct
    // Example: 29/01/2025 - 29 can't be a month, so it's DD/MM → keep as is
    if (parseInt(first, 10) > 12) {
      return `${first.padStart(2, '0')}/${second.padStart(2, '0')}/${year}`;
    }

    // Ambiguous case (both ≤ 12): Assume European DD/MM/YYYY since most vendors are European
    // Example: 05/01/2025 - could be May 1 (US) or Jan 5 (EU), assume EU = 05/01/2025
    return `${first.padStart(2, '0')}/${second.padStart(2, '0')}/${year}`;
  }

  // US text format: "Month DD, YYYY" or "Month D, YYYY" → DD/MM/YYYY
  const monthNames: Record<string, string> = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09',
    'oct': '10', 'nov': '11', 'dec': '12'
  };

  const textMatch = trimmed.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (textMatch) {
    const [, monthStr, day, year] = textMatch;
    const month = monthNames[monthStr.toLowerCase()];
    if (month) {
      return `${day.padStart(2, '0')}/${month}/${year}`;
    }
  }

  // Full JavaScript date string: "Fri Sep 26 2025 00:00:00 GMT+0200 (Central European Summer Time)"
  // Pattern: Day Month DD YYYY HH:MM:SS ...
  const jsDateMatch = trimmed.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (jsDateMatch) {
    const [, monthAbbr, day, year] = jsDateMatch;
    const month = monthNames[monthAbbr.toLowerCase()];
    if (month) {
      return `${day.padStart(2, '0')}/${month}/${year}`;
    }
  }

  // If format is unrecognized, return empty string
  return '';
}

/**
 * @deprecated Use normalizeDateToEU instead - we standardize on European DD/MM/YYYY format
 */
export const normalizeDateToUS = normalizeDateToEU;

/**
 * Parse a date string into a Date object for comparison
 * Handles various formats: DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD, etc.
 *
 * @param dateStr - Date string in various formats
 * @returns Date object or null if invalid
 */
export function parseDateForComparison(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr.trim() === '') {
    return null;
  }

  const trimmed = dateStr.trim();

  // ISO format: YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // European format with dots: DD.MM.YYYY
  const europeanDotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (europeanDotMatch) {
    const [, day, month, year] = europeanDotMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // Format with slashes: DD/MM/YYYY (assume European)
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, first, second, year] = slashMatch;

    // If second > 12, it's MM/DD/YYYY (US format)
    if (parseInt(second, 10) > 12) {
      return new Date(parseInt(year), parseInt(first) - 1, parseInt(second));
    }

    // Otherwise assume European DD/MM/YYYY
    return new Date(parseInt(year), parseInt(second) - 1, parseInt(first));
  }

  // Try JavaScript Date parsing as fallback
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

/**
 * Format a Date object to DD/MM/YYYY string
 *
 * @param date - Date object
 * @returns Date string in DD/MM/YYYY format
 */
export function formatDateToEU(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Normalize date fields in line items to DD/MM/YYYY format
 *
 * @param lineItems - Array of line items
 * @returns Array of line items with normalized date fields
 */
export function normalizeLineItemDates(lineItems: OCRLineItem[]): OCRLineItem[] {
  return lineItems.map(item => ({
    ...item,
    shipment_date: item.shipment_date ? normalizeDateToEU(item.shipment_date) : undefined,
    booking_date: item.booking_date ? normalizeDateToEU(item.booking_date) : undefined,
  }));
}

/**
 * Calculate performance period from line items
 * Performance period = date range from first transaction to last transaction
 *
 * Uses shipment_date as primary date field, falls back to booking_created_date
 *
 * @param lineItems - Array of line items with date fields
 * @returns Object with performance_period_start and performance_period_end in DD/MM/YYYY format
 *
 * @example
 * // Line items with shipment dates: 2025-12-01, 2025-12-15, 2025-12-29
 * calculatePerformancePeriodFromLineItems(lineItems)
 * // Returns: { performance_period_start: '01/12/2025', performance_period_end: '29/12/2025' }
 */
export function calculatePerformancePeriodFromLineItems(
  lineItems: OCRLineItem[] | undefined
): { performance_period_start: string; performance_period_end: string } {
  const defaultResult = { performance_period_start: '', performance_period_end: '' };

  if (!lineItems || lineItems.length === 0) {
    return defaultResult;
  }

  // Extract all valid dates from line items
  const dates: Date[] = [];

  for (const item of lineItems) {
    // Try shipment_date first, then booking_date
    const dateStr = item.shipment_date || item.booking_date;
    const parsed = parseDateForComparison(dateStr);

    if (parsed) {
      dates.push(parsed);
    }
  }

  if (dates.length === 0) {
    return defaultResult;
  }

  // Find min and max dates
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

  return {
    performance_period_start: formatDateToEU(minDate),
    performance_period_end: formatDateToEU(maxDate),
  };
}

/**
 * Normalize partial invoice data to complete format with defaults
 * All dates are normalized to DD/MM/YYYY format (European standard)
 * All amounts are rounded to 2 decimal places
 *
 * If line_items are present and performance_period is empty, it will be calculated
 * from the min/max shipment dates in the line items.
 */
export function normalizeInvoiceData(data: PartialInvoiceData): InvoiceData {
  // Normalize line items first (including their dates to DD/MM/YYYY)
  const rawLineItems = data.line_items || [];
  const normalizedLineItems = rawLineItems.length > 0
    ? normalizeLineItemDates(rawLineItems)
    : [];

  // Normalize performance period from PDF extraction first
  let performancePeriodStart = normalizeDateToEU(data.performance_period_start || '');
  let performancePeriodEnd = normalizeDateToEU(data.performance_period_end || '');

  // If line items exist and performance period is empty/missing, calculate from line items
  // Performance period = date range from first transaction to last transaction
  if (normalizedLineItems.length > 0 && (!performancePeriodStart || !performancePeriodEnd)) {
    const calculatedPeriod = calculatePerformancePeriodFromLineItems(normalizedLineItems);

    // Use calculated values if available (override empty PDF-extracted values)
    if (calculatedPeriod.performance_period_start) {
      performancePeriodStart = calculatedPeriod.performance_period_start;
    }
    if (calculatedPeriod.performance_period_end) {
      performancePeriodEnd = calculatedPeriod.performance_period_end;
    }
  }

  // Calculate net amount first (needed for document type normalization)
  const netAmount = roundAmount(data.net_amount);

  // Normalize document type using raw value, amount, and invoice number
  const normalizedDocumentType = normalizeDocumentType(
    data.document_type || data.document_type_raw,
    netAmount,
    data.invoice_number
  );

  // Extract parent invoice number for credit notes
  const parentInvoiceNumber = extractParentInvoiceNumber(data);

  return {
    vendor: data.vendor || '',
    account_number: data.account_number || '',
    invoice_number: data.invoice_number || '',
    document_type: normalizedDocumentType,
    document_type_raw: data.document_type || data.document_type_raw,
    parent_invoice_number: parentInvoiceNumber,
    net_amount: netAmount,
    vat_amount: roundAmount(data.vat_amount),
    vat_percentage: roundAmount(data.vat_percentage),
    gross_amount: roundAmount(data.gross_amount),
    currency: data.currency || '',
    invoice_date: normalizeDateToEU(data.invoice_date || ''),
    due_date: normalizeDateToEU(data.due_date || ''),
    performance_period_start: performancePeriodStart,
    performance_period_end: performancePeriodEnd,
    assigned_to: data.assigned_to || '',
    booking_date: normalizeDateToEU(data.booking_date || ''),
    line_items: normalizedLineItems,
  };
}

/**
 * Convert file to base64 data URL
 * Modern vision models (Claude 3.7, Gemini 2.5, Mistral OCR) all support PDFs natively
 */
export async function fileToBase64DataUrl(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };

  const mimeType = mimeTypes[ext] || 'application/octet-stream';
  const fileData = readFileSync(filePath);
  const base64Data = fileData.toString('base64');

  return `data:${mimeType};base64,${base64Data}`;
}

/**
 * Clean JSON content that may have markdown formatting
 */
export function cleanJsonContent(content: string): string {
  let cleaned = content.trim();

  // Remove markdown code blocks
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    cleaned = lines.slice(1, -1).join('\n');
    if (cleaned.startsWith('json')) {
      cleaned = cleaned.substring(4).trim();
    }
  }

  return cleaned;
}
