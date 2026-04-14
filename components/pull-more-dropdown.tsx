"use client";

import { useState, useRef, useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PillButton } from "@/components/ui/pill-button";
import { Id } from "@/convex/_generated/dataModel";

interface PullMoreDropdownProps {
  connectionId: Id<"emailConnections">;
  provider?: "google" | "imap";
  lastScanParams?: {
    sinceDate?: string;
    untilDate?: string;
    senderDomains?: string[];
  };
  onCustomRange: () => void;
}

const PRESETS = [
  { label: "Last month", days: 30 },
  { label: "Last 3 months", days: 90 },
  { label: "Last 6 months", days: 180 },
  { label: "All time", days: null },
] as const;

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function PullMoreDropdown({
  connectionId,
  provider,
  lastScanParams,
  onCustomRange,
}: PullMoreDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const scanInbox = useAction(api.actions.scanInbox.scanInbox);
  const scanGmail = useAction(api.actions.scanGmail.scanGmail);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const fireScan = (days: number | null) => {
    const sinceDate = days != null
      ? formatDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
      : undefined;

    const scanArgs = {
      connectionId,
      sinceDate,
      untilDate: formatDate(new Date()),
      senderDomains: lastScanParams?.senderDomains,
    };

    const scanFn = provider === "google" ? scanGmail : scanInbox;
    scanFn(scanArgs).catch(() => toast.error("Failed to start scan"));
    toast.success("Scan started — progress will appear on the connection card");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <PillButton
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
      >
        Pull more
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </PillButton>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-1.5 z-50 min-w-[160px] rounded-lg border border-foreground/8 bg-popover shadow-lg overflow-hidden"
          >
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => fireScan(preset.days)}
                className="w-full text-left px-3 py-2 text-body-sm text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
            <div className="border-t border-foreground/6" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCustomRange();
              }}
              className="w-full text-left px-3 py-2 text-body-sm text-muted-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
            >
              Custom range...
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Derive a human-readable coverage label from scan params.
 */
export function getScanCoverageLabel(
  sinceDate: string | undefined,
  lastScanAt: number | undefined
): string {
  if (!lastScanAt) return "Not scanned";
  if (!sinceDate) return "Not scanned";

  const since = new Date(sinceDate);
  const now = new Date();
  const diffMs = now.getTime() - since.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= 16) return "Last 2 weeks";
  if (diffDays <= 35) return "Last month";
  if (diffDays <= 100) return "Last 3 months";
  if (diffDays <= 200) return "Last 6 months";

  // Older than 6 months — show formatted date
  const month = since.toLocaleString("en-US", { month: "short" });
  const year = since.getFullYear();
  return `Since ${month} ${year}`;
}
