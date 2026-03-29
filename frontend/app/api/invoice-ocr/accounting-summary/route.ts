/**
 * Accounting Summary API Route
 * Proxies to backend for monthly line items aggregation
 */

import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const { data, status } = await callBackendApi('/api/invoice-ocr/accounting-summary');
    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error : String(error) }, 'Accounting summary API error');
    return NextResponse.json(
      { error: 'Failed to fetch accounting summary' },
      { status: 500 }
    );
  }
}
