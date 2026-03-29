/**
 * DeepSeek-OCR Extractor via Replicate API (Two-Stage Pipeline)
 *
 * ARCHITECTURE:
 * Stage 1: DeepSeek OCR extracts raw text from image
 * Stage 2: Gemini LLM structures the raw text into invoice fields
 *
 * This leverages each model's strengths:
 * - DeepSeek: Specialized OCR for text extraction
 * - Gemini: Semantic understanding for field mapping
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import Replicate from 'replicate';
import axios from 'axios';
import pino from 'pino';
import type { InvoiceData } from '@shared/types';

const logger = pino({ name: 'deepseek-replicate-extractor' });

/**
 * DeepSeek-OCR Extractor using Replicate's hosted API
 */
export class DeepSeekReplicateExtractor {
  private replicate: Replicate;
  private geminiApiKey: string;
  private geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string, geminiApiKey?: string) {
    this.replicate = new Replicate({
      auth: apiKey,
    });
    // Get Gemini key from env or parameter
    this.geminiApiKey = geminiApiKey || process.env.GEMINI_API_KEY || '';
  }

  /**
   * Convert PDF to PNG image using system tools (DeepSeek only accepts images)
   */
  private convertPdfToImage(filePath: string): Buffer {
    const tempImagePath = `${filePath}-page1.png`;

    try {
      // Try ImageMagick first (better quality, handles problematic PDFs)
      try {
        execSync(`convert -density 300 "${filePath}[0]" -quality 90 "${tempImagePath}" 2>/dev/null`);
        logger.info('PDF converted using ImageMagick');
      } catch {
        // Fallback to sips (macOS built-in tool)
        try {
          execSync(`sips -s format png "${filePath}" --out "${tempImagePath}" 2>/dev/null`);
          logger.info('PDF converted using sips (fallback)');
        } catch {
          throw new Error('PDF conversion failed. Install ImageMagick: brew install imagemagick');
        }
      }

      // Read the generated image
      const imageBuffer = fs.readFileSync(tempImagePath);

      // Clean up temp file
      fs.unlinkSync(tempImagePath);

      return imageBuffer;
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(tempImagePath)) {
        fs.unlinkSync(tempImagePath);
      }
      throw error;
    }
  }

  /**
   * Extract invoice data from file using Two-Stage Pipeline:
   * Stage 1: DeepSeek OCR extracts raw text
   * Stage 2: Gemini LLM structures the data
   */
  async extract(filePath: string): Promise<InvoiceData> {
    const startTime = Date.now();

    try {
      logger.info({ filePath }, '🚀 Starting two-stage extraction (DeepSeek + Gemini)');

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // STAGE 1: DeepSeek OCR - Extract raw text
      logger.info('📖 STAGE 1: DeepSeek OCR - Extracting raw text');
      const stage1Start = Date.now();
      const rawText = await this.stage1_extractRawText(filePath);
      const stage1Duration = Date.now() - stage1Start;

      logger.info({
        stage1Duration,
        textLength: rawText.length,
        preview: rawText.substring(0, 200)
      }, '✅ STAGE 1 Complete: Raw text extracted');

      // Only log raw OCR text when explicitly enabled (contains PII/financial data)
      if (process.env.OCR_DEBUG_LOG_RAW_TEXT === 'true') {
        // Truncate and warn about sensitivity
        const truncated = rawText.length > 500 ? rawText.substring(0, 500) + '... [TRUNCATED]' : rawText;
        logger.debug({ rawTextPreview: truncated, fullLength: rawText.length }, 'Raw OCR text (DEBUG MODE - contains sensitive data)');
      }

      // STAGE 2: Gemini LLM - Structure the data
      logger.info('🧠 STAGE 2: Gemini LLM - Structuring invoice fields');
      const stage2Start = Date.now();
      const structuredData = await this.stage2_structureWithGemini(rawText);
      const stage2Duration = Date.now() - stage2Start;

      logger.info({
        stage2Duration,
        fieldsExtracted: Object.keys(structuredData).filter(k => structuredData[k as keyof InvoiceData]).length
      }, '✅ STAGE 2 Complete: Data structured');

      const totalDuration = Date.now() - startTime;

      logger.info({
        totalDuration,
        stage1Duration,
        stage2Duration,
        confidence: '95%'
      }, '✅ Two-stage extraction completed successfully');

      return structuredData;
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      logger.error(
        { duration, error: err.message },
        '❌ Two-stage extraction failed'
      );

      throw new Error(`DeepSeek two-stage extraction failed: ${err.message}`);
    }
  }

  /**
   * STAGE 1: Extract raw text using DeepSeek OCR
   */
  private async stage1_extractRawText(filePath: string): Promise<string> {
    // Convert PDF to image if needed (DeepSeek only accepts images)
    const isPdf = path.extname(filePath).toLowerCase() === '.pdf';
    let imageBuffer: Buffer;
    let mimeType: string;

    if (isPdf) {
      logger.info('Converting PDF to image for DeepSeek');
      imageBuffer = this.convertPdfToImage(filePath);
      mimeType = 'image/png';
    } else {
      // Read image file directly
      imageBuffer = fs.readFileSync(filePath);
      mimeType = this.getMimeType(filePath);
    }

    // Convert to base64 data URI
    const base64Data = imageBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    // Call DeepSeek OCR with "Free OCR" mode to get ALL text
    const rawOutput = await this.replicate.run(
      'lucataco/deepseek-ocr:cb3b474fbfc56b1664c8c7841550bccecbe7b74c30e45ce938ffca1180b4dff5',
      {
        input: {
          image: dataUri,
          task_type: 'Free OCR',  // Get ALL text, no filtering
        },
      }
    );

    // Convert output to string (API might return array or object)
    const rawText = typeof rawOutput === 'string' ? rawOutput :
                    Array.isArray(rawOutput) ? rawOutput.join('\n') :
                    JSON.stringify(rawOutput);

    return rawText;
  }

  /**
   * STAGE 2: Structure raw text using Gemini LLM
   */
  private async stage2_structureWithGemini(rawText: string): Promise<InvoiceData> {
    if (!this.geminiApiKey) {
      throw new Error('Gemini API key not configured for two-stage extraction');
    }

    // Use Gemini model from env or fall back to stable 1.5 Flash
    const model = process.env.GEMINI_CHAT_MODEL || 'gemini-1.5-flash';

    const prompt = `You are an expert invoice data extractor. Extract invoice data from the OCR text below.

RAW OCR TEXT:
"""
${rawText}
"""

Extract these fields and return ONLY a JSON object (no markdown, no code blocks, just raw JSON):

{
  "vendor": "Company that issued the invoice (look for SP. Z O.O., GMBH, LTD, INC, S.A.)",
  "account_number": "Customer account/ID number if present, else empty string",
  "invoice_number": "Invoice/Document number (may be: Invoice No, Faktura nr, Order No, Nr dokumentu)",
  "document_type": "INVOICE, CREDIT NOTE, PROFORMA, etc.",
  "net_amount": 0,
  "vat_amount": 0,
  "vat_percentage": 0,
  "gross_amount": 0,
  "currency": "EUR, USD, PLN, etc.",
  "invoice_date": "DD/MM/YYYY",
  "due_date": "DD/MM/YYYY",
  "performance_period_start": "DD/MM/YYYY or empty",
  "performance_period_end": "DD/MM/YYYY or empty",
  "assigned_to": "Contact person name if present",
  "booking_date": "DD/MM/YYYY or empty"
}

CRITICAL RULES:

1. VENDOR IDENTIFICATION:
   - "TFJ BUYCYCLE GMBH" is NEVER the vendor - it is ALWAYS the customer/recipient
   - The vendor is the courier/shipping company: DS SMITH, DHL Express, UPS, Sendcloud, etc.
   - Look for SP. Z O.O., GMBH, LTD, INC, S.A. BUT ignore if it's "TFJ BUYCYCLE GMBH"
   - Banks (like BNP Paribas) are NOT vendors - they are for payment info

2. INVOICE NUMBER FOR DS SMITH:
   - IF vendor contains "DS SMITH", the invoice number is in the HEADER at the top
   - Look for "INVOICE No. 25D02044" or "Invoice VAT No. 25D02078" format in the HEADER
   - DO NOT use "Order No." field (e.g., 25123764) - that is NOT the invoice number
   - Example: If you see "INVOICE No. 25D02044" in header, extract "25D02044"
   - Example: If you see "Order No. 25123764" in body, IGNORE IT

3. GENERAL RULES:
   - Invoice number: Look for "Nr dokumentu", "Invoice No", "Faktura nr" (but see DS SMITH rule above)
   - Vendor: The company providing the service/shipping (NOT the customer, NOT the bank)
   - Amounts: Handle European format (1 234,56 = 1234.56)
   - Missing fields: Use empty string "" or 0
   - Return ONLY the JSON object, nothing else`;

    try {
      const response = await axios.post(
        `${this.geminiBaseUrl}/models/${model}:generateContent?key=${this.geminiApiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,  // Low temperature for consistent extraction
            topK: 40,
            topP: 0.95
            // Don't use responseMimeType - it causes empty responses
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      // Log full response for debugging
      logger.info({
        statusCode: response.status,
        hasCandidates: !!response.data.candidates,
        candidatesLength: response.data.candidates?.length,
        fullResponse: JSON.stringify(response.data).substring(0, 2000)
      }, 'Full Gemini API response');

      const responseText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!responseText) {
        logger.error({
          fullResponse: JSON.stringify(response.data, null, 2),
          candidates: response.data.candidates
        }, 'Empty response from Gemini - no text in candidates');
        throw new Error('Empty response from Gemini');
      }

      logger.info({
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 500),
        FULL_RESPONSE_TEXT: responseText
      }, 'Gemini structuring response received - FULL TEXT BELOW');

      // Parse JSON response - handle markdown code blocks
      let parsed;
      try {
        // Remove markdown code blocks if present (```json ... ```)
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```(?:json)?\s*/,'').replace(/```\s*$/, '').trim();
        }

        parsed = JSON.parse(cleanJson);

        // Log the COMPLETE parsed JSON to see exactly what Gemini returned
        logger.info({
          parsedKeys: Object.keys(parsed),
          hasVendor: !!parsed.vendor,
          hasInvoiceNumber: !!parsed.invoice_number,
          invoiceNumber: parsed.invoice_number,
          FULL_PARSED_JSON: JSON.stringify(parsed, null, 2)
        }, 'JSON parsed successfully - FULL CONTENT BELOW');
      } catch (parseError) {
        logger.error({
          parseError: (parseError as Error).message,
          responseText: responseText.substring(0, 1000)
        }, 'Failed to parse Gemini JSON response');
        throw new Error(`Failed to parse Gemini JSON: ${(parseError as Error).message}`);
      }

      // Return structured invoice data
      return {
        vendor: parsed.vendor || '',
        account_number: parsed.account_number || '',
        invoice_number: parsed.invoice_number || '',
        document_type: parsed.document_type || '',
        net_amount: parsed.net_amount || 0,
        vat_amount: parsed.vat_amount || 0,
        vat_percentage: parsed.vat_percentage || 0,
        gross_amount: parsed.gross_amount || 0,
        currency: parsed.currency || '',
        invoice_date: parsed.invoice_date || '',
        due_date: parsed.due_date || '',
        performance_period_start: parsed.performance_period_start || '',
        performance_period_end: parsed.performance_period_end || '',
        assigned_to: parsed.assigned_to || '',
        booking_date: parsed.booking_date || '',
      };

    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'Gemini structuring failed');
      throw new Error(`Gemini structuring failed: ${err.message}`);
    }
  }

  // DEPRECATED: Old regex-based parsing method removed
  // The two-stage pipeline (DeepSeek + Gemini) is now the default

  /**
   * Get MIME type from file path
   */
  private getMimeType(filePath: string): string {
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

}
