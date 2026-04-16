/**
 * Authentication utilities and API client
 */

// User types
export type UserRole = 'admin' | 'manager' | 'member';

export interface User {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface LoginResponse {
  message: string;
  user: User;
  token: string;
  timestamp: string;
}

export interface AuthError {
  error: string;
  message: string;
  timestamp: string;
}

// Token storage keys
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

/**
 * Get stored auth token
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Store auth token
 */
export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Remove auth token
 */
export function removeToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Get stored user
 */
export function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(USER_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as User;
  } catch {
    return null;
  }
}

/**
 * Store user data
 */
export function setStoredUser(user: User): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Remove stored user
 */
export function removeStoredUser(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_KEY);
}

/**
 * Clear all auth data
 */
export function clearAuth(): void {
  removeToken();
  removeStoredUser();
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getToken();
}

/**
 * Check if user has required role
 */
export function hasRole(user: User | null, ...roles: UserRole[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

/**
 * Check if user has permission for action
 */
export function hasPermission(user: User | null, action: string): boolean {
  if (!user) return false;

  const permissions: Record<UserRole, string[]> = {
    member: ['view', 'comment'],
    manager: ['view', 'comment', 'assign', 'approve'],
    admin: ['view', 'comment', 'assign', 'approve', 'delete', 'admin'],
  };

  return permissions[user.role]?.includes(action) ?? false;
}

// Backend URL for direct auth calls
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

/**
 * Login with email and password
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Login failed');
  }

  // Store token and user
  setToken(data.token);
  setStoredUser(data.user);

  return data as LoginResponse;
}

/**
 * Get current user from API
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // Token invalid, clear auth
      if (response.status === 401) {
        clearAuth();
      }
      return null;
    }

    const data = await response.json();
    const user = data.user as User;

    // Update stored user
    setStoredUser(user);

    return user;
  } catch {
    return null;
  }
}

/**
 * Logout - clear auth data
 */
export function logout(): void {
  clearAuth();
}

// ========== User Management API (Admin only) ==========

export interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
}

export interface UpdateUserRequest {
  email?: string;
  password?: string;
  name?: string;
  role?: UserRole;
  is_active?: boolean;
}

export interface UsersResponse {
  users: User[];
  total: number;
  timestamp: string;
}

/**
 * Get all users (admin only)
 */
export async function getAllUsers(includeInactive = true): Promise<User[]> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(
    `${BACKEND_URL}/api/auth/users?includeInactive=${includeInactive}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to fetch users');
  }

  return data.users as User[];
}

/**
 * Create a new user (admin only)
 */
export async function createUser(userData: CreateUserRequest): Promise<User> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`${BACKEND_URL}/api/auth/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(userData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to create user');
  }

  return data.user as User;
}

/**
 * Update a user (admin only)
 */
export async function updateUser(id: number, userData: UpdateUserRequest): Promise<User> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`${BACKEND_URL}/api/auth/users/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(userData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to update user');
  }

  return data.user as User;
}

/**
 * Deactivate a user (admin only)
 */
export async function deleteUser(id: number): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`${BACKEND_URL}/api/auth/users/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to delete user');
  }
}
