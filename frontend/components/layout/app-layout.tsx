"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Loader2 } from "lucide-react";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/forgot-password", "/reset-password"];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();

  // Check if current route is public
  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    pathname.startsWith(route)
  );

  // Redirect to login if not authenticated and not on public route
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublicRoute) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, isPublicRoute, router]);

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Public routes - render without sidebar
  if (isPublicRoute) {
    return (
      <main className="min-h-screen bg-gray-50">
        {children}
      </main>
    );
  }

  // Not authenticated on protected route - show loading while redirecting
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Authenticated layout with sidebar
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
