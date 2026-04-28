/**
 * Invoice Tags API Route
 * Proxies requests to backend invoice tags API
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { callBackendApi } from '@/lib/backend-api';

/**
 * GET /api/invoice-tags
 * List all available invoice tags
 */
export async function GET() {
  try {
    const { data, status, success } = await callBackendApi('/api/invoice-tags');
    if (!success) {
      // Backend might not be available, return empty array
      logger.warn('Invoice tags backend unavailable, returning empty array');
      return NextResponse.json({ success: true, data: [] });
    }
    // Backend returns { tags: [...] }, transform to { success: true, data: [...] }
    const responseData = data as { tags?: unknown[] } | undefined;
    const tags = responseData?.tags || [];
    return NextResponse.json({ success: true, data: tags }, { status });
  } catch (error) {
    logger.error('Invoice tags API error:', error);
    // Return empty tags on error to avoid breaking the UI
    return NextResponse.json({ success: true, data: [] });
  }
}

/**
 * POST /api/invoice-tags
 * Create a new tag
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data, status } = await callBackendApi('/api/invoice-tags', {
      method: 'POST',
      body,
    });

    // Pass through 409 Conflict for duplicate tags
    if (status === 409) {
      return NextResponse.json(data, { status: 409 });
    }

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Create invoice tag API error:', error);
    return NextResponse.json(
      { error: 'Failed to create invoice tag', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
