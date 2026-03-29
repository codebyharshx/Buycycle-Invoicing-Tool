/**
 * Single Thread API Route
 * Handles update and delete operations for threads
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * PUT /api/threads/:id
 * Update a thread/comment
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { data, status, success, error } = await callBackendApi(`/api/threads/${id}`, {
      method: 'PUT',
      body,
    });

    if (!success) {
      return NextResponse.json(
        { success: false, error: error || 'Failed to update thread' },
        { status }
      );
    }

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Update thread API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update thread' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/threads/:id
 * Delete a thread/comment
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const authorId = searchParams.get('author_id');

    const { data, status, success, error } = await callBackendApi(
      `/api/threads/${id}?author_id=${authorId}`,
      { method: 'DELETE' }
    );

    if (!success) {
      return NextResponse.json(
        { success: false, error: error || 'Failed to delete thread' },
        { status }
      );
    }

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error('Delete thread API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete thread' },
      { status: 500 }
    );
  }
}
