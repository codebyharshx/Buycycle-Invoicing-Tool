/**
 * Logger Utility Module
 * Simple Pino logger for development
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

export function withCorrelationId(correlationId: string) {
  return logger.child({ correlationId });
}

export function logError(error: Error, context?: Record<string, unknown>) {
  logger.error({ err: error.message, stack: error.stack, ...context }, 'Error occurred');
}

export default logger;
