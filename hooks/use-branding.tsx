"use client";

import { createContext, useContext } from "react";
import type { BrandingContext } from "@/convex/lib/branding";

export { type BrandingContext };

export const BrandingCtx = createContext<BrandingContext | null>(null);

export function BrandingProvider({
  children,
  branding,
}: {
  children: React.ReactNode;
  branding: BrandingContext;
}) {
  return <BrandingCtx.Provider value={branding}>{children}</BrandingCtx.Provider>;
}

export function useBranding(): BrandingContext {
  const ctx = useContext(BrandingCtx);
  if (!ctx) throw new Error("useBranding must be used within <BrandingProvider>");
  return ctx;
}
