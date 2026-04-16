"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  User,
  UserRole,
  getToken,
  getStoredUser,
  login as authLogin,
  logout as authLogout,
  getCurrentUser,
  hasPermission as checkPermission,
  hasRole as checkRole,
} from "@/lib/auth";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (action: string) => boolean;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/forgot-password", "/reset-password"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // Check auth on mount
  React.useEffect(() => {
    async function checkAuth() {
      try {
        const token = getToken();

        if (!token) {
          setUser(null);
          setIsLoading(false);
          return;
        }

        // Try to get stored user first for faster UI
        const storedUser = getStoredUser();
        if (storedUser) {
          setUser(storedUser);
        }

        // Verify with server
        const serverUser = await getCurrentUser();
        if (serverUser) {
          setUser(serverUser);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    checkAuth();
  }, []);

  // Redirect based on auth state
  React.useEffect(() => {
    if (isLoading) return;

    const isPublicRoute = PUBLIC_ROUTES.some((route) =>
      pathname.startsWith(route)
    );

    if (!user && !isPublicRoute) {
      // Not authenticated and trying to access protected route
      router.push("/login");
    } else if (user && pathname === "/login") {
      // Already authenticated, redirect to dashboard
      router.push("/dashboard/invoices");
    }
  }, [user, isLoading, pathname, router]);

  const login = async (email: string, password: string) => {
    const response = await authLogin(email, password);
    setUser(response.user);
    router.push("/dashboard/invoices");
  };

  const logout = () => {
    authLogout();
    setUser(null);
    router.push("/login");
  };

  const hasPermission = (action: string) => checkPermission(user, action);
  const hasRole = (...roles: UserRole[]) => checkRole(user, ...roles);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        hasPermission,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Hook to require authentication
 * Returns null while loading, redirects if not authenticated
 */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      router.push("/login");
    }
  }, [auth.isLoading, auth.isAuthenticated, router]);

  return auth;
}

/**
 * Hook to require specific role
 */
export function useRequireRole(...roles: UserRole[]) {
  const auth = useRequireAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!auth.isLoading && auth.user && !auth.hasRole(...roles)) {
      // User doesn't have required role
      router.push("/dashboard/invoices");
    }
  }, [auth.isLoading, auth.user, auth.hasRole, roles, router]);

  return auth;
}
