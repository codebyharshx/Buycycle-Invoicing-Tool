/**
 * Forgot Password API Route
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const result = await callBackendApi('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return NextResponse.json(result.data || { message: 'Request processed' }, {
      status: result.status,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
