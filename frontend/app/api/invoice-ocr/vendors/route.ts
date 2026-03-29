import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const { data, status } = await callBackendApi('/api/invoice-ocr/vendors');
    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice vendors API error');
    return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 });
  }
}



