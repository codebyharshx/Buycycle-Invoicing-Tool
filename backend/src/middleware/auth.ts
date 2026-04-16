/**
 * Authentication Middleware
 *
 * Validates JWT tokens and attaches user context to requests.
 * Provides role-based access control for protected routes.
 */

import { Request, Response, NextFunction } from 'express';
import {
  verifyToken,
  findUserById,
  SafeUser,
  UserRole,
  hasPermission,
  JWTPayload,
} from '../services/auth.service';
import logger from '../utils/logger';

/**
 * Extend Express Request to include user context
 */
declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
      token?: JWTPayload;
    }
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  // Support "Bearer <token>" format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Also support raw token
  return authHeader;
}

/**
 * Authentication middleware - validates JWT and attaches user to request
 * Use this for routes that REQUIRE authentication
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No token provided',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const payload = verifyToken(token);

    if (!payload) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or expired token',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Get fresh user data from database
    const user = await findUserById(payload.userId);

    if (!user) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'User not found or inactive',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Attach user and token to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      role: user.role as UserRole,
      is_active: user.is_active,
      last_login_at: user.last_login_at,
      created_at: user.created_at,
    };
    req.token = payload;

    next();
  } catch (error) {
    logger.error({ error }, 'Auth middleware error');
    res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Optional authentication middleware - attaches user if token is valid, but doesn't require it
 * Use this for routes that work with or without authentication
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);

    if (token) {
      const payload = verifyToken(token);

      if (payload) {
        const user = await findUserById(payload.userId);

        if (user) {
          req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar_url: user.avatar_url,
            role: user.role as UserRole,
            is_active: user.is_active,
            last_login_at: user.last_login_at,
            created_at: user.created_at,
          };
          req.token = payload;
        }
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth, just continue without user
    logger.warn({ error }, 'Optional auth error - continuing without user');
    next();
  }
}

/**
 * Role-based authorization middleware factory
 * Use after requireAuth to check if user has required role
 *
 * @example
 * router.delete('/invoice/:id', requireAuth, requireRole('admin'), deleteInvoice);
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No user context',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        { userId: req.user.id, role: req.user.role, required: allowedRoles },
        'Access denied - insufficient role'
      );
      res.status(403).json({
        error: 'Access denied',
        message: `Required role: ${allowedRoles.join(' or ')}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}

/**
 * Permission-based authorization middleware factory
 * Use after requireAuth to check if user has required permission
 *
 * @example
 * router.post('/invoice/:id/approve', requireAuth, requirePermission('approve'), approveInvoice);
 */
export function requirePermission(action: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No user context',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!hasPermission(req.user.role, action)) {
      logger.warn(
        { userId: req.user.id, role: req.user.role, action },
        'Access denied - insufficient permission'
      );
      res.status(403).json({
        error: 'Access denied',
        message: `Required permission: ${action}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}
