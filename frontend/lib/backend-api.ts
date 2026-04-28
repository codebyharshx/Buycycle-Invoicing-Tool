/**
 * Backend API utilities for calling the Express backend
 */

import { headers } from 'next/headers';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  status: number;
}

/**
 * Get auth headers from the incoming request (server-side)
 * This forwards the Authorization header from the client to the backend
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const headersList = await headers();
    const authorization = headersList.get('authorization');
    if (authorization) {
      return { Authorization: authorization };
    }
  } catch {
    // headers() not available (e.g., not in a request context)
  }
  return {};
}

/**
 * Call backend API with JSON response
 */
export async function callBackendApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const url = `${BACKEND_URL}${path}`;
    const authHeaders = await getAuthHeaders();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...options.headers,
      },
      body: options.body && typeof options.body === 'object'
        ? JSON.stringify(options.body)
        : options.body,
    });

    const data = await response.json();

    if (!response.ok) {
      // Include full data object for error responses (e.g., 409 Conflict with duplicate info)
      return { success: false, data, error: data.error || 'Request failed', status: response.status };
    }

    return { success: true, data, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500
    };
  }
}

/**
 * Call backend API with binary response (for file downloads)
 */
export async function callBackendApiBinary(
  path: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: Blob; error?: string; status: number }> {
  try {
    const url = `${BACKEND_URL}${path}`;
    const authHeaders = await getAuthHeaders();

    const response = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || 'Request failed', status: response.status };
    }

    const blob = await response.blob();
    return { success: true, data: blob, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500
    };
  }
}
