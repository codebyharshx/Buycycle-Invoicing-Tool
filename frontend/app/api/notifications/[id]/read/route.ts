/**
 * Mark Notification as Read API Route
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';

interface ReadResponse {
  success: boolean;
  message: string;
}

/**
 * POST /api/notifications/:id/read
 * Mark a specific notification as read
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const result = await callBackendApi<ReadResponse>(`/api/notifications/${id}/read`, {
    method: 'POST',
  });

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
