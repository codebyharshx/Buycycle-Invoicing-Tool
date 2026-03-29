/**
 * Invoice Tags Assignment API Route
 * Proxies requests to backend for assigning/listing tags on an invoice
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { callBackendApi } from '@/lib/backend-api';

/**
 * GET /api/invoices/[id]/tags
 * Get all tags assigned to an invoice
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data, status } = await callBackendApi(`/api/invoice-tags/invoices/${id}/tags`);
    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Get invoice tags API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoice tags', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invoices/[id]/tags
 * Assign a tag to an invoice
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { data, status } = await callBackendApi(`/api/invoice-tags/invoices/${id}/tags`, {
      method: 'POST',
      body,
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Assign invoice tag API error:', error);
    return NextResponse.json(
      { error: 'Failed to assign tag', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
