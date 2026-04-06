/**
 * DeepSeek-OCR Extractor
 * Calls the local Python microservice for invoice data extraction
 */

import fs from 'fs';
import path from 'path';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import pino from 'pino';
import type { InvoiceData } from '@shared/types';

const logger = pino({ name: 'deepseek-extractor' });

const DEEPSEEK_SERVICE_URL = process.env.DEEPSEEK_SERVICE_URL || 'http://localhost:8000';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_SERVICE_API_KEY;
const TIMEOUT_MS = 90000; // 90 seconds

interface DeepSeekResponse {
  success: boolean;
  data: Partial<InvoiceData>;
  raw_output: string;
}

/**
 * Extract invoice data using DeepSeek-OCR
 */
export async function extractWithDeepSeek(filePath: string): Promise<InvoiceData> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_SERVICE_API_KEY environment variable is not set');
  }

  const startTime = Date.now();

  try {
    logger.info({ filePath }, 'Starting DeepSeek-OCR extraction');

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Create form data with file
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: getContentType(filePath),
    });

    // Call DeepSeek service
    const response = await axios.post<DeepSeekResponse>(
      `${DEEPSEEK_SERVICE_URL}/extract`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'x-api-key': DEEPSEEK_API_KEY,
        },
        timeout: TIMEOUT_MS,
      }
    );

    const duration = Date.now() - startTime;

    if (!response.data.success) {
      throw new Error('DeepSeek extraction failed');
    }

    logger.info(
      {
        duration,
        dataKeys: Object.keys(response.data.data),
      },
      'DeepSeek extraction completed'
    );

    // Normalize the data to match InvoiceData interface
    const normalizedData = normalizeDeepSeekData(response.data.data);

    return normalizedData;
  } catch (error) {
    const duration = Date.now() - startTime;

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.code === 'ECONNREFUSED') {
        logger.error(
          {
            duration,
            url: DEEPSEEK_SERVICE_URL,
          },
          'DeepSeek service is not running or unreachable'
        );
        throw new Error(
          `DeepSeek service is not running at ${DEEPSEEK_SERVICE_URL}. Please start the service.`
        );
      }

      if (axiosError.response) {
        logger.error(
          {
            duration,
            status: axiosError.response.status,
            data: axiosError.response.data,
          },
          'DeepSeek API error'
        );
        throw new Error(`DeepSeek API error: ${axiosError.response.status}`);
      }

      if (axiosError.code === 'ECONNABORTED') {
        logger.error({ duration }, 'DeepSeek extraction timeout');
        throw new Error(`DeepSeek extraction timeout after ${TIMEOUT_MS}ms`);
      }
    }

    logger.error({ duration, error }, 'DeepSeek extraction failed');
    throw error;
  }
}

/**
 * Get content type based on file extension
 */
function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Normalize DeepSeek data to match InvoiceData interface
 */
function normalizeDeepSeekData(data: Partial<InvoiceData>): InvoiceData {
  return {
    vendor: data.vendor || '',
    account_number: data.account_number || '',
    invoice_number: data.invoice_number || '',
    document_type: data.document_type || '',
    parent_invoice_number: data.parent_invoice_number,
    net_amount: normalizeNumber(data.net_amount),
    vat_amount: normalizeNumber(data.vat_amount),
    vat_percentage: normalizeNumber(data.vat_percentage),
    gross_amount: normalizeNumber(data.gross_amount),
    currency: data.currency || '',
    invoice_date: data.invoice_date || '',
    due_date: data.due_date || '',
    performance_period_start: data.performance_period_start || '',
    performance_period_end: data.performance_period_end || '',
    assigned_to: data.assigned_to || '',
    booking_date: data.booking_date || '',
  };
}

/**
 * Normalize number values (handle null, undefined, strings)
 */
function normalizeNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'string') {
    // Remove currency symbols and spaces
    const cleaned = value.replace(/[^0-9.,-]/g, '');

    // Handle European format (comma as decimal separator)
    const normalized = cleaned.replace(',', '.');

    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? 0 : parsed;
  }

  return typeof value === 'number' ? value : 0;
}

/**
 * Check if DeepSeek service is healthy
 */
export async function checkDeepSeekHealth(): Promise<boolean> {
  try {
    const response = await axios.get(`${DEEPSEEK_SERVICE_URL}/health`, {
      timeout: 5000,
    });

    return response.data.status === 'healthy' && response.data.model_loaded === true;
  } catch {
    return false;
  }
}
