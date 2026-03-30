/**
 * Simple client-side logger with Pino-compatible API
 * Supports both (message, data) and (data, message) argument orders
 */

const isDev = process.env.NODE_ENV !== 'production';

type LogData = Record<string, unknown>;

function formatLog(
  arg1: string | LogData | unknown,
  arg2?: string | LogData | unknown
): { message: string; data?: unknown } {
  // Pino-style: (data, message)
  if (typeof arg1 === 'object' && arg1 !== null && typeof arg2 === 'string') {
    return { message: arg2, data: arg1 };
  }
  // Standard style: (message, data)
  if (typeof arg1 === 'string') {
    return { message: arg1, data: arg2 };
  }
  // Just data object
  return { message: '', data: arg1 };
}

export const logger = {
  info: (arg1: string | LogData | unknown, arg2?: string | LogData | unknown) => {
    if (isDev) {
      const { message, data } = formatLog(arg1, arg2);
      console.log(`[INFO] ${message}`, data || '');
    }
  },
  warn: (arg1: string | LogData | unknown, arg2?: string | LogData | unknown) => {
    const { message, data } = formatLog(arg1, arg2);
    console.warn(`[WARN] ${message}`, data || '');
  },
  error: (arg1: string | LogData | unknown, arg2?: string | LogData | unknown) => {
    const { message, data } = formatLog(arg1, arg2);
    console.error(`[ERROR] ${message}`, data || '');
  },
  debug: (arg1: string | LogData | unknown, arg2?: string | LogData | unknown) => {
    if (isDev) {
      const { message, data } = formatLog(arg1, arg2);
      console.debug(`[DEBUG] ${message}`, data || '');
    }
  },
};
