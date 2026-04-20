"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { ThemeProvider } from "@/hooks/use-theme";
import type { ReactNode } from "react";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud"
);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider>
      <ConvexProvider client={convex}>
        <ThemeProvider>{children}</ThemeProvider>
      </ConvexProvider>
    </AuthKitProvider>
  );
}
