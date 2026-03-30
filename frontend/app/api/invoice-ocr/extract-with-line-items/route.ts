/**
 * Next.js API Route: Extract Invoice with Line Items
 * Proxies requests to backend API for multi-file invoice upload
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const BACKEND_API_KEY = process.env.INTERNAL_API_KEY;

export async function POST(request: NextRequest) {

  try {
    // Get form data from request
    const formData = await request.formData();

    // Forward to backend
    const backendUrl = `${BACKEND_API_URL}/api/invoice-ocr/extract-with-line-items`;
    console.log('[API] Forwarding to backend:', backendUrl);

    const backendResponse = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'x-api-key': BACKEND_API_KEY || '',
      },
      body: formData,
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
