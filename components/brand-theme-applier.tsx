"use client";

import { useEffect } from "react";

/** Spot owns the application theme. Supplier branding never changes client UI. */
export function BrandThemeApplier() {
  useEffect(() => {
    const root = document.documentElement;
    for (const key of [
      "--brand",
      "--brand-foreground",
      "--primary",
      "--primary-foreground",
      "--primary-light",
      "--primary-muted",
      "--ring",
      "--sidebar-primary",
      "--sidebar-primary-foreground",
      "--sidebar-ring",
      "--chart-1",
      "--chart-2",
    ])
      root.style.removeProperty(key);
    delete root.dataset.brandTokensLight;
    delete root.dataset.brandTokensDark;
    localStorage.removeItem("brandTheme");
  }, []);
  return null;
}
