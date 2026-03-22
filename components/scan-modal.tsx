"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { X, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PillButton } from "@/components/ui/pill-button";
import { Id } from "@/convex/_generated/dataModel";

interface ScanModalProps {
  open: boolean;
  onClose: () => void;
  connectionId: Id<"emailConnections">;
  defaults?: {
    sinceDate?: string;
    untilDate?: string;
    senderDomains?: string[];
    lastScanAt?: number;
  };
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function ScanModal({ open, onClose, connectionId, defaults }: ScanModalProps) {
  const scanInbox = useAction(api.actions.scanInbox.scanInbox);

  const defaultSince = defaults?.sinceDate
    ?? (defaults?.lastScanAt
      ? formatDate(new Date(defaults.lastScanAt))
      : formatDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)));
  const defaultUntil = defaults?.untilDate ?? formatDate(new Date());

  const [sinceDate, setSinceDate] = useState(defaultSince);
  const [untilDate, setUntilDate] = useState(defaultUntil);
  const [senderDomains, setSenderDomains] = useState(
    defaults?.senderDomains?.join(", ") ?? ""
  );
  const [scanning, setScanning] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanning(true);
    try {
      const domains = senderDomains
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);

      await scanInbox({
        connectionId,
        sinceDate: sinceDate || undefined,
        untilDate: untilDate || undefined,
        senderDomains: domains.length > 0 ? domains : undefined,
      });
      onClose();
      toast.success("Inbox scan started");
    } catch {
      toast.error("Failed to start scan");
    } finally {
      setScanning(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative bg-popover rounded-xl border border-foreground/8 shadow-xl max-w-md w-full mx-4 p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="!mb-0">Scan Inbox</h3>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md hover:bg-foreground/5 text-muted-foreground transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Date Range */}
              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Date Range
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-label-sm text-muted-foreground/60 block mb-1">
                      From
                    </label>
                    <input
                      type="date"
                      value={sinceDate}
                      onChange={(e) => setSinceDate(e.target.value)}
                      className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-label-sm text-muted-foreground/60 block mb-1">
                      To
                    </label>
                    <input
                      type="date"
                      value={untilDate}
                      onChange={(e) => setUntilDate(e.target.value)}
                      className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Sender Filter */}
              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Sender Filter
                </label>
                <input
                  type="text"
                  value={senderDomains}
                  onChange={(e) => setSenderDomains(e.target.value)}
                  placeholder="@ajg.com, @marsh.com"
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
                <p className="text-label-sm text-muted-foreground/50 mt-1.5">
                  Only scan emails from these domains. Leave blank for all.
                </p>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <PillButton variant="secondary" onClick={onClose} disabled={scanning}>
                  Cancel
                </PillButton>
                <PillButton type="submit" disabled={scanning}>
                  {scanning ? (
                    <>Scanning...</>
                  ) : (
                    <>
                      <Search className="w-3.5 h-3.5" />
                      Start Scan
                    </>
                  )}
                </PillButton>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
