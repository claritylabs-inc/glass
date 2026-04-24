"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { tokensForAccent, type BrandTokens } from "@/lib/branding";

const STORAGE_KEY = "brandTheme";

/**
 * Subscribes to the viewer's `brokerOrg` and applies its brand theme to
 * `<html>` as CSS variable overrides. Only active when the viewer is a client
 * of a broker — brokers view the default theme. Caches the resolved tokens in
 * `localStorage` so the anti-flash script in the root layout can apply them
 * synchronously on the next page load.
 */
export function BrandThemeApplier() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});

  // Swap tokens when dark mode toggles without waiting for a re-query.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const light = safeParse<BrandTokens>(root.dataset.brandTokensLight);
      const dark = safeParse<BrandTokens>(root.dataset.brandTokensDark);
      if (!light || !dark) return;
      const active = root.classList.contains("dark") ? dark : light;
      for (const [k, v] of Object.entries(active)) {
        root.style.setProperty(k, v);
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewerOrg === undefined) return;
    const broker = viewerOrg?.brokerOrg as
      | { brandingColor?: string; whiteLabelingEnabled?: boolean }
      | null
      | undefined;
    const accent = broker?.whiteLabelingEnabled === false ? undefined : broker?.brandingColor;

    if (!accent) {
      clearBrandTheme();
      return;
    }

    const light = tokensForAccent(accent, "light");
    const dark = tokensForAccent(accent, "dark");
    if (!light || !dark) {
      clearBrandTheme();
      return;
    }

    applyBrandTheme({ light, dark });
  }, [viewerOrg]);

  return null;
}

function applyBrandTheme({
  light,
  dark,
}: {
  light: BrandTokens;
  dark: BrandTokens;
}) {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const active = isDark ? dark : light;
  for (const [k, v] of Object.entries(active)) {
    root.style.setProperty(k, v);
  }
  // Stash the inactive set so toggling dark mode can swap without waiting for
  // the next Convex round-trip.
  root.dataset.brandTokensLight = JSON.stringify(light);
  root.dataset.brandTokensDark = JSON.stringify(dark);
}

function safeParse<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function clearBrandTheme() {
  const root = document.documentElement;
  const keys: (keyof BrandTokens)[] = [
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
  ];
  for (const k of keys) root.style.removeProperty(k);
  delete root.dataset.brandTokensLight;
  delete root.dataset.brandTokensDark;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — best-effort cleanup of legacy cache
  }
}
