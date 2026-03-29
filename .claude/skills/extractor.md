# /extractor - Create AI Model Extractor

Create a new AI model extractor for invoice OCR.

## Usage
```
/extractor <model-name>
```

## Instructions

When creating a new AI model extractor:

1. **Location**: `backend/src/services/invoice-ocr/extractors/<model-name>.ts`

2. **Extractor class pattern**:
```ts
import { readFileSync } from 'fs';
import { InvoiceData, OCRLineItem } from '@shared/types';
import { logger } from '../../../utils/logger';

/**
 * <ModelName> Extractor
 * Uses <Model Provider> API for invoice data extraction
 */
export class <ModelName>Extractor {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Extract invoice data from a PDF or image file
   */
  async extract(filePath: string): Promise<InvoiceData | null> {
    const startTime = Date.now();

    logger.info({ filePath, model: '<model-name>' }, 'Starting extraction');

    try {
      // Read file and convert to base64 if needed
      const fileBuffer = readFileSync(filePath);
      const base64 = fileBuffer.toString('base64');
      const mimeType = filePath.endsWith('.pdf') ? 'application/pdf' : 'image/png';

      // Call the AI API
      const response = await this.callApi(base64, mimeType);

      // Parse the response
      const data = this.parseResponse(response);

      const duration = Date.now() - startTime;
      logger.info({
        filePath,
        model: '<model-name>',
        duration: `${duration}ms`,
        hasLineItems: !!data?.line_items?.length
      }, 'Extraction complete');

      return data;
    } catch (error) {
      logger.error({
        error: (error as Error).message,
        filePath,
        model: '<model-name>'
      }, 'Extraction failed');
      return null;
    }
  }

  private async callApi(base64: string, mimeType: string): Promise<unknown> {
    // Implement API call to the model provider
    // Return raw API response
  }

  private parseResponse(response: unknown): InvoiceData | null {
    // Parse the model's response into InvoiceData format
    // Handle different response formats
  }
}
```

3. **Extraction prompt pattern**:
```
Extract the following fields from this invoice document as JSON:
{
  "vendor": "Company name issuing the invoice",
  "account_nr": "Customer account number",
  "invoice_number": "Invoice document number",
  "document_type": "shipping_invoice|credit_note|surcharge_invoice|correction|proforma",
  "net_amount": number,
  "vat_amount": number,
  "vat_percentage": number,
  "gross_invoice_amt": number,
  "currency": "EUR|USD|GBP",
  "issued_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "performance_period_start": "YYYY-MM-DD",
  "performance_period_end": "YYYY-MM-DD",
  "line_items": [
    {
      "shipment_number": "tracking number",
      "shipment_date": "YYYY-MM-DD",
      "product_name": "service type",
      "net_amount": number,
      ...
    }
  ]
}

Return ONLY valid JSON, no markdown formatting.
```

4. **Register in index.ts**:
```ts
import { <ModelName>Extractor } from './extractors/<model-name>';

// In extractWithMultipleModels():
} else if (modelName === '<model-name>') {
  if (!config.<modelKey>ApiKey) {
    logger.warn('<Model> API key not provided, skipping');
    break;
  }
  const extractor = new <ModelName>Extractor(config.<modelKey>ApiKey);
  data = await extractor.extract(filePath);
}
```

5. **Update types**:
- Add to `ModelName` type in `shared/types/src/invoice-ocr.ts`
- Add API key to `ExtractionConfig` interface

6. **Environment variable**:
- Add `<MODEL>_API_KEY` to backend .env
- Document in CLAUDE.md

7. **Testing**:
- Test with various invoice formats
- Verify JSON parsing handles edge cases
- Check line item extraction accuracy
