/**
 * Simple client-side logger
 */

const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    if (isDev) console.log(`[INFO] ${message}`, data || '');
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[WARN] ${message}`, data || '');
  },
  error: (message: string, data?: Record<string, unknown>) => {
    console.error(`[ERROR] ${message}`, data || '');
  },
  debug: (message: string, data?: Record<string, unknown>) => {
    if (isDev) console.debug(`[DEBUG] ${message}`, data || '');
  },
};
