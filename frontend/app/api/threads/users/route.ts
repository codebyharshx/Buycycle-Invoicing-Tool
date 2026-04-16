/**
 * Threads Users API Route
 * Returns list of users for @mention autocomplete
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';

interface User {
  id: number;
  name: string | null;
  email: string;
  role: string;
}

interface UsersResponse {
  success: boolean;
  users: User[];
}

/**
 * GET /api/threads/users
 * Get users for @mention autocomplete
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get('search') || '';

  const queryString = search ? `?search=${encodeURIComponent(search)}` : '';

  const result = await callBackendApi<UsersResponse>(`/api/threads/users${queryString}`);

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error, users: [] },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
