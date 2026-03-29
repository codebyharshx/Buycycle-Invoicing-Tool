/**
 * Invoice Tag Update/Delete API Route
 * Proxies requests to backend for updating and deleting invoice tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { callBackendApi } from '@/lib/backend-api';

/**
 * PUT /api/invoice-tags/[id]
 * Update an invoice tag
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { data, status } = await callBackendApi(`/api/invoice-tags/${id}`, {
      method: 'PUT',
      body,
    });
    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Update invoice tag API error:', error);
    return NextResponse.json(
      { error: 'Failed to update invoice tag', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/invoice-tags/[id]
 * Delete an invoice tag
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data, status } = await callBackendApi(`/api/invoice-tags/${id}`, {
      method: 'DELETE',
    });
    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Delete invoice tag API error:', error);
    return NextResponse.json(
      { error: 'Failed to delete invoice tag', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
