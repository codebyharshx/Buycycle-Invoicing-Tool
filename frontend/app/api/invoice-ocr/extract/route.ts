/**
 * Invoice OCR Extract API Route
 * Proxies invoice file uploads to backend API with authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const API_KEY = process.env.BACKEND_API_KEY;

export async function POST(request: NextRequest) {
  try {
    // Get the form data from the request
    const formData = await request.formData();

    // Forward the form data to the backend
    const response = await fetch(`${BACKEND_API_URL}/api/invoice-ocr/extract`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY || '',
      },
      body: formData, // Forward the FormData directly
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error({ error: data }, 'Backend invoice OCR extraction failed');
      return NextResponse.json(data, { status: response.status });
    }

    logger.info({
      id: data.id,
      confidenceScore: data.extraction?.analysis?.confidence_score,
    }, 'Invoice OCR extraction successful');

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR extraction API error');
    return NextResponse.json(
      {
        error: 'Failed to extract invoice',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
