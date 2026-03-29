/**
 * Invoice OCR Mark All Read API Route
 * Proxies requests to backend API to mark all invoices as read
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { data, status } = await callBackendApi(
      '/api/invoice-ocr/extractions/mark-all-read',
      {
        method: 'POST',
        body,
      }
    );

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR mark-all-read API error');
    return NextResponse.json(
      {
        error: 'Failed to mark invoices as read',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
