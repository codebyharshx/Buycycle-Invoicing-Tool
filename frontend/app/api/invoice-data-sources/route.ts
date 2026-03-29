/**
 * Invoice Data Sources API Route
 * List and create data sources
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * GET /api/invoice-data-sources
 * List all data sources with optional search and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const limit = searchParams.get('limit') || '100';
    const offset = searchParams.get('offset') || '0';

    const params = new URLSearchParams({ limit, offset });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    const { data, status: httpStatus } = await callBackendApi(
      `/api/invoice-data-sources?${params.toString()}`
    );

    return NextResponse.json(data, { status: httpStatus });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice data sources list API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch data sources',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invoice-data-sources
 * Create a new data source
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    logger.info({ name: body.name, email: body.email_address }, 'Creating invoice data source');

    const { data, status } = await callBackendApi('/api/invoice-data-sources', {
      method: 'POST',
      body,
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice data source create API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to create data source',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
