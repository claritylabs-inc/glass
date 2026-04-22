"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api as _api } from "@/convex/_generated/api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

/**
 * Debounces per-field saves to clientPassport.upsertCore. Coalesces rapid
 * edits into a single patch per flush, flushes pending writes on unmount.
 */
export function usePassportSaver(delayMs = 500) {
  const upsertCore = useMutation(api.clientPassport.upsertCore);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingRef = useRef<Record<string, any>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(pending).length === 0) return;
    void upsertCore({ patch: pending }).catch(() => {
      // Swallow — user will retry or Continue will catch it
    });
  }, [upsertCore]);

  const save = useCallback(
    (field: string, value: unknown) => {
      pendingRef.current[field] = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  useEffect(() => {
    return () => {
      if (Object.keys(pendingRef.current).length > 0) flush();
    };
  }, [flush]);

  return { save, flush };
}
