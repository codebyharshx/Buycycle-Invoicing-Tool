/**
 * Authentication Service
 *
 * Handles password hashing, JWT token generation/verification,
 * and user authentication for the invoice system.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getPgPool } from '../utils/db';
import logger from '../utils/logger';

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days
const SALT_ROUNDS = 10;

/**
 * User roles for authorization
 */
export type UserRole = 'admin' | 'manager' | 'member';

/**
 * User record from database
 */
export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean;
  last_login_at: Date | null;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * User data without sensitive fields (for API responses)
 */
export interface SafeUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

/**
 * JWT payload structure
 */
export interface JWTPayload {
  userId: number;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

/**
 * Hash a plain text password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare plain text password with hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate JWT token for a user
 */
export function generateToken(user: User | SafeUser): string {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    logger.warn({ error }, 'JWT verification failed');
    return null;
  }
}

/**
 * Remove sensitive fields from user object
 */
export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    role: user.role,
    is_active: user.is_active,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    'SELECT * FROM invoice_users WHERE email = $1 AND is_active = true',
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0] as User;
}

/**
 * Find user by ID
 */
export async function findUserById(id: number): Promise<User | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    'SELECT * FROM invoice_users WHERE id = $1 AND is_active = true',
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0] as User;
}

/**
 * Update user's last login timestamp
 */
export async function updateLastLogin(userId: number): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  await pool.query(
    'UPDATE invoice_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
    [userId]
  );
}

/**
 * Create a new user (admin function)
 */
export async function createUser(
  email: string,
  password: string,
  name: string,
  role: UserRole = 'member'
): Promise<SafeUser> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    `INSERT INTO invoice_users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email.toLowerCase().trim(), passwordHash, name, role]
  );

  logger.info({ email, role }, 'User created');
  return toSafeUser(result.rows[0] as User);
}

/**
 * Authenticate user with email and password
 * Returns user and token if successful, null if failed
 */
export async function authenticateUser(
  email: string,
  password: string
): Promise<{ user: SafeUser; token: string } | null> {
  const user = await findUserByEmail(email);

  if (!user) {
    logger.warn({ email }, 'Login attempt for non-existent user');
    return null;
  }

  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    logger.warn({ email }, 'Login attempt with invalid password');
    return null;
  }

  // Update last login
  await updateLastLogin(user.id);

  const token = generateToken(user);
  const safeUser = toSafeUser(user);

  logger.info({ userId: user.id, email }, 'User authenticated successfully');

  return { user: safeUser, token };
}

/**
 * Get all users (admin function)
 */
export async function getAllUsers(): Promise<SafeUser[]> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    'SELECT * FROM invoice_users WHERE is_active = true ORDER BY name ASC'
  );

  return result.rows.map((row) => toSafeUser(row as User));
}

/**
 * Check if a role has permission for an action
 */
export function hasPermission(role: UserRole, action: string): boolean {
  const permissions: Record<UserRole, string[]> = {
    member: ['view', 'comment'],
    manager: ['view', 'comment', 'assign', 'approve'],
    admin: ['view', 'comment', 'assign', 'approve', 'delete', 'admin'],
  };

  return permissions[role]?.includes(action) ?? false;
}

/**
 * Update user details (admin function)
 */
export async function updateUser(
  id: number,
  updates: {
    name?: string;
    email?: string;
    role?: UserRole;
    is_active?: boolean;
    password?: string;
  }
): Promise<SafeUser | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  // Build dynamic update query
  const setClauses: string[] = ['updated_at = NOW()'];
  const values: (string | boolean | number)[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }

  if (updates.email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    values.push(updates.email.toLowerCase().trim());
  }

  if (updates.role !== undefined) {
    setClauses.push(`role = $${paramIndex++}`);
    values.push(updates.role);
  }

  if (updates.is_active !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    values.push(updates.is_active);
  }

  if (updates.password !== undefined) {
    const passwordHash = await hashPassword(updates.password);
    setClauses.push(`password_hash = $${paramIndex++}`);
    values.push(passwordHash);
  }

  values.push(id);

  const result = await pool.query(
    `UPDATE invoice_users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return null;
  }

  logger.info({ userId: id, updates: Object.keys(updates) }, 'User updated');
  return toSafeUser(result.rows[0] as User);
}

/**
 * Deactivate user (soft delete)
 */
export async function deactivateUser(id: number): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    'UPDATE invoice_users SET is_active = false, updated_at = NOW() WHERE id = $1',
    [id]
  );

  if (result.rowCount && result.rowCount > 0) {
    logger.info({ userId: id }, 'User deactivated');
    return true;
  }

  return false;
}

/**
 * Get all users including inactive (admin function)
 */
export async function getAllUsersIncludingInactive(): Promise<SafeUser[]> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    'SELECT * FROM invoice_users ORDER BY is_active DESC, name ASC'
  );

  return result.rows.map((row) => toSafeUser(row as User));
}

// ========== Password Reset Functions ==========

import crypto from 'crypto';

const RESET_TOKEN_EXPIRY_HOURS = 1; // Token valid for 1 hour

/**
 * Generate a secure random token for password reset
 */
function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Initialize password reset columns if they don't exist
 */
export async function initPasswordResetColumns(): Promise<void> {
  const pool = getPgPool();
  if (!pool) return;

  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoice_users' AND column_name = 'reset_token'
        ) THEN
          ALTER TABLE invoice_users ADD COLUMN reset_token VARCHAR(255);
          ALTER TABLE invoice_users ADD COLUMN reset_token_expires TIMESTAMPTZ;
        END IF;
      END $$;
    `);
    logger.info('Password reset columns initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize password reset columns');
  }
}

/**
 * Create a password reset token for a user
 * Returns the token if successful, null if user not found
 */
export async function createPasswordResetToken(email: string): Promise<{ token: string; user: SafeUser } | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  // Find user by email
  const userResult = await pool.query(
    'SELECT * FROM invoice_users WHERE email = $1 AND is_active = true',
    [email.toLowerCase().trim()]
  );

  if (userResult.rows.length === 0) {
    logger.warn({ email }, 'Password reset requested for non-existent email');
    return null;
  }

  const user = userResult.rows[0] as User;
  const token = generateResetToken();
  const expires = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Store token and expiry
  await pool.query(
    `UPDATE invoice_users
     SET reset_token = $1, reset_token_expires = $2, updated_at = NOW()
     WHERE id = $3`,
    [token, expires, user.id]
  );

  logger.info({ userId: user.id, email }, 'Password reset token created');

  return { token, user: toSafeUser(user) };
}

/**
 * Validate a password reset token
 * Returns the user if valid, null if invalid or expired
 */
export async function validateResetToken(token: string): Promise<SafeUser | null> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  const result = await pool.query(
    `SELECT * FROM invoice_users
     WHERE reset_token = $1
     AND reset_token_expires > NOW()
     AND is_active = true`,
    [token]
  );

  if (result.rows.length === 0) {
    logger.warn({ token: token.slice(0, 8) + '...' }, 'Invalid or expired reset token');
    return null;
  }

  return toSafeUser(result.rows[0] as User);
}

/**
 * Reset password using a valid token
 * Returns true if successful, false if token invalid
 */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('Database unavailable');
  }

  // Validate token first
  const user = await validateResetToken(token);
  if (!user) {
    return false;
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update password and clear reset token
  await pool.query(
    `UPDATE invoice_users
     SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, user.id]
  );

  logger.info({ userId: user.id, email: user.email }, 'Password reset successful');

  return true;
}
