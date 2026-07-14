"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

export function QueryProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: false },
    },
  }));
  const persister = typeof window === "undefined" ? null : createSyncStoragePersister({
    storage: window.sessionStorage,
    key: `horarios-cache:${userId}`,
  });

  if (!persister) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, buster: `v1:${userId}`, maxAge: 30 * 60_000 }}>
      {children}
    </PersistQueryClientProvider>
  );
}
