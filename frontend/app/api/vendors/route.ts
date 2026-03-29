/**
 * Vendors API Route
 * List and create vendors
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * GET /api/vendors
 * List all vendors with optional search and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const limit = searchParams.get('limit') || '100';
    const offset = searchParams.get('offset') || '0';
    const includeInactive = searchParams.get('include_inactive') || 'false';

    const params = new URLSearchParams({ limit, offset });
    if (search) params.set('search', search);
    if (includeInactive === 'true') params.set('include_inactive', 'true');

    const { data, status } = await callBackendApi(
      `/api/vendors?${params.toString()}`
    );

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Vendors list API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch vendors',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/vendors
 * Create a new vendor
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    logger.info({ name: body.name }, 'Creating vendor');

    const { data, status } = await callBackendApi('/api/vendors', {
      method: 'POST',
      body,
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Vendor create API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to create vendor',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
