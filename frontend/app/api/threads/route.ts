/**
 * Threads API Route
 * Proxies requests to backend threads API
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * GET /api/threads
 * List threads for an entity
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();

    const { data, status, success, error } = await callBackendApi(
      `/api/threads?${queryString}`
    );

    if (!success) {
      logger.warn('Threads backend error:', error);
      return NextResponse.json({ success: true, threads: [] });
    }

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Threads API error:', error);
    return NextResponse.json({ success: true, threads: [] });
  }
}

/**
 * POST /api/threads
 * Create a new thread/comment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { data, status, success, error } = await callBackendApi('/api/threads', {
      method: 'POST',
      body,
    });

    if (!success) {
      return NextResponse.json(
        { success: false, error: error || 'Failed to create thread' },
        { status }
      );
    }

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Create thread API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create thread' },
      { status: 500 }
    );
  }
}
