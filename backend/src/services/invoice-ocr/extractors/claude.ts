import axios, { AxiosError } from 'axios';
import { readFileSync } from 'fs';
import { InvoiceData, PartialInvoiceData } from '@shared/types';
import { normalizeInvoiceData, cleanJsonContent } from '../utils';
import { logger } from '../../../utils/logger';
import { extname, basename } from 'path';

/**
 * Claude 3.7 Sonnet Extractor via OpenRouter
 */
export class ClaudeExtractor {
  private apiKey: string;
  private baseUrl: string = 'https://openrouter.ai/api/v1';
  private model: string;

  constructor(apiKey: string, model: string = 'anthropic/claude-3.7-sonnet') {
    if (!apiKey) {
      throw new Error('OpenRouter API key is required');
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Extract invoice data using Claude via OpenRouter with native PDF support
   */
  async extract(filePath: string): Promise<InvoiceData | null> {
    logger.info({ filePath, model: this.model }, 'Starting Claude extraction');

    try {
      const ext = extname(filePath).toLowerCase();

      // Build content array based on file type
      let content: Array<{ type: string; text?: string; file?: { filename: string; file_data: string }; image_url?: { url: string } }>;

      if (ext === '.pdf') {
        // Use native PDF support via OpenRouter - much faster!
        const fileBuffer = readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');
        const filename = basename(filePath);

        content = [
          {
            type: 'text',
            text: this.getExtractionPrompt(),
          },
          {
            type: 'file',
            file: {
              filename,
              file_data: `data:application/pdf;base64,${base64Data}`,
            },
          },
        ];
      } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        // For images, read directly and encode
        const fileBuffer = readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');
        const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

        content = [
          {
            type: 'text',
            text: this.getExtractionPrompt(),
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mediaType};base64,${base64Data}`,
            },
          },
        ];
      } else {
        logger.warn({ filePath }, 'Unsupported file type for Claude');
        return null;
      }

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'user',
              content,
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://buycycle.com',
            'X-Title': 'Buycycle Support Hub',
            'X-OpenRouter-Data-Collection': 'none',
          },
          timeout: 90000, // 90 second timeout
        }
      );

      if (response.data?.choices?.[0]?.message?.content) {
        const textContent = response.data.choices[0].message.content;

        // Clean and parse JSON (Claude may wrap in markdown)
        const cleanedJson = cleanJsonContent(textContent);
        const result = JSON.parse(cleanedJson) as PartialInvoiceData;

        logger.info({ model: this.model }, 'Claude extraction complete');
        return normalizeInvoiceData(result);
      }

      logger.warn({ model: this.model }, 'Claude: No result found in response');
      return null;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(
        {
          error: axiosError.message || 'Unknown error',
          filePath,
          model: this.model,
        },
        'Claude extraction error'
      );
      if (axiosError.response?.data) {
        logger.error(
          { errorDetails: axiosError.response.data },
          'Claude API error details'
        );
      }
      return null;
    }
  }

  /**
   * Get extraction prompt for Claude
   */
  private getExtractionPrompt(): string {
    return `You are an expert invoice data extraction assistant. Extract all relevant information from this invoice document and return it as valid JSON.

Extract the following fields and return ONLY a JSON object (no markdown, no code blocks, just pure JSON):

{
  "vendor": "Company name of the vendor/supplier (string)",
  "account_number": "Invoice number or account number (string)",
  "document_type": "Type of document: Invoice, Credit Note, Proforma, etc. (string)",
  "net_amount": "Net amount before VAT/tax (number)",
  "vat_amount": "Total VAT/tax amount (number)",
  "vat_percentage": "VAT/tax percentage rate (number)",
  "gross_amount": "Gross total including all VAT/tax (number)",
  "currency": "Currency code like EUR, USD, GBP (string)",
  "invoice_date": "Date when invoice was issued (string, any format)",
  "due_date": "Payment due date (string, any format)",
  "performance_period_start": "Start of service period (string, any format)",
  "performance_period_end": "End of service period (string, any format)",
  "assigned_to": "Person or department assigned to this invoice (string)",
  "booking_date": "Accounting booking date (string, any format)",
  "tags": ["array", "of", "relevant", "tags"]
}

Rules:
- Return ONLY valid JSON, no explanations, no markdown code blocks
- Use empty string "" for missing string fields
- Use 0 for missing number fields
- Use [] for missing tags array
- Ensure all number fields are actual numbers, not strings
- Extract exact values from the document
- Be precise with amounts and dates

Return the JSON now:`;
  }
}
