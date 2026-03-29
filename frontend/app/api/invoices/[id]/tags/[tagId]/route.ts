/**
 * Invoice Tag Removal API Route
 * Proxies requests to backend for removing a tag from an invoice
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { callBackendApi } from '@/lib/backend-api';

/**
 * DELETE /api/invoices/[id]/tags/[tagId]
 * Remove a tag from an invoice
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  try {
    const { id, tagId } = await params;

    const { data, status } = await callBackendApi(
      `/api/invoice-tags/invoices/${id}/tags/${tagId}`,
      {
        method: 'DELETE',
      }
    );

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Remove invoice tag API error:', error);
    return NextResponse.json(
      { error: 'Failed to remove tag', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
