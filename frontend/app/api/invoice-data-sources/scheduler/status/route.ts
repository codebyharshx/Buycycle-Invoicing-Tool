/**
 * Scheduler Status API Route
 * Get the status of all scheduled fetch jobs
 */

import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * GET /api/invoice-data-sources/scheduler/status
 * Get scheduler status
 */
export async function GET() {
  try {
    const { data, status } = await callBackendApi('/api/invoice-data-sources/scheduler/status');

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Scheduler status API error'
    );
    return NextResponse.json(
      {
        initialized: false,
        jobs: [],
        error: 'Failed to get scheduler status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
