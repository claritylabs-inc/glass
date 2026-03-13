"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds

export function usePresence(pageKey: string | null) {
  const heartbeat = useMutation(api.presence.heartbeat);
  const others = useQuery(
    api.presence.getPagePresence,
    pageKey ? { pageKey } : "skip",
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!pageKey) return;

    // Send initial heartbeat
    heartbeat({ pageKey }).catch(() => {});

    // Set up interval
    intervalRef.current = setInterval(() => {
      heartbeat({ pageKey }).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pageKey, heartbeat]);

  return others ?? [];
}
