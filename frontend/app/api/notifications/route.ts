/**
 * Notifications API Route
 * Proxy to backend notifications endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';

interface Notification {
  id: number;
  user_id: number;
  type: 'assignment' | 'mention';
  entity_type: 'invoice' | 'thread';
  entity_id: number;
  title: string;
  message: string;
  actor_id: number | null;
  actor_name: string | null;
  is_read: boolean;
  created_at: string;
  invoice_number?: string;
  vendor?: string;
}

interface NotificationsResponse {
  success: boolean;
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

/**
 * GET /api/notifications
 * Get notifications for the current user
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = searchParams.get('limit') || '50';
  const offset = searchParams.get('offset') || '0';
  const unreadOnly = searchParams.get('unreadOnly') || 'false';

  const result = await callBackendApi<NotificationsResponse>(
    `/api/notifications?limit=${limit}&offset=${offset}&unreadOnly=${unreadOnly}`
  );

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
