/**
 * Authentication Routes
 *
 * Handles user login, registration, password reset, and session management.
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
  authenticateUser,
  createUser,
  getAllUsers,
  getAllUsersIncludingInactive,
  findUserById,
  updateUser,
  deactivateUser,
  toSafeUser,
  UserRole,
  createPasswordResetToken,
  validateResetToken,
  resetPasswordWithToken,
  initPasswordResetColumns,
} from '../services/auth.service';
import { sendPasswordResetEmail, sendPasswordChangedEmail } from '../services/email.service';
import { requireAuth, requireRole } from '../middleware/auth';

const router = express.Router();

// Initialize password reset columns on startup
initPasswordResetColumns();

/**
 * Login request schema
 */
const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Create user request schema (admin only)
 */
const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['admin', 'manager', 'member']).optional().default('member'),
});

/**
 * Update user request schema (admin only)
 */
const updateUserSchema = z.object({
  email: z.string().email('Invalid email format').optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  name: z.string().min(1, 'Name is required').optional(),
  role: z.enum(['admin', 'manager', 'member']).optional(),
  is_active: z.boolean().optional(),
});

/**
 * Forgot password request schema
 */
const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

/**
 * Reset password request schema
 */
const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation error',
        details: parsed.error.errors,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { email, password } = parsed.data;

    // Authenticate user
    const result = await authenticateUser(email, password);

    if (!result) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid email or password',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ userId: result.user.id, email: result.user.email }, 'User logged in');

    res.json({
      message: 'Login successful',
      user: result.user,
      token: result.token,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Login error');
    res.status(500).json({
      error: 'Login failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    // User is already attached by requireAuth middleware
    res.json({
      user: req.user,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Get current user error');
    res.status(500).json({
      error: 'Failed to get user',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/auth/users
 * Create a new user (admin only)
 */
router.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      // Validate request body
      const parsed = createUserSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.errors,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const { email, password, name, role } = parsed.data;

      // Create user
      const user = await createUser(email, password, name, role as UserRole);

      req.log.info(
        { createdBy: req.user?.id, newUserId: user.id, email: user.email },
        'User created by admin'
      );

      res.status(201).json({
        message: 'User created successfully',
        user,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Check for duplicate email
      if (error instanceof Error && error.message.includes('duplicate')) {
        res.status(409).json({
          error: 'User already exists',
          message: 'A user with this email already exists',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      req.log.error({ error }, 'Create user error');
      res.status(500).json({
        error: 'Failed to create user',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/auth/users
 * Get all users (admin only)
 */
router.get(
  '/users',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      // Include inactive users if query param is set
      const includeInactive = req.query.includeInactive === 'true';
      const users = includeInactive ? await getAllUsersIncludingInactive() : await getAllUsers();

      res.json({
        users,
        total: users.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      req.log.error({ error }, 'Get users error');
      res.status(500).json({
        error: 'Failed to get users',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/auth/users/:id
 * Get user by ID (admin only)
 */
router.get(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        res.status(400).json({
          error: 'Invalid user ID',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const user = await findUserById(id);

      if (!user) {
        res.status(404).json({
          error: 'User not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      res.json({
        user: toSafeUser(user),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      req.log.error({ error }, 'Get user error');
      res.status(500).json({
        error: 'Failed to get user',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * PUT /api/auth/users/:id
 * Update user (admin only)
 */
router.put(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        res.status(400).json({
          error: 'Invalid user ID',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Validate request body
      const parsed = updateUserSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.errors,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Prevent admin from demoting themselves
      if (req.user?.id === id && parsed.data.role && parsed.data.role !== 'admin') {
        res.status(400).json({
          error: 'Cannot demote yourself',
          message: 'You cannot change your own admin role',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Prevent admin from deactivating themselves
      if (req.user?.id === id && parsed.data.is_active === false) {
        res.status(400).json({
          error: 'Cannot deactivate yourself',
          message: 'You cannot deactivate your own account',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const user = await updateUser(id, parsed.data);

      if (!user) {
        res.status(404).json({
          error: 'User not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      req.log.info(
        { updatedBy: req.user?.id, userId: id, updates: Object.keys(parsed.data) },
        'User updated by admin'
      );

      res.json({
        message: 'User updated successfully',
        user,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Check for duplicate email
      if (error instanceof Error && error.message.includes('duplicate')) {
        res.status(409).json({
          error: 'Email already exists',
          message: 'A user with this email already exists',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      req.log.error({ error }, 'Update user error');
      res.status(500).json({
        error: 'Failed to update user',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * DELETE /api/auth/users/:id
 * Deactivate user (admin only) - soft delete
 */
router.delete(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        res.status(400).json({
          error: 'Invalid user ID',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Prevent admin from deleting themselves
      if (req.user?.id === id) {
        res.status(400).json({
          error: 'Cannot delete yourself',
          message: 'You cannot delete your own account',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const success = await deactivateUser(id);

      if (!success) {
        res.status(404).json({
          error: 'User not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      req.log.info(
        { deletedBy: req.user?.id, userId: id },
        'User deactivated by admin'
      );

      res.json({
        message: 'User deactivated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      req.log.error({ error }, 'Delete user error');
      res.status(500).json({
        error: 'Failed to delete user',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const parsed = forgotPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation error',
        details: parsed.error.errors,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { email } = parsed.data;

    // Create reset token (returns null if user not found, but we don't reveal this)
    const result = await createPasswordResetToken(email);

    if (result) {
      // Send password reset email
      await sendPasswordResetEmail(result.user.email, result.user.name, result.token);
      req.log.info({ email }, 'Password reset email sent');
    } else {
      // Log but don't reveal to client that user doesn't exist
      req.log.info({ email }, 'Password reset requested for non-existent email');
    }

    // Always return success to prevent email enumeration
    res.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Forgot password error');
    res.status(500).json({
      error: 'Failed to process request',
      message: 'An error occurred while processing your request',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/auth/reset-password/validate
 * Validate a password reset token (check if it's valid before showing reset form)
 */
router.get('/reset-password/validate', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;

    if (!token) {
      res.status(400).json({
        error: 'Missing token',
        valid: false,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const user = await validateResetToken(token);

    if (!user) {
      res.status(400).json({
        error: 'Invalid or expired token',
        valid: false,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json({
      valid: true,
      email: user.email,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Validate reset token error');
    res.status(500).json({
      error: 'Failed to validate token',
      valid: false,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using a valid token
 */
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const parsed = resetPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation error',
        details: parsed.error.errors,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { token, password } = parsed.data;

    // Validate token first to get user info for email
    const user = await validateResetToken(token);

    if (!user) {
      res.status(400).json({
        error: 'Invalid or expired token',
        message: 'This password reset link is invalid or has expired. Please request a new one.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Reset the password
    const success = await resetPasswordWithToken(token, password);

    if (!success) {
      res.status(400).json({
        error: 'Reset failed',
        message: 'Failed to reset password. Please try again.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Send confirmation email
    await sendPasswordChangedEmail(user.email, user.name);

    req.log.info({ userId: user.id, email: user.email }, 'Password reset completed');

    res.json({
      message: 'Password has been reset successfully. You can now log in with your new password.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Reset password error');
    res.status(500).json({
      error: 'Failed to reset password',
      message: 'An error occurred while resetting your password',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
