/**
 * Single Invoice Data Source API Route
 * Get, update, and delete a specific data source
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * GET /api/invoice-data-sources/:id
 * Get a single data source by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    logger.info({ dataSourceId: id }, 'Fetching invoice data source');

    const { data, status } = await callBackendApi(`/api/invoice-data-sources/${id}`);

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice data source fetch API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch data source',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/invoice-data-sources/:id
 * Update a data source
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    logger.info({ dataSourceId: id, updates: Object.keys(body) }, 'Updating invoice data source');

    const { data, status } = await callBackendApi(`/api/invoice-data-sources/${id}`, {
      method: 'PATCH',
      body,
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice data source update API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to update data source',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/invoice-data-sources/:id
 * Archive a data source
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    logger.info({ dataSourceId: id }, 'Archiving invoice data source');

    const { data, status } = await callBackendApi(`/api/invoice-data-sources/${id}`, {
      method: 'DELETE',
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice data source archive API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to archive data source',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
