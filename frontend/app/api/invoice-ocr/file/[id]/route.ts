/**
 * Invoice OCR File API Route
 * Proxies PDF file requests to backend API with authentication
 */

import { NextRequest } from 'next/server';
import { callBackendApiBinary } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data, status } = await callBackendApiBinary(`/api/invoice-ocr/file/${id}`);

    // Forward PDF response with proper headers
    return new Response(data, {
      status,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Invoice OCR file API error');
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch invoice file',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
