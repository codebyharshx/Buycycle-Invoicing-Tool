/**
 * Invoice accounting Excel export API route
 * Proxies binary Excel file from backend with auth
 */

import { NextRequest, NextResponse } from 'next/server';
import { callBackendApiBinary } from '@/lib/backend-api';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();

    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const vendor = searchParams.get('vendor');

    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (vendor) params.set('vendor', vendor);

    const query = params.toString() ? `?${params.toString()}` : '';
    const { data, status } = await callBackendApiBinary(`/api/invoice-ocr/accounting/export${query}`);

    const safeDateFrom = (dateFrom || 'all').replace(/[^a-zA-Z0-9-]/g, '_');
    const safeDateTo = (dateTo || 'all').replace(/[^a-zA-Z0-9-]/g, '_');

    return new NextResponse(data, {
      status,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="accounting_${safeDateFrom}_${safeDateTo}.xlsx"`,
      },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Invoice accounting export API error'
    );
    return NextResponse.json(
      {
        error: 'Failed to export accounting data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
