"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Page header context
interface PageHeaderState {
  title: string | React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  left?: React.ReactNode;
  right?: React.ReactNode;
}

interface PageHeaderContextType {
  header: PageHeaderState;
  setHeader: (state: PageHeaderState) => void;
}

const PageHeaderContext = React.createContext<PageHeaderContextType | undefined>(undefined);

export function usePageHeader() {
  const context = React.useContext(PageHeaderContext);
  if (!context) {
    throw new Error("usePageHeader must be used within a PageHeaderProvider");
  }
  return context;
}

function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = React.useState<PageHeaderState>({ title: "" });
  return (
    <PageHeaderContext.Provider value={{ header, setHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

// Query client - create inside component to avoid sharing state between requests
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

// Check if Clerk key looks valid (basic format check)
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isClerkEnabled = clerkPublishableKey &&
  (clerkPublishableKey.startsWith('pk_test_') || clerkPublishableKey.startsWith('pk_live_')) &&
  clerkPublishableKey.length > 20;

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const content = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PageHeaderProvider>
          {children}
          <Toaster position="top-right" richColors />
        </PageHeaderProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );

  // Only wrap with ClerkProvider if we have a valid key
  if (isClerkEnabled) {
    return <ClerkProvider>{content}</ClerkProvider>;
  }

  return content;
}
