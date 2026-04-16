/**
 * Validate Reset Token API Route
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');

    if (!token) {
      return NextResponse.json({ valid: false, error: 'Missing token' }, { status: 400 });
    }

    const response = await fetch(
      `${BACKEND_URL}/api/auth/reset-password/validate?token=${token}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ valid: false, error: 'Failed to validate token' }, { status: 500 });
  }
}
