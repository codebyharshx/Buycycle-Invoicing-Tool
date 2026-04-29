/**
 * Next.js API Route: Extract Invoice with Line Items
 * Proxies requests to backend API for multi-file invoice upload
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_API_URL || 'http://localhost:3001';
const BACKEND_API_KEY = process.env.INTERNAL_API_KEY;

export async function POST(request: NextRequest) {

  try {
    // Get form data from request
    const incomingFormData = await request.formData();

    // Debug: Log what we received
    const invoiceFile = incomingFormData.get('invoice');
    const csvFile = incomingFormData.get('csv');
    console.log('[API] FormData received:', {
      hasInvoice: !!invoiceFile,
      invoiceType: invoiceFile instanceof File ? 'File' : typeof invoiceFile,
      invoiceName: invoiceFile instanceof File ? invoiceFile.name : null,
      hasCsv: !!csvFile,
      csvType: csvFile instanceof File ? 'File' : typeof csvFile,
      csvName: csvFile instanceof File ? csvFile.name : null,
    });

    // Rebuild FormData for the backend request (Next.js FormData forwarding issue)
    const outgoingFormData = new FormData();
    for (const [key, value] of incomingFormData.entries()) {
      if (value instanceof File) {
        // Convert File to Blob with proper filename
        const blob = new Blob([await value.arrayBuffer()], { type: value.type });
        outgoingFormData.append(key, blob, value.name);
      } else {
        outgoingFormData.append(key, value);
      }
    }

    // Forward the Authorization header from the client request
    const authHeader = request.headers.get('Authorization');

    // Forward to backend
    const backendUrl = `${BACKEND_API_URL}/api/invoice-ocr/extract-with-line-items`;
    console.log('[API] Forwarding to backend:', backendUrl);

    const backendResponse = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'x-api-key': BACKEND_API_KEY || '',
        ...(authHeader && { 'Authorization': authHeader }),
      },
      body: outgoingFormData,
    });

    const responseText = await backendResponse.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('[API] Failed to parse backend response:', responseText);
      return NextResponse.json(
        { error: 'Invalid response from backend', details: responseText.substring(0, 500) },
        { status: 500 }
      );
    }

    if (!backendResponse.ok) {
      return NextResponse.json(data, { status: backendResponse.status });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('[API] Invoice extraction with line items failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Failed to extract invoice with line items',
        details: errorMessage,
        backendUrl: BACKEND_API_URL ? 'configured' : 'not configured'
      },
      { status: 500 }
    );
  }
}
