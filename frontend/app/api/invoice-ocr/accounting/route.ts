/**
 * Invoice accounting view API route
 * Proxies consolidated monthly accounting data to backend with auth
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();

    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const vendor = searchParams.get('vendor');

    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (vendor) params.set('vendor', vendor);

    const query = params.toString() ? `?${params.toString()}` : '';
    const { data, status } = await callBackendApi(`/api/invoice-ocr/accounting${query}`);

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice accounting view API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch accounting data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
