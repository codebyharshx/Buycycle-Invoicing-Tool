/**
 * Invoice Data Source Logs API Route
 * Get activity logs for a data source
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * GET /api/invoice-data-sources/:id/logs
 * Get activity logs for a data source
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '50';
    const offset = searchParams.get('offset') || '0';

    logger.info({ dataSourceId: id, limit, offset }, 'Fetching invoice data source logs');

    const queryParams = new URLSearchParams({ limit, offset });
    const { data, status } = await callBackendApi(
      `/api/invoice-data-sources/${id}/logs?${queryParams.toString()}`
    );

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice data source logs API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch data source logs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
