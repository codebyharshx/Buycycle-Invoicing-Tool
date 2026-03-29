/**
 * Invoice OCR Mark Read API Route
 * Proxies requests to backend API to mark a single invoice as read
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { data, status } = await callBackendApi(
      `/api/invoice-ocr/extractions/${id}/mark-read`,
      {
        method: 'POST',
        body,
      }
    );

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR mark-read API error');
    return NextResponse.json(
      {
        error: 'Failed to mark invoice as read',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
