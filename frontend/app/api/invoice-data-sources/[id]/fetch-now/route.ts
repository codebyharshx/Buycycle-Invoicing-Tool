/**
 * Fetch Now API Route
 * Manually trigger immediate fetch for a data source
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/invoice-data-sources/[id]/fetch-now
 * Trigger manual fetch for a data source
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    logger.info({ dataSourceId: id, type: body.type }, 'Triggering manual fetch');

    const { data, status } = await callBackendApi(`/api/invoice-data-sources/${id}/fetch-now`, {
      method: 'POST',
      body,
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Fetch now API error'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to trigger fetch',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
