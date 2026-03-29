/**
 * Invoice OCR Extractions Counts API Route
 * Proxies requests to backend API for invoice status counts
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);

    const queryString = params.toString();
    const url = queryString
      ? `/api/invoice-ocr/extractions/counts?${queryString}`
      : '/api/invoice-ocr/extractions/counts';

    const { data, status } = await callBackendApi(url);

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR counts API error');
    return NextResponse.json(
      {
        error: 'Failed to fetch invoice counts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
