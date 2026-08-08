"use client";

import { CircleAlert, CloudOff, Loader2 } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

import type { AutoSaveStatus as AutoSaveStatusValue } from "@/lib/sync/use-local-first-auto-save";
import { cn } from "@/lib/utils";

const SLOW_SAVE_DELAY_MS = 3_000;

type AutoSaveStatusRegistry = {
  remove: (id: string) => void;
  update: (id: string, status: AutoSaveStatusValue) => void;
};

const AutoSaveStatusContext = createContext<AutoSaveStatusRegistry | null>(
  null,
);

const STATUS_CONTENT: Record<
  Exclude<AutoSaveStatusValue, "saved">,
  { title: string; description?: string }
> = {
  saving: { title: "Still saving…" },
  unsaved: {
    title: "Unsaved changes",
    description: "Finish this edit before leaving.",
  },
  error: {
    title: "Changes not saved",
    description: "Try again before leaving.",
  },
};

function AutoSaveStatusSurface({
  status,
}: {
  status: Exclude<AutoSaveStatusValue, "saved">;
}) {
  const content = STATUS_CONTENT[status];

  return (
    <div
      role={status === "error" ? "alert" : "status"}
      aria-live={status === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      data-status={status}
      className={cn(
        "pointer-events-none flex max-w-full animate-in items-center gap-2.5 rounded-full border bg-popover/95 px-3.5 py-2 text-base text-popover-foreground shadow-lg shadow-black/[0.08] backdrop-blur-md duration-150 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none",
        status === "saving" && "border-foreground/10",
        status === "unsaved" && "border-warning/25",
        status === "error" && "border-destructive/25",
      )}
    >
      {status === "saving" ? (
        <Loader2
          className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : status === "unsaved" ? (
        <CircleAlert
          className="size-4 shrink-0 text-warning"
          aria-hidden="true"
        />
      ) : (
        <CloudOff
          className="size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
      )}
      <p className="min-w-0 truncate">
        <span className="font-medium">{content.title}</span>
        {content.description ? (
          <span className="ml-1.5 hidden text-muted-foreground sm:inline">
            {content.description}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function DelayedSavingStatus() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(true);
    }, SLOW_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return visible ? <AutoSaveStatusSurface status="saving" /> : null;
}

function AutoSaveStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState(
    () => new Map<string, AutoSaveStatusValue>(),
  );

  const update = useCallback((id: string, status: AutoSaveStatusValue) => {
    setStatuses((current) => {
      if (current.get(id) === status) return current;
      return new Map(current).set(id, status);
    });
  }, []);

  const remove = useCallback((id: string) => {
    setStatuses((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const registry = useMemo(() => ({ remove, update }), [remove, update]);
  const status = combineAutoSaveStatuses(...statuses.values());

  return (
    <AutoSaveStatusContext.Provider value={registry}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
        style={{
          bottom:
            "calc(var(--glass-app-bottom-inset, 0px) + env(safe-area-inset-bottom) + 1.5rem)",
        }}
      >
        {status === "saving" ? (
          <DelayedSavingStatus />
        ) : status === "saved" ? null : (
          <AutoSaveStatusSurface status={status} />
        )}
      </div>
    </AutoSaveStatusContext.Provider>
  );
}

function AutoSaveStatus({ status }: { status: AutoSaveStatusValue }) {
  const registry = useContext(AutoSaveStatusContext);
  const id = useId();

  useEffect(() => {
    registry?.update(id, status);
    return () => registry?.remove(id);
  }, [id, registry, status]);

  return null;
}

function combineAutoSaveStatuses(
  ...statuses: AutoSaveStatusValue[]
): AutoSaveStatusValue {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("unsaved")) return "unsaved";
  if (statuses.includes("saving")) return "saving";
  return "saved";
}

export {
  AutoSaveStatus,
  AutoSaveStatusProvider,
  SLOW_SAVE_DELAY_MS,
  combineAutoSaveStatuses,
};
