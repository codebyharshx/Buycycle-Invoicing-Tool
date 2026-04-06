import axios, { AxiosError } from 'axios';
import { InvoiceData, ModelConfig, PartialInvoiceData } from '@shared/types';
import { fileToBase64DataUrl, normalizeInvoiceData, cleanJsonContent } from '../utils';
import { logger } from '../../../utils/logger';

/**
 * Available Qwen models on OpenRouter
 */
const MODELS: Record<string, ModelConfig> = {
  'qwen3-8b': {
    id: 'qwen/qwen3-vl-8b-instruct',
    name: 'Qwen3-VL 8B',
    emoji: '🟢',
  },
  'qwen3-30b': {
    id: 'qwen/qwen3-vl-30b-a3b-instruct',
    name: 'Qwen3-VL 30B',
    emoji: '🟠',
  },
  'qwen3-235b': {
    id: 'qwen/qwen3-vl-235b-a22b-instruct',
    name: 'Qwen3-VL 235B',
    emoji: '🔵',
  },
};

/**
 * OpenRouter Extractor for Qwen vision models
 */
export class OpenRouterExtractor {
  private apiKey: string;
  private baseUrl: string = 'https://openrouter.ai/api/v1';
  private modelId: string;
  private modelName: string;

  constructor(apiKey: string, modelKey: string) {
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required');
    }

    this.apiKey = apiKey;

    const config = MODELS[modelKey];
    if (!config) {
      throw new Error(
        `Unknown model: ${modelKey}. Available: ${Object.keys(MODELS).join(', ')}`
      );
    }

    this.modelId = config.id;
    this.modelName = config.name;
  }

  /**
   * Extract invoice data using the specified Qwen model via OpenRouter
   */
  async extract(filePath: string): Promise<InvoiceData | null> {
    logger.info({ filePath, model: this.modelName }, `Starting ${this.modelName} extraction`);

    try {
      // Get file as base64 data URL (Qwen models support PDFs natively)
      const dataUrl = await fileToBase64DataUrl(filePath);

      const schema = this.getInvoiceSchema();

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.modelId,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Extract invoice information from this document and return it as JSON matching this schema:

${JSON.stringify(schema, null, 2)}

Important:
- Extract ALL line items with their descriptions, quantities, unit prices, and totals
- Include vendor and customer information
- Extract all amounts accurately
- Return ONLY valid JSON, no markdown formatting or explanation`,
                },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            'X-OpenRouter-Data-Collection': 'none',
          },
          timeout: 90000, // 90 second timeout
        }
      );

      const content = response.data.choices[0].message.content;
      const cleaned = cleanJsonContent(content);
      const result = JSON.parse(cleaned) as PartialInvoiceData;

      logger.info({ model: this.modelName }, `${this.modelName} extraction complete`);
      return normalizeInvoiceData(result);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(
        { error: axiosError.message || 'Unknown error', model: this.modelName, filePath },
        `${this.modelName} extraction error`
      );
      if (axiosError.response?.data) {
        logger.error({ errorDetails: axiosError.response.data }, `${this.modelName} API error details`);
      }
      return null;
    }
  }

  /**
   * Get the invoice JSON schema
   */
  private getInvoiceSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        vendor: { type: 'string' },
        account_number: { type: 'string' },
        document_type: { type: 'string' },
        parent_invoice_number: { type: 'string', description: 'FOR CREDIT NOTES: Original invoice number being credited' },
        net_amount: { type: 'number' },
        vat_amount: { type: 'number' },
        vat_percentage: { type: 'number' },
        gross_amount: { type: 'number' },
        currency: { type: 'string' },
        invoice_date: { type: 'string' },
        due_date: { type: 'string' },
        performance_period_start: { type: 'string' },
        performance_period_end: { type: 'string' },
        assigned_to: { type: 'string' },
        booking_date: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
  }
}
