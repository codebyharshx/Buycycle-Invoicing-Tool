/**
 * Format utilities for the invoice system
 */

/**
 * Format a number as currency
 */
export function formatCurrency(amount: number, currency: string = 'EUR'): string {
  const symbol = currency === 'EUR' ? '\u20AC' : currency === 'GBP' ? '\u00A3' : currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format date for table display as "Mon DD, YYYY"
 */
export function formatInvoiceDateForTable(dateStr: string): string {
  if (!dateStr || dateStr === '-') return '-';

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let day: number, month: number, year: number;

  // YYYY-MM-DD (ISO)
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    year = parseInt(isoMatch[1]);
    month = parseInt(isoMatch[2]) - 1;
    day = parseInt(isoMatch[3]);
    return `${monthNames[month]} ${String(day).padStart(2, '0')}, ${year}`;
  }

  // DD.MM.YYYY (European dots)
  const europeanDotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (europeanDotMatch) {
    day = parseInt(europeanDotMatch[1]);
    month = parseInt(europeanDotMatch[2]) - 1;
    year = parseInt(europeanDotMatch[3]);
    return `${monthNames[month]} ${String(day).padStart(2, '0')}, ${year}`;
  }

  // DD/MM/YYYY with slashes
  const slashMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const first = parseInt(slashMatch[1]);
    const second = parseInt(slashMatch[2]);
    year = parseInt(slashMatch[3]);

    if (second > 12) {
      month = first - 1;
      day = second;
    } else {
      day = first;
      month = second - 1;
    }
    return `${monthNames[month]} ${String(day).padStart(2, '0')}, ${year}`;
  }

  return dateStr;
}

/**
 * Parse date string to Date object
 */
export function parseInvoiceDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === '-') return null;

  // YYYY-MM-DD (ISO)
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }

  // DD.MM.YYYY (European dots)
  const europeanDotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (europeanDotMatch) {
    return new Date(parseInt(europeanDotMatch[3]), parseInt(europeanDotMatch[2]) - 1, parseInt(europeanDotMatch[1]));
  }

  // DD/MM/YYYY with slashes
  const slashMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const first = parseInt(slashMatch[1]);
    const second = parseInt(slashMatch[2]);
    const year = parseInt(slashMatch[3]);

    if (second > 12) {
      return new Date(year, first - 1, second);
    } else {
      return new Date(year, second - 1, first);
    }
  }

  return null;
}

/**
 * Check if invoice due date is urgent (past due or within 7 days)
 */
export function isInvoiceDueDateUrgent(dateStr: string, status?: string): boolean {
  if (status === 'paid' || status === 'rejected') return false;

  const dueDate = parseInvoiceDate(dateStr);
  if (!dueDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  return diffDays < 0 || diffDays <= 7;
}
