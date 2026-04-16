/**
 * Agents API Route
 * Returns list of users for assignment purposes
 * "Agents" are simply active users from the invoice_users table
 */

import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';

interface BackendUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
}

interface BackendUsersResponse {
  success: boolean;
  users: BackendUser[];
}

/**
 * Split a full name into firstName and lastName
 */
function splitName(name: string | null): { firstName: string; lastName: string } {
  if (!name || name.trim() === '') {
    return { firstName: 'Unknown', lastName: '' };
  }

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

/**
 * GET /api/agents
 * List all active users as agents for assignment
 */
export async function GET() {
  try {
    // Call backend threads/users endpoint (available to all authenticated users)
    const result = await callBackendApi<BackendUsersResponse>('/api/threads/users');

    if (!result.success || !result.data?.users) {
      console.error('Failed to fetch users for agents:', result.error);
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch agents',
        data: []
      }, { status: result.status || 500 });
    }

    // Transform users to agent format (firstName/lastName split from name)
    const agents = result.data.users.map(user => {
      const { firstName, lastName } = splitName(user.name);
      return {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        role: user.role,
      };
    });

    return NextResponse.json({ success: true, data: agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch agents', data: [] },
      { status: 500 }
    );
  }
}
