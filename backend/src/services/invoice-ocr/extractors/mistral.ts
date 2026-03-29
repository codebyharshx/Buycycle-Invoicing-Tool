import axios, { AxiosError } from 'axios';
import { InvoiceData, PartialInvoiceData } from '@shared/types';
import { fileToBase64DataUrl, normalizeInvoiceData } from '../utils';
import { logger } from '../../../utils/logger';

/**
 * Mistral OCR Extractor
 */
export class MistralExtractor {
  private apiKey: string;
  private baseUrl: string = 'https://api.mistral.ai/v1';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Extract invoice data using Mistral OCR
   */
  async extract(filePath: string): Promise<InvoiceData | null> {
    logger.info({ filePath }, 'Starting Mistral OCR extraction');

    try {
      const dataUrl = await fileToBase64DataUrl(filePath);

      const response = await axios.post(
        `${this.baseUrl}/ocr`,
        {
          model: 'mistral-ocr-latest',
          document: {
            type: 'document_url',
            document_url: dataUrl,
          },
          document_annotation_format: {
            type: 'json_schema',
            json_schema: {
              name: 'InvoiceData',
              schema: this.getInvoiceSchema(),
            },
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 90000, // 90 second timeout
        }
      );

      if (response.data?.document_annotation) {
        const annotation = response.data.document_annotation;

        let result: PartialInvoiceData;

        // Handle different response formats
        if (typeof annotation === 'string') {
          result = JSON.parse(annotation) as PartialInvoiceData;
        } else if (typeof annotation === 'object') {
          result = annotation as PartialInvoiceData;
        } else {
          logger.warn('Mistral: Unknown annotation format');
          return null;
        }

        logger.info('Mistral extraction complete');
        return normalizeInvoiceData(result);
      }

      logger.warn('Mistral: No annotation found');
      return null;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(
        { error: axiosError.message || 'Unknown error', filePath },
        'Mistral extraction error'
      );
      if (axiosError.response?.data) {
        logger.error({ errorDetails: axiosError.response.data }, 'Mistral API error details');
      }
      return null;
    }
  }

  /**
   * Get the invoice JSON schema for Mistral OCR API
   */
  private getInvoiceSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        vendor: {
          type: 'string',
          description: 'Vendor/supplier company name',
        },
        account_number: {
          type: 'string',
          description: 'Customer number or account number (buyer\'s account ID)',
        },
        invoice_number: {
          type: 'string',
          description: 'Invoice document number (unique identifier for this invoice)',
        },
        document_type: {
          type: 'string',
          description: 'Type of document (e.g., Invoice, Credit Note, Proforma)',
        },
        net_amount: {
          type: 'number',
          description: 'Net amount before VAT/tax',
        },
        vat_amount: {
          type: 'number',
          description: 'Total VAT/tax amount',
        },
        vat_percentage: {
          type: 'number',
          description: 'VAT/tax percentage rate',
        },
        gross_amount: {
          type: 'number',
          description: 'Gross total amount including all VAT/tax',
        },
        currency: {
          type: 'string',
          description: 'Currency code (EUR, USD, GBP, etc.)',
        },
        invoice_date: {
          type: 'string',
          description: 'Date when the invoice was issued (any format)',
        },
        due_date: {
          type: 'string',
          description: 'Payment due date (any format)',
        },
        performance_period_start: {
          type: 'string',
          description: 'Start date of performance/service period (any format)',
        },
        performance_period_end: {
          type: 'string',
          description: 'End date of performance/service period (any format)',
        },
        assigned_to: {
          type: 'string',
          description: 'Person or department assigned to this invoice',
        },
        booking_date: {
          type: 'string',
          description: 'Accounting booking date (any format)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags or categories for the invoice',
        },
        line_items: {
          type: 'array',
          description: 'Line items or shipment details if the invoice contains a detailed table. Extract all rows from tables that show individual shipments, packages, or service line items. Empty array [] if no table present.',
          items: {
            type: 'object',
            properties: {
              shipment_number: { type: 'string', description: 'Tracking or shipment number' },
              shipment_date: { type: 'string', description: 'Date of shipment (any format)' },
              booking_date: { type: 'string', description: 'Booking creation date (any format)' },
              shipment_reference_1: { type: 'string', description: 'Customer reference 1' },
              shipment_reference_2: { type: 'string', description: 'Customer reference 2' },
              product_name: { type: 'string', description: 'Product or service name (e.g., ECONOMY SELECT, DPD Package)' },
              description: { type: 'string', description: 'Detailed description of the line item' },
              line_item_type: { type: 'string', description: 'Type: shipment, surcharge, credit, adjustment, fee' },
              pieces: { type: 'number', description: 'Number of pieces/packages' },
              weight_kg: { type: 'number', description: 'Weight in kilograms' },
              weight_flag: { type: 'string', description: 'Weight type flag (A/B/V/W/M)' },
              origin_country: { type: 'string', description: 'Origin country' },
              origin_city: { type: 'string', description: 'Origin city/station/location' },
              origin_postal_code: { type: 'string', description: 'Sender postal code' },
              destination_country: { type: 'string', description: 'Destination country' },
              destination_city: { type: 'string', description: 'Destination city or station' },
              destination_postal_code: { type: 'string', description: 'Destination postal code' },
              net_amount: { type: 'number', description: 'Line item net amount' },
              gross_amount: { type: 'number', description: 'Line item gross amount' },
              base_price: { type: 'number', description: 'Base price for this line' },
              total_tax: { type: 'number', description: 'Total tax/VAT for this line item' },
              total_surcharges: { type: 'number', description: 'Sum of all surcharges/extra charges' },
              total_surcharges_tax: { type: 'number', description: 'Tax on surcharges' },
              xc1_name: { type: 'string', description: 'Extra charge 1 name (e.g., Fuel Surcharge, Insurance)' },
              xc1_charge: { type: 'number', description: 'Extra charge 1 amount' },
              xc2_name: { type: 'string', description: 'Extra charge 2 name' },
              xc2_charge: { type: 'number', description: 'Extra charge 2 amount' },
              xc3_name: { type: 'string', description: 'Extra charge 3 name' },
              xc3_charge: { type: 'number', description: 'Extra charge 3 amount' },
              xc4_name: { type: 'string', description: 'Extra charge 4 name' },
              xc4_charge: { type: 'number', description: 'Extra charge 4 amount' },
              xc5_name: { type: 'string', description: 'Extra charge 5 name' },
              xc5_charge: { type: 'number', description: 'Extra charge 5 amount' },
              xc6_name: { type: 'string', description: 'Extra charge 6 name' },
              xc6_charge: { type: 'number', description: 'Extra charge 6 amount' },
              xc7_name: { type: 'string', description: 'Extra charge 7 name' },
              xc7_charge: { type: 'number', description: 'Extra charge 7 amount' },
              xc8_name: { type: 'string', description: 'Extra charge 8 name' },
              xc8_charge: { type: 'number', description: 'Extra charge 8 amount' },
              xc9_name: { type: 'string', description: 'Extra charge 9 name' },
              xc9_charge: { type: 'number', description: 'Extra charge 9 amount' },
            },
          },
        },
      },
      required: ['vendor', 'gross_amount', 'currency'],
    };
  }
}
