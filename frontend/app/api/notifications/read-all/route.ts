/**
 * Mark All Notifications as Read API Route
 */

import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';

interface ReadAllResponse {
  success: boolean;
  message: string;
  count: number;
}

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
export async function POST() {
  const result = await callBackendApi<ReadAllResponse>('/api/notifications/read-all', {
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
