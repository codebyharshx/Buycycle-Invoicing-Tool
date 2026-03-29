/**
 * Single Vendor API Route
 * Get, update, and delete a specific vendor
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

/**
 * GET /api/vendors/:id
 * Get a single vendor by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    logger.info({ vendorId: id }, 'Fetching vendor');

    const { data, status } = await callBackendApi(`/api/vendors/${id}`);

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Vendor fetch API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to fetch vendor',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/vendors/:id
 * Update a vendor
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    logger.info({ vendorId: id, updates: Object.keys(body) }, 'Updating vendor');

    const { data, status } = await callBackendApi(`/api/vendors/${id}`, {
      method: 'PATCH',
      body,
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Vendor update API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to update vendor',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/vendors/:id
 * Soft-delete a vendor
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    logger.info({ vendorId: id }, 'Deleting vendor');

    const { data, status } = await callBackendApi(`/api/vendors/${id}`, {
      method: 'DELETE',
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Vendor delete API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to delete vendor',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
