/**
 * Backend API utilities for calling the Express backend
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  status: number;
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
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body && typeof options.body === 'object'
        ? JSON.stringify(options.body)
        : options.body,
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Request failed', status: response.status };
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
    const response = await fetch(url, options);

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
