/**
 * Notification Count API Route
 */

import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';

interface CountResponse {
  success: boolean;
  count: number;
}

/**
 * GET /api/notifications/count
 * Get unread notification count
 */
export async function GET() {
  const result = await callBackendApi<CountResponse>('/api/notifications/count');

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error, count: 0 },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
