/**
 * Linked Invoices API Route
 * Fetches credit notes, surcharges, and other invoices linked to a parent invoice
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data, status } = await callBackendApi(`/api/invoice-ocr/extractions/${id}/linked`);
    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Linked invoices API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch linked invoices',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
