import { InvoiceData } from '@shared/types';

export interface FieldValidation {
  valid: boolean;
  issues: string[];
  confidence: number; // 0.0 to 1.0
}

export interface CrossFieldValidation {
  valid: boolean;
  issues: string[];
  confidence: number;
}

/**
 * Validate a single field value
 * Returns validation result with confidence score
 */
export function validateField(field: string, value: unknown): FieldValidation {
  const validation: FieldValidation = {
    valid: true,
    issues: [],
    confidence: 1.0,
  };

  // Empty value check
  if (!value || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)) {
    validation.confidence = 0.0;
    validation.issues.push(`Empty ${field}`);
    return validation;
  }

  // Amount validations
  if (['net_amount', 'vat_amount', 'gross_amount'].includes(field)) {
    if (typeof value !== 'number') {
      validation.valid = false;
      validation.issues.push(`${field} is not a number`);
      validation.confidence = 0.0;
    } else if (value <= 0) {
      validation.confidence = 0.5;
      validation.issues.push(`${field} is zero or negative`);
    } else if (value > 1000000) {
      validation.confidence = 0.7;
      validation.issues.push(`${field} is very large (>${value})`);
    }
  }

  // VAT percentage validation
  if (field === 'vat_percentage') {
    if (typeof value !== 'number') {
      validation.valid = false;
      validation.confidence = 0.0;
      validation.issues.push('VAT percentage is not a number');
    } else if (value < 0 || value > 100) {
      validation.confidence = 0.3;
      validation.issues.push(`VAT percentage ${value}% seems wrong (should be 0-100)`);
    }
  }

  // Currency validation
  if (field === 'currency') {
    const commonCurrencies = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD'];
    if (typeof value === 'string' && !commonCurrencies.includes(value.toUpperCase())) {
      validation.confidence = 0.8;
      validation.issues.push(`Unusual currency: ${value}`);
    }
  }

  // Date validations
  if (['invoice_date', 'due_date', 'performance_period_start', 'performance_period_end', 'booking_date'].includes(field)) {
    if (typeof value === 'string') {
      const dateFormats = [
        /^\d{2}\.\d{2}\.\d{4}$/, // DD.MM.YYYY
        /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
        /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY or DD/MM/YYYY
      ];

      const isValidFormat = dateFormats.some((regex) => regex.test(value));

      if (!isValidFormat) {
        validation.confidence = 0.6;
        validation.issues.push(`${field} has unusual format: ${value}`);
      }

      // Try parsing date
      try {
        const parsed = new Date(value);
        if (isNaN(parsed.getTime())) {
          validation.confidence = 0.3;
          validation.issues.push(`${field} is not a valid date`);
        }
      } catch {
        validation.confidence = 0.3;
        validation.issues.push(`${field} cannot be parsed as date`);
      }
    }
  }

  return validation;
}

/**
 * Validate relationships between fields (cross-field validation)
 * Checks math: net + vat = gross, vat = net * vat_percentage, etc.
 */
export function validateCrossFields(data: InvoiceData): CrossFieldValidation {
  const validation: CrossFieldValidation = {
    valid: true,
    issues: [],
    confidence: 1.0,
  };

  const net = data.net_amount;
  const vat = data.vat_amount;
  const gross = data.gross_amount;
  const vat_pct = data.vat_percentage;

  // Check: net + vat = gross
  if (net && vat && gross) {
    const expectedGross = net + vat;
    const diff = Math.abs(expectedGross - gross);

    if (diff > 0.10) {
      // More than 10 cents difference
      validation.issues.push(
        `Math error: ${net.toFixed(2)} + ${vat.toFixed(2)} = ${expectedGross.toFixed(2)} ≠ ${gross.toFixed(2)}`
      );
      validation.confidence = 0.5;
    }

    // Check VAT percentage
    if (vat_pct && net > 0) {
      const expectedVat = net * (vat_pct / 100);
      const vatDiff = Math.abs(expectedVat - vat);

      if (vatDiff > 0.10) {
        validation.issues.push(
          `VAT calculation: ${net.toFixed(2)} × ${vat_pct}% = ${expectedVat.toFixed(2)} ≠ ${vat.toFixed(2)}`
        );
        validation.confidence = Math.min(validation.confidence, 0.6);
      }
    }
  }

  return validation;
}

/**
 * Calculate consistency score for a field across multiple runs
 * Returns a score from 0.0 to 1.0
 */
export function calculateFieldConsistency(values: (string | number | string[] | null | undefined)[]): number {
  // Filter out empty values
  const nonEmpty = values.filter(
    (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
  );

  if (nonEmpty.length === 0) {
    return 0.0;
  }

  // Convert all values to strings for comparison
  const stringValues = nonEmpty.map((v) => {
    if (Array.isArray(v)) {
      return JSON.stringify(v.sort());
    }
    return String(v);
  });

  // Count unique values
  const uniqueValues = new Set(stringValues);

  if (uniqueValues.size === 1) {
    return 1.0; // All runs agree - perfect consistency
  }

  // Calculate most common value frequency
  const valueCounts = new Map<string, number>();
  for (const val of stringValues) {
    valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
  }

  const maxCount = Math.max(...valueCounts.values());
  return maxCount / stringValues.length; // Partial agreement
}
