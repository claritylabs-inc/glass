"use client";

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { StructuredLogEntry } from "@/components/structured-log";

interface LogDetailContextValue {
  entry: StructuredLogEntry | null;
  openLogDetail: (entry: StructuredLogEntry) => void;
  closeLogDetail: () => void;
}

const Ctx = createContext<LogDetailContextValue>({
  entry: null,
  openLogDetail: () => {},
  closeLogDetail: () => {},
});

export function LogDetailProvider({ children }: { children: React.ReactNode }) {
  const [entry, setEntry] = useState<StructuredLogEntry | null>(null);

  const openLogDetail = useCallback((e: StructuredLogEntry) => {
    setEntry(e);
  }, []);

  const closeLogDetail = useCallback(() => {
    setEntry(null);
  }, []);

  const value = useMemo(
    () => ({ entry, openLogDetail, closeLogDetail }),
    [entry, openLogDetail, closeLogDetail],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLogDetail() {
  return useContext(Ctx);
}
