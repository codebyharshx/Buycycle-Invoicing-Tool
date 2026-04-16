/**
 * Test Connection API Route
 * Test IMAP or SFTP connection with provided credentials
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * POST /api/invoice-data-sources/test-connection
 * Test IMAP or SFTP connection
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    logger.info({ type: body.type }, 'Testing connection');

    const { data, status } = await callBackendApi('/api/invoice-data-sources/test-connection', {
      method: 'POST',
      body,
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Connection test API error'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to test connection',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
