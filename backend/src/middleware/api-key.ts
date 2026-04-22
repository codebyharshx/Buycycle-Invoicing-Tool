/**
 * API Key Authentication Middleware
 *
 * Validates API keys for external integrations (n8n, webhooks, etc.)
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Extract API key from request
 */
function extractApiKey(req: Request): string | null {
  // X-API-Key header (preferred)
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey) {
    return xApiKey;
  }

  // Authorization: ApiKey <key>
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('ApiKey ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * API Key authentication middleware
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    logger.warn({ path: req.path }, 'API key missing');
    res.status(401).json({
      error: 'Authentication required',
      message: 'API key required. Provide via X-API-Key header.',
    });
    return;
  }

  const configuredKey = process.env.N8N_API_KEY;

  if (!configuredKey) {
    logger.error('N8N_API_KEY not configured');
    res.status(500).json({
      error: 'Server configuration error',
      message: 'API key not configured',
    });
    return;
  }

  if (!timingSafeEqual(apiKey, configuredKey)) {
    logger.warn({ path: req.path }, 'Invalid API key');
    res.status(401).json({
      error: 'Authentication failed',
      message: 'Invalid API key',
    });
    return;
  }

  (req as any).authMethod = 'api_key';
  (req as any).authSource = 'n8n';
  next();
}
