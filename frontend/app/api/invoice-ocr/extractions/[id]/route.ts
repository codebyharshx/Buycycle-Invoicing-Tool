/**
 * Single Invoice OCR Extraction API Route
 * Proxies single extraction requests to backend API with authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Forward query parameters (e.g., include_line_items=true)
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const url = `/api/invoice-ocr/extractions/${id}${queryString ? `?${queryString}` : ''}`;

    const { data, status } = await callBackendApi(url);

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR extraction detail API error');
    return NextResponse.json(
      {
        error: 'Failed to fetch invoice extraction',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { data, status } = await callBackendApi(`/api/invoice-ocr/extractions/${id}`, {
      method: 'PATCH',
      body,
    });
    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR extraction update API error');
    return NextResponse.json(
      { error: 'Failed to update invoice extraction', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
