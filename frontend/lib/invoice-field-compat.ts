/**
 * Invoice Field Utilities
 *
 * Helper functions for safely accessing invoice data fields.
 *
 * Field Names (DB-aligned):
 * - account_number
 * - gross_amount
 * - invoice_date
 * - booking_date
 * - origin_country, origin_city, origin_postal_code
 * - destination_country, destination_city, destination_postal_code
 * - total_surcharges, total_surcharges_tax
 */

/**
 * Get a field value from invoice data safely.
 *
 * @param data - Object containing invoice fields (consensus_data, raw_results, etc.)
 * @param fieldName - Field name to retrieve
 * @param defaultValue - Default value if field not found
 * @returns Field value or default
 */
export function getInvoiceField<T = string | number | string[] | null>(
  data: Record<string, unknown> | null | undefined,
  fieldName: string,
  defaultValue: T = '' as T
): T {
  if (!data) return defaultValue;

  if (fieldName in data && data[fieldName] !== null && data[fieldName] !== undefined) {
    return data[fieldName] as T;
  }

  return defaultValue;
}

/**
 * Get vendor name from invoice data
 */
export function getVendor(data: Record<string, unknown> | null | undefined): string {
  return getInvoiceField(data, 'vendor', '-');
}

/**
 * Get account number from invoice data
 */
export function getAccountNumber(data: Record<string, unknown> | null | undefined): string {
  return getInvoiceField(data, 'account_number', '-');
}

/**
 * Get invoice number from invoice data
 */
export function getInvoiceNumber(data: Record<string, unknown> | null | undefined): string {
  return getInvoiceField(data, 'invoice_number', '-');
}

/**
 * Get gross amount from invoice data
 */
export function getGrossAmount(data: Record<string, unknown> | null | undefined): number {
  return getInvoiceField(data, 'gross_amount', 0);
}

/**
 * Get invoice date from invoice data
 */
export function getInvoiceDate(data: Record<string, unknown> | null | undefined): string {
  return getInvoiceField(data, 'invoice_date', '-');
}

/**
 * Get due date from invoice data
 */
export function getDueDate(data: Record<string, unknown> | null | undefined): string {
  return getInvoiceField(data, 'due_date', '-');
}

/**
 * Get currency from invoice data
 */
export function getCurrency(data: Record<string, unknown> | null | undefined): string {
  return getInvoiceField(data, 'currency', 'EUR');
}

/**
 * Get formatted amount with currency symbol
 */
export function getFormattedAmount(data: Record<string, unknown> | null | undefined): string {
  const amount = getGrossAmount(data);
  const currencyCode = getCurrency(data);

  if (amount === 0 || amount === null || Number.isNaN(Number(amount))) return '-';

  const symbol =
    currencyCode === 'EUR' ? '€' :
    currencyCode === 'GBP' ? '£' :
    currencyCode === 'USD' ? '$' :
    `${currencyCode} `;

  return `${symbol}${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
