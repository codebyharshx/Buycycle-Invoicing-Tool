# /csv-parser - Create CSV Parser for New Vendor

Create a new CSV parser for a logistics vendor's invoice format.

## Usage
```
/csv-parser <vendor-name>
```

## Instructions

When creating a CSV parser for a new vendor:

1. **Location**: Add to `backend/src/services/invoice-ocr/parsers/csv-parser.ts`

2. **Parser function pattern**:
```ts
/**
 * Parse <VENDOR> CSV invoice format
 *
 * Expected columns:
 * - Column1: Description
 * - Column2: Description
 * ...
 */
export function parse<Vendor>CSV(filePath: string): OCRLineItem[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const lineItems: OCRLineItem[] = [];

  // Skip header row if present
  const startRow = 1; // or 0 if no header

  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV (handle delimiters: comma, semicolon, tab)
    const columns = parseCSVLine(line, ','); // or ';' for European formats

    // Map columns to OCRLineItem fields
    const item: OCRLineItem = {
      shipment_number: columns[0]?.trim() || undefined,
      shipment_date: parseDate(columns[1]),
      // ... map other fields
      net_amount: parseNumber(columns[10]),
      gross_amount: parseNumber(columns[11]),
    };

    lineItems.push(item);
  }

  logger.info({ vendor: '<VENDOR>', lineItemCount: lineItems.length }, 'Parsed CSV');
  return lineItems;
}
```

3. **Add to parseLogisticsCSV switch**:
```ts
export async function parseLogisticsCSV(
  filePath: string,
  options: CSVParseOptions
): Promise<OCRLineItem[]> {
  switch (options.vendor.toLowerCase()) {
    // ... existing cases
    case '<vendor>':
      return parse<Vendor>CSV(filePath);
    default:
      throw new Error(`Unknown vendor: ${options.vendor}`);
  }
}
```

4. **Update vendor detection in index.ts**:
```ts
// In extractInvoiceData()
else if (csvBaseName.includes('<vendor>')) detectedVendor = '<Vendor>';
```

5. **Helper functions available**:
```ts
// Parse number from string (handles European format)
function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  // Handle European format: 1.234,56 -> 1234.56
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? undefined : num;
}

// Parse date from various formats
function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Handle DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD
  // Return in YYYY-MM-DD format
}

// Parse CSV line handling quoted fields
function parseCSVLine(line: string, delimiter: string): string[] {
  // Handle "quoted,fields" properly
}
```

6. **OCRLineItem fields to map**:
- `shipment_number` - Tracking/waybill number
- `shipment_date` - Date of shipment
- `booking_created_date` - Booking creation date
- `shipment_reference_1`, `shipment_reference_2` - Order references
- `product_name` - Service type
- `pieces` - Number of packages
- `weight_kg` - Weight
- `origin_country_name`, `origin_name`, `senders_postcode`
- `destination_country_name`, `destination_name`, `receivers_postcode`
- `net_amount`, `gross_amount`, `base_price`, `total_tax`
- `xc1_name`, `xc1_charge`, etc. - Extra charges

7. **Test with sample file**:
- Add sample CSV to project root for testing
- Run extraction to verify parsing
