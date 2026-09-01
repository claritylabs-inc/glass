"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

import { useSpotSync } from "@/lib/sync/spot-sync";

type OperatorAgentContextValue = {
  activeThreadId: string | null;
  detachedPageContextKey: string | null;
  enabled: boolean;
  open: boolean;
  attachPageContext: () => void;
  close: () => void;
  detachPageContext: (key: string) => void;
  setActiveThreadId: (threadId: string | null) => void;
  toggle: () => void;
};

const OperatorAgentContext = createContext<OperatorAgentContextValue | null>(
  null,
);

function storageKey(userId: string, name: "open" | "thread") {
  return `spot:operator-agent:${userId}:${name}`;
}

function readStoredState(userId: string) {
  try {
    const storedOpen = localStorage.getItem(storageKey(userId, "open"));
    return {
      open: storedOpen === null ? true : storedOpen === "true",
      threadId: localStorage.getItem(storageKey(userId, "thread")) || null,
    };
  } catch {
    return { open: true, threadId: null };
  }
}

export function OperatorAgentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { scope } = useSpotSync();
  const enabled =
    pathname.startsWith("/operator") && !pathname.startsWith("/operator/login");
  const [open, setOpen] = useState(true);
  const [activeThreadIdState, setActiveThreadIdState] = useState<string | null>(
    null,
  );
  const [detachedPageContextKey, setDetachedPageContextKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!scope.userId) {
        setOpen(true);
        setActiveThreadIdState(null);
        return;
      }
      const stored = readStoredState(scope.userId);
      setOpen(stored.open);
      setActiveThreadIdState(stored.threadId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scope.userId]);

  const persistOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!scope.userId) return;
      try {
        localStorage.setItem(storageKey(scope.userId, "open"), String(next));
      } catch {}
    },
    [scope.userId],
  );

  const setActiveThreadId = useCallback(
    (threadId: string | null) => {
      setActiveThreadIdState(threadId);
      if (!scope.userId) return;
      try {
        const key = storageKey(scope.userId, "thread");
        if (threadId) localStorage.setItem(key, threadId);
        else localStorage.removeItem(key);
      } catch {}
    },
    [scope.userId],
  );

  const value = useMemo<OperatorAgentContextValue>(
    () => ({
      activeThreadId: activeThreadIdState,
      detachedPageContextKey,
      enabled,
      open: enabled && open,
      attachPageContext: () => setDetachedPageContextKey(null),
      close: () => persistOpen(false),
      detachPageContext: setDetachedPageContextKey,
      setActiveThreadId,
      toggle: () => persistOpen(!open),
    }),
    [
      activeThreadIdState,
      detachedPageContextKey,
      enabled,
      open,
      persistOpen,
      setActiveThreadId,
    ],
  );

  return (
    <OperatorAgentContext.Provider value={value}>
      {children}
    </OperatorAgentContext.Provider>
  );
}

export function useOptionalOperatorAgent() {
  return useContext(OperatorAgentContext);
}
