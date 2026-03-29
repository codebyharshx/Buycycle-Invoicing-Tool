/**
 * Invoice OCR Extractions List API Route
 * Proxies requests to backend API with authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '20';
    const offset = searchParams.get('offset') || '0';
    const view = searchParams.get('view');
    const unreadOnly = searchParams.get('unread_only');
    const userId = searchParams.get('user_id');

    // Build query string with all parameters
    const params = new URLSearchParams({ limit, offset });
    if (view) params.set('view', view);
    if (unreadOnly) params.set('unread_only', unreadOnly);
    if (userId) params.set('user_id', userId);

    const { data, status } = await callBackendApi(
      `/api/invoice-ocr/extractions?${params.toString()}`
    );

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR extractions list API error');
    return NextResponse.json(
      {
        error: 'Failed to fetch invoice extractions',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
