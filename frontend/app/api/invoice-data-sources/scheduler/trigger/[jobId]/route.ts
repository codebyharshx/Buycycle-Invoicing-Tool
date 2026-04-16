/**
 * Scheduler Trigger API Route
 * Manually trigger a specific scheduled job
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/**
 * POST /api/invoice-data-sources/scheduler/trigger/[jobId]
 * Trigger a scheduled job
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { jobId } = await context.params;

    logger.info({ jobId }, 'Triggering scheduled job');

    const { data, status } = await callBackendApi(`/api/invoice-data-sources/scheduler/trigger/${jobId}`, {
      method: 'POST',
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Scheduler trigger API error'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to trigger job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
