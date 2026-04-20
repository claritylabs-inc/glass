"use client";

import { useEffect, useState, useCallback } from "react";

const ONBOARDING_CACHE_KEY = "prism:onboarding-complete";

export type OnboardingCacheState = {
  /** Whether onboarding is complete - null means unknown/not cached */
  onboardingComplete: boolean | null;
  /** Update the cached onboarding state */
  setOnboardingComplete: (value: boolean) => void;
  /** Clear the cached state (e.g., on logout) */
  clearCache: () => void;
};

/**
 * Hook to cache and retrieve onboarding completion state from localStorage.
 * This prevents the flash of dashboard skeleton for users who haven't completed onboarding.
 */
export function useOnboardingCache(): OnboardingCacheState {
  const [onboardingComplete, setCachedValue] = useState<boolean | null>(null);

  // Load from localStorage on mount (client-side only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ONBOARDING_CACHE_KEY);
      if (stored !== null) {
        setCachedValue(stored === "1");
      }
    } catch {
      // localStorage not available (e.g., private browsing)
      setCachedValue(null);
    }
  }, []);

  const setOnboardingComplete = useCallback((value: boolean) => {
    try {
      if (value) {
        localStorage.setItem(ONBOARDING_CACHE_KEY, "1");
      } else {
        localStorage.setItem(ONBOARDING_CACHE_KEY, "0");
      }
    } catch {
      // localStorage not available
    }
    setCachedValue(value);
  }, []);

  const clearCache = useCallback(() => {
    try {
      localStorage.removeItem(ONBOARDING_CACHE_KEY);
    } catch {
      // localStorage not available
    }
    setCachedValue(null);
  }, []);

  return { onboardingComplete, setOnboardingComplete, clearCache };
}
