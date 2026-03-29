/**
 * Invoice CSV Export Utilities
 *
 * OVERVIEW:
 * This module handles CSV export of invoice OCR extraction data with intelligent
 * field selection based on AI model consensus and manual approval status.
 *
 * KEY CONCEPTS:
 * 1. **Green Fields (3/3 consensus)**: All 3 AI models agree on the value
 *    - Stored in: invoice.consensus_data
 *    - NOT in: invoice.conflicts_data
 *    - High confidence, safe to export
 *
 * 2. **Yellow/Red Fields (conflicts)**: AI models disagree
 *    - Stored in: invoice.conflicts_data with a _final_value (best guess)
 *    - Lower confidence, only exported for approved invoices
 *
 * 3. **Approved Invoices (status = "approved")**:
 *    - Human has reviewed and approved the extraction
 *    - Exports ALL fields (green + yellow/red with _final_value)
 *
 * 4. **Pending Invoices (status = "pending")**:
 *    - Not yet reviewed by human
 *    - ONLY exports green fields (3/3 consensus)
 *    - Yellow/red fields appear as empty cells in CSV
 *
 * EXPORT BEHAVIOR:
 * - User selects which columns to include in export dialog
 * - Selected columns ALWAYS appear in CSV (never hidden)
 * - Cells are empty if that invoice doesn't have a valid value for that field
 * - All 20 available fields are pre-selected by default
 */

import type { InvoiceExtractionRecord } from '@shared/types';
import { getInvoiceField } from './invoice-field-compat';

/**
 * Field definition for CSV export
 *
 * Each field has:
 * - key: Database field name (e.g., 'vendor', 'account_nr')
 * - label: Human-readable CSV column header (e.g., 'Vendor/Supplier')
 * - category: Grouping for UI organization
 * - description: Help text shown in export dialog
 * - isApproved: Function that checks if this field can be exported for a given invoice
 */
export interface ExportField {
  key: string;
  label: string;
  category: 'core' | 'dates' | 'amounts' | 'metadata' | 'system';
  description: string;
  isApproved: (invoice: InvoiceExtractionRecord) => boolean;
}

/**
 * Get value for export from invoice data
 *
 * DATA SOURCES (in priority order):
 * 1. consensus_data - Fields where all 3 AI models agreed (GREEN)
 * 2. conflicts_data._final_value - Best guess when models disagreed (YELLOW/RED)
 *    - Only used for approved invoices
 *
 * EXAMPLES:
 * - Field 'vendor' in consensus_data: "DS Smith" → returns "DS Smith"
 * - Field 'vendor' in conflicts_data with _final_value: "DS SMITH POLSKA"
 *   - If invoice approved → returns "DS SMITH POLSKA"
 *   - If invoice pending → returns null (empty cell in CSV)
 *
 * @param invoice - The invoice extraction record
 * @param field - Field key (e.g., 'vendor', 'account_nr', 'issued_date')
 * @returns The field value, or null if not available/not exportable
 */
function getConsensusValue(
  invoice: InvoiceExtractionRecord,
  field: string
): string | number | string[] | null {
  // PRIORITY 1: Check consensus_data first (always preferred, highest confidence)
  // This contains fields where all 3 AI models agreed on the same value
  // Use compat helper for backward compatibility with old field names
  const consensusValue = getInvoiceField(invoice.consensus_data, field, null);
  if (consensusValue !== null && consensusValue !== undefined) {
    return consensusValue as string | number | string[];
  }

  // PRIORITY 2: For approved invoices, fall back to conflicts_data._final_value
  // This is the system's best guess when models disagreed
  // Only do this if the invoice has been manually approved by a human
  if (invoice.status === 'approved' && invoice.conflicts_data) {
    const conflictValue = getInvoiceField(invoice.conflicts_data as Record<string, unknown>, field, null);
    if (conflictValue && typeof conflictValue === 'object' && '_final_value' in (conflictValue as Record<string, unknown>)) {
      return (conflictValue as Record<string, unknown>)._final_value as string | number | string[] ?? null;
    }
  }

  // Field not found or not exportable for this invoice
  return null;
}

/**
 * Check if a field should be exported for a given invoice
 *
 * This is the CORE LOGIC that determines what data gets exported.
 *
 * DECISION TREE:
 *
 * ┌─ Is invoice status = "approved"? (human reviewed)
 * │
 * ├─ YES → Export ALL fields (green + yellow/red)
 * │   ├─ Try consensus_data first (green fields)
 * │   └─ Fall back to conflicts_data._final_value (yellow/red fields)
 * │
 * └─ NO (pending/on_hold/rejected) → Export ONLY green fields
 *     ├─ Must be in consensus_data
 *     ├─ Must NOT be in conflicts_data (no model disagreement)
 *     ├─ Must NOT be in review_needed (no flagged issues)
 *     └─ Must have a non-empty value
 *
 * EXAMPLES:
 *
 * Example 1: Vendor field with conflict (models disagree)
 * - Pending invoice → Returns false (empty cell in CSV)
 * - Approved invoice → Returns true (exports _final_value)
 *
 * Example 2: Invoice number with 3/3 consensus
 * - Pending invoice → Returns true (exports consensus value)
 * - Approved invoice → Returns true (exports consensus value)
 *
 * Example 3: Empty booking date
 * - Any invoice → Returns false (empty cell in CSV)
 *
 * @param invoice - The invoice extraction record
 * @param field - Field key to check (e.g., 'vendor', 'account_nr')
 * @returns true if field should be exported for this invoice, false if cell should be empty
 */
function isFieldApproved(invoice: InvoiceExtractionRecord, field: string): boolean {
  // ========================================
  // PATH 1: APPROVED INVOICES (status = "approved")
  // Export ALL fields - green AND yellow/red conflicts
  // ========================================
  if (invoice.status === 'approved') {
    // Try consensus_data first (green fields - highest confidence)
    // Use compat helper for backward compatibility with old field names
    const consensusValue = getInvoiceField(invoice.consensus_data, field, null);
    if (consensusValue !== null && consensusValue !== undefined && consensusValue !== '') {
      return true;
    }

    // Fall back to conflicts_data._final_value (yellow/red fields)
    // This is the system's best guess when AI models disagreed
    if (invoice.conflicts_data) {
      const conflictValue = getInvoiceField(invoice.conflicts_data as Record<string, unknown>, field, null);
      if (conflictValue && typeof conflictValue === 'object' && '_final_value' in (conflictValue as Record<string, unknown>)) {
        const finalValue = (conflictValue as Record<string, unknown>)._final_value;
        // Only export if _final_value is not null/undefined/empty
        return finalValue !== null && finalValue !== undefined && finalValue !== '';
      }
    }

    // Field doesn't exist anywhere, return false (empty cell)
    return false;
  }

  // ========================================
  // PATH 2: NON-APPROVED INVOICES (status = pending/on_hold/rejected)
  // Export ONLY green fields (pure 3/3 consensus)
  // ========================================

  // CHECK 1: Field must exist in consensus_data (with compat helper for old field names)
  const value = getInvoiceField(invoice.consensus_data, field, null);
  if (value === null || value === undefined || value === '') {
    return false; // Not in consensus or empty → empty cell
  }

  // CHECK 3: Field must NOT be in conflicts_data
  // If it's in conflicts_data, it means models disagreed (not pure consensus)
  const conflictValue = getInvoiceField(invoice.conflicts_data as Record<string, unknown>, field, null);
  if (conflictValue !== null) {
    return false; // Has conflict → not green → empty cell for pending invoices
  }

  // CHECK 4: Field must NOT be flagged in review_needed
  // review_needed contains fields that failed validation or have low confidence
  const needsReview = invoice.review_needed && invoice.review_needed.some(
    (item: string) => item.toLowerCase().includes(field.toLowerCase())
  );
  if (needsReview) {
    return false; // Needs review → not safe → empty cell
  }

  // All checks passed - this is a clean green field, safe to export
  return true;
}

/**
 * All available fields for export
 */
export const AVAILABLE_EXPORT_FIELDS: ExportField[] = [
  // Core invoice fields
  {
    key: 'vendor',
    label: 'Vendor/Supplier',
    category: 'core',
    description: 'Company or individual providing goods/services',
    isApproved: (inv) => isFieldApproved(inv, 'vendor'),
  },
  {
    key: 'account_number',
    label: 'Account Number',
    category: 'core',
    description: 'Customer account number',
    isApproved: (inv) => isFieldApproved(inv, 'account_number'),
  },
  {
    key: 'document_type',
    label: 'Document Type',
    category: 'core',
    description: 'Type of document (Standard Invoice, Credit Note, etc.)',
    isApproved: (inv) => isFieldApproved(inv, 'document_type'),
  },

  // Date fields
  {
    key: 'invoice_date',
    label: 'Invoice Date',
    category: 'dates',
    description: 'Date invoice was issued',
    isApproved: (inv) => isFieldApproved(inv, 'invoice_date'),
  },
  {
    key: 'due_date',
    label: 'Due Date',
    category: 'dates',
    description: 'Payment due date',
    isApproved: (inv) => isFieldApproved(inv, 'due_date'),
  },
  {
    key: 'booking_date',
    label: 'Booking Date',
    category: 'dates',
    description: 'Accounting booking date',
    isApproved: (inv) => isFieldApproved(inv, 'booking_date'),
  },
  {
    key: 'performance_period_start',
    label: 'Service Period Start',
    category: 'dates',
    description: 'Start of service delivery period',
    isApproved: (inv) => isFieldApproved(inv, 'performance_period_start'),
  },
  {
    key: 'performance_period_end',
    label: 'Service Period End',
    category: 'dates',
    description: 'End of service delivery period',
    isApproved: (inv) => isFieldApproved(inv, 'performance_period_end'),
  },

  // Amount fields
  {
    key: 'net_amount',
    label: 'Net Amount',
    category: 'amounts',
    description: 'Amount before VAT/taxes',
    isApproved: (inv) => isFieldApproved(inv, 'net_amount'),
  },
  {
    key: 'vat_amount',
    label: 'VAT Amount',
    category: 'amounts',
    description: 'Tax/VAT amount',
    isApproved: (inv) => isFieldApproved(inv, 'vat_amount'),
  },
  {
    key: 'vat_percentage',
    label: 'VAT Rate (%)',
    category: 'amounts',
    description: 'Tax rate percentage',
    isApproved: (inv) => isFieldApproved(inv, 'vat_percentage'),
  },
  {
    key: 'gross_amount',
    label: 'Total Amount',
    category: 'amounts',
    description: 'Total amount including VAT',
    isApproved: (inv) => isFieldApproved(inv, 'gross_amount'),
  },
  {
    key: 'currency',
    label: 'Currency',
    category: 'amounts',
    description: 'Currency code (EUR, USD, GBP, etc.)',
    isApproved: (inv) => isFieldApproved(inv, 'currency'),
  },

  // Metadata fields
  {
    key: 'assigned_to',
    label: 'Assigned To',
    category: 'metadata',
    description: 'Person or team assigned',
    isApproved: (inv) => isFieldApproved(inv, 'assigned_to'),
  },
  {
    key: 'tags',
    label: 'Tags',
    category: 'metadata',
    description: 'Classification tags',
    isApproved: (inv) => isFieldApproved(inv, 'tags'),
  },
  {
    key: 'notes',
    label: 'Notes',
    category: 'metadata',
    description: 'Internal team notes',
    isApproved: () => true,
  },

  // System fields (always available)
  {
    key: 'status',
    label: 'Status',
    category: 'system',
    description: 'Invoice processing status',
    isApproved: () => true, // Always available
  },
  {
    key: 'confidence_score',
    label: 'Confidence Score',
    category: 'system',
    description: 'AI extraction confidence (0-100)',
    isApproved: () => true, // Always available
  },
  {
    key: 'file_name',
    label: 'File Name',
    category: 'system',
    description: 'Original uploaded file name',
    isApproved: () => true, // Always available
  },
  {
    key: 'created_at',
    label: 'Upload Date',
    category: 'system',
    description: 'Date uploaded to system',
    isApproved: () => true, // Always available
  },
  {
    key: 'models_used',
    label: 'AI Models Used',
    category: 'system',
    description: 'Models used for extraction',
    isApproved: () => true, // Always available
  },
];

/**
 * Format a field value for CSV export
 *
 * Converts raw invoice data into CSV-safe string format.
 * Handles different data types and special formatting requirements.
 *
 * FIELD TYPES HANDLED:
 * 1. System fields - Always available, from invoice root properties
 * 2. Data fields - From consensus_data or conflicts_data._final_value
 *
 * DATA TYPE CONVERSIONS:
 * - Arrays (tags, models) → "item1; item2; item3" (semicolon-separated)
 * - Numbers → "123.45" (string representation)
 * - Dates → "2025-10-23" (ISO date only, no time)
 * - Strings → Clean string (quotes removed)
 * - null/undefined → "" (empty string for empty cells)
 *
 * WHY SEMICOLONS FOR ARRAYS?
 * - CSV uses commas as field delimiters
 * - Using commas in array values would break CSV parsing
 * - Semicolons allow "model1; model2; model3" in a single cell
 *
 * @param invoice - The invoice extraction record
 * @param fieldKey - Field key to format (e.g., 'vendor', 'tags', 'status')
 * @returns Formatted string value ready for CSV (empty string if no value)
 */
function formatFieldValue(
  invoice: InvoiceExtractionRecord,
  fieldKey: string,
  notesMap?: Map<number, string>
): string {
  // ========================================
  // NOTES FIELD (from threads system, passed via notesMap)
  // ========================================
  if (fieldKey === 'notes') {
    return notesMap?.get(invoice.id) || '';
  }

  // ========================================
  // SYSTEM FIELDS (from invoice root properties)
  // These are always available regardless of AI consensus
  // ========================================

  if (fieldKey === 'status') {
    // Invoice approval status: pending, approved, on_hold, rejected
    return invoice.status;
  }

  if (fieldKey === 'confidence_score') {
    // Overall extraction confidence: 0.0 to 100.0
    // Format to 1 decimal place: 73.2
    return invoice.confidence_score.toFixed(1);
  }

  if (fieldKey === 'file_name') {
    // Original uploaded filename: "invoice_2024.pdf"
    return invoice.file_name;
  }

  if (fieldKey === 'created_at') {
    // Upload timestamp → Convert to ISO date only (no time)
    // "2025-10-23T12:33:55Z" → "2025-10-23"
    return new Date(invoice.created_at).toISOString().split('T')[0];
  }

  if (fieldKey === 'models_used') {
    // Array of AI model names: ["mistral", "gemini", "claude"]
    // Convert to: "mistral; gemini; claude"
    // Strip quotes in case model names have them
    return invoice.models_used.map(m => m.replace(/['"]/g, '')).join('; ');
  }

  // ========================================
  // DATA FIELDS (from consensus_data or conflicts_data)
  // Retrieved via getConsensusValue() which handles approval logic
  // ========================================

  const value = getConsensusValue(invoice, fieldKey);

  // If no value available (field not approved or doesn't exist)
  // Return empty string → Creates empty cell in CSV
  if (value === null || value === undefined) {
    return '';
  }

  // ARRAY VALUES (e.g., tags: ["shipping", "urgent"])
  // Convert to semicolon-separated string: "shipping; urgent"
  // Why? Commas would break CSV parsing
  if (Array.isArray(value)) {
    return value
      .map(v => String(v).replace(/['"]/g, '')) // Remove quotes from each item
      .join('; '); // Join with semicolons
  }

  // NUMBER VALUES (e.g., gross_invoice_amt: 4282.47)
  // Convert to string: "4282.47"
  if (typeof value === 'number') {
    return value.toString();
  }

  // STRING VALUES (e.g., vendor: "DS Smith")
  // Remove quotes to prevent CSV escaping issues
  // Quotes will be re-added by escapeCsvValue() if needed
  return String(value).replace(/"/g, '');
}

/**
 * Escape CSV value according to RFC 4180 standard
 *
 * RFC 4180 is the official CSV specification that defines how CSV files should be formatted.
 * This function ensures values are properly escaped for safe CSV export.
 *
 * RFC 4180 RULES:
 * 1. Fields containing commas MUST be wrapped in double quotes
 * 2. Fields containing double quotes MUST be wrapped in double quotes
 * 3. Fields containing newlines MUST be wrapped in double quotes
 * 4. Double quotes inside quoted fields MUST be escaped by doubling them
 *
 * EXAMPLES:
 * - "Hello World" → Hello World (no special chars, no quotes needed)
 * - "Hello, World" → "Hello, World" (contains comma, needs quotes)
 * - 'Say "Hi"' → "Say ""Hi""" (contains quotes, escape by doubling)
 * - "Line1\nLine2" → "Line1\nLine2" (contains newline, needs quotes)
 * - "  Space  " → Space (whitespace trimmed)
 *
 * WHY THIS MATTERS:
 * - Without proper escaping, commas in values break column alignment
 * - Unescaped quotes can corrupt the CSV structure
 * - Newlines in values can create extra rows
 * - Excel, Google Sheets, and other tools expect RFC 4180 compliance
 *
 * @param value - Raw string value to escape
 * @returns RFC 4180 compliant escaped value
 */
function escapeCsvValue(value: string): string {
  // STEP 1: Trim leading/trailing whitespace
  // Why? Prevents "  value  " from appearing with extra spaces in CSV
  const trimmed = value.trim();

  // STEP 2: Check if value needs quoting
  // A value needs quotes if it contains ANY of these special characters:
  // - Comma (,) - Would be interpreted as column separator
  // - Quote (") - Would break CSV structure
  // - Newline (\n or \r) - Would create extra rows
  const needsQuoting =
    trimmed.includes(',') ||
    trimmed.includes('"') ||
    trimmed.includes('\n') ||
    trimmed.includes('\r');

  if (needsQuoting) {
    // STEP 3: Escape internal quotes by doubling them
    // Example: Say "Hi" → Say ""Hi""
    // Why? RFC 4180 requires this to represent literal quotes inside quoted fields
    const escaped = trimmed.replace(/"/g, '""');

    // STEP 4: Wrap in quotes
    // Example: Say ""Hi"" → "Say ""Hi"""
    return `"${escaped}"`;
  }

  // No special characters, return as-is
  return trimmed;
}

/**
 * Generate CSV content from invoices and selected fields
 *
 * This is the MAIN EXPORT FUNCTION that orchestrates the entire CSV generation process.
 *
 * PROCESS FLOW:
 * 1. Filter field definitions to only include selected fields
 * 2. Generate header row from field labels
 * 3. Generate data rows for each invoice
 * 4. Combine into final CSV string
 *
 * CSV STRUCTURE:
 * ```
 * Vendor/Supplier,Invoice Number,Issue Date,Due Date,Total Amount
 * DS Smith,INV-001,2025-01-15,2025-02-15,1250.00
 * ,INV-002,2025-01-16,2025-02-16,890.50
 * Wiechert,INV-003,2025-01-17,2025-02-17,2100.00
 * ```
 *
 * EMPTY CELLS:
 * - If a field isn't approved for an invoice → empty cell (e.g., vendor in row 2)
 * - Column still appears, just that specific cell is empty
 * - This allows partial data export while maintaining column structure
 *
 * DEBUGGING:
 * - Check browser console for detailed [CSV Export] logs
 * - Shows which fields are being exported
 * - Shows raw values vs escaped values
 * - Shows preview of generated CSV
 *
 * @param invoices - Array of invoice extraction records to export
 * @param selectedFieldKeys - Array of field keys user chose to export (e.g., ['vendor', 'account_nr'])
 * @returns Complete CSV content as string, ready for download
 */
export function generateCsv(
  invoices: InvoiceExtractionRecord[],
  selectedFieldKeys: string[],
  notesMap?: Map<number, string>
): string {
  // ========================================
  // STEP 1: Filter field definitions
  // Only include fields that user selected in export dialog
  // ========================================
  const fields = AVAILABLE_EXPORT_FIELDS.filter((f) =>
    selectedFieldKeys.includes(f.key)
  );


  // ========================================
  // STEP 2: Generate header row
  // Convert field labels to clean column headers
  // ========================================
  const headerRow = fields.map((f) => {
    // Clean up any irregular whitespace in labels
    // "Invoice    Number" → "Invoice Number"
    // Why? Prevents tabs/extra spaces in CSV headers
    const cleanLabel = f.label.replace(/\s+/g, ' ').trim();

    return cleanLabel;
  }).join(','); // Join headers with commas

  // ========================================
  // STEP 3: Generate data rows
  // One row per invoice, with cells matching header columns
  // ========================================
  const dataRows = invoices.map((invoice) => {
    // Generate cells for this invoice
    const cells = fields.map((field) => {
      // Get raw value (might be empty string if not approved)
      const rawValue = formatFieldValue(invoice, field.key, notesMap);

      // Escape for CSV (add quotes if needed)
      const escapedValue = escapeCsvValue(rawValue);

      return escapedValue;
    });

    // Join cells with commas to create row
    return cells.join(',');
  });

  // ========================================
  // STEP 4: Combine header and data rows
  // ========================================
  // [headerRow, ...dataRows] creates array: [header, row1, row2, row3, ...]
  // .join('\n') combines with newlines to create CSV text
  const csv = [headerRow, ...dataRows].join('\n');

  return csv;
}

/**
 * Download CSV file to user's computer
 *
 * Uses browser's Blob API and download link trick to trigger file download.
 * This is a client-side download - no server involved.
 *
 * HOW IT WORKS:
 * 1. Create a Blob (Binary Large Object) from CSV string
 * 2. Generate a temporary URL pointing to that Blob
 * 3. Create an invisible <a> link with download attribute
 * 4. Programmatically click the link to trigger download
 * 5. Clean up: remove link and revoke URL
 *
 * WHY THIS APPROACH?
 * - Works entirely in browser (no server needed)
 * - Supports large CSVs (Blob can handle big files)
 * - Download attribute forces download instead of navigation
 * - URL.revokeObjectURL() prevents memory leaks
 *
 * @param csvContent - Complete CSV text content
 * @param fileName - Desired filename (e.g., "invoices_export_2025-10-23.csv")
 */
export function downloadCsv(csvContent: string, fileName: string): void {
  // STEP 1: Create Blob with CSV content
  // Blob = raw data container, type tells browser it's a CSV file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  // STEP 2: Create temporary URL pointing to Blob
  // This URL looks like: blob:http://localhost:3000/abc-123-def
  const url = URL.createObjectURL(blob);

  // STEP 3: Create invisible download link
  const link = document.createElement('a');
  link.setAttribute('href', url); // Point to Blob URL
  link.setAttribute('download', fileName); // Force download with this filename
  link.style.visibility = 'hidden'; // Don't show link to user

  // STEP 4: Trigger download
  document.body.appendChild(link); // Add link to page (required for Firefox)
  link.click(); // Programmatically click to start download

  // STEP 5: Clean up
  document.body.removeChild(link); // Remove link from page
  URL.revokeObjectURL(url); // Free up memory (Blob URL no longer needed)
}

/**
 * Get available fields for export
 *
 * Returns ALL 20 defined fields for the export dialog.
 * User can select any field they want to include in the CSV.
 *
 * IMPORTANT BEHAVIOR:
 * - ALL fields are always available for selection
 * - If a specific invoice doesn't have a green value for a field → empty cell in CSV
 * - Columns ALWAYS appear if selected, regardless of data availability
 *
 * WHY RETURN ALL FIELDS?
 * - Lets user choose their export format
 * - Maintains consistent column structure across exports
 * - Empty cells clearly show missing/unapproved data
 *
 * FIELD CATEGORIES (20 total):
 * - Core: 3 fields (vendor, invoice number, document type)
 * - Dates: 5 fields (issued, due, booking, service period start/end)
 * - Amounts: 5 fields (net, VAT, VAT %, total, currency)
 * - Metadata: 2 fields (assigned to, tags)
 * - System: 5 fields (status, confidence, filename, upload date, models)
 *
 * @returns All 20 available field definitions
 */
export function getAvailableFieldsForInvoices(): ExportField[] {
  // Return ALL 20 fields defined in AVAILABLE_EXPORT_FIELDS
  // User can choose which to include via export dialog checkboxes
  // If a field doesn't have approved data for some invoices, those cells will be empty
  return AVAILABLE_EXPORT_FIELDS;
}

/**
 * Get default selected fields for export dialog
 *
 * When user opens export dialog, which fields should be pre-checked?
 * Answer: ALL of them!
 *
 * REASONING:
 * - User wanted to export, likely wants all available data
 * - Easier to uncheck unwanted fields than check 20 boxes
 * - "Select All" by default, "Clear All" available for customization
 *
 * USER WORKFLOW:
 * 1. User clicks "Export CSV" button
 * 2. Dialog opens with ALL fields pre-selected (checked)
 * 3. User can uncheck fields they don't want
 * 4. User clicks "Export CSV" to download
 *
 * ALTERNATIVE CONSIDERED:
 * - Pre-selecting only "important" fields (vendor, amount, dates)
 * - Rejected because it requires user to know all field names
 * - Current approach: show everything, let user remove what they don't need
 *
 * @returns Array of all field keys (e.g., ['vendor', 'account_nr', 'issued_date', ...])
 */
export function getDefaultSelectedFields(): string[] {
  // Get all available fields (currently returns all 20)
  const availableFields = getAvailableFieldsForInvoices();

  // Extract just the field keys (e.g., 'vendor', 'account_nr')
  // These keys will be used to pre-check the checkboxes in export dialog
  return availableFields.map(f => f.key);
}
