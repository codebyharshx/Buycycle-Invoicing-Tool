/**
 * Invoice analytics API route
 * Proxies dashboard aggregation to backend with auth
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const months = searchParams.get('months');

    const query = months ? `?months=${months}` : '';
    const { data, status } = await callBackendApi(`/api/invoice-ocr/analytics${query}`);

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice analytics API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch invoice analytics',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

