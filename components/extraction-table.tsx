"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCw, X } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";

interface Extraction {
  _id: string;
  fileName?: string;
  extractionStatus: string;
  extractionError?: string;
  _creationTime: number;
  emailSubject?: string;
  emailFrom?: string;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  extracting: {
    label: "Extracting",
    className: "bg-amber-100 text-amber-700 animate-pulse",
  },
  error: {
    label: "Error",
    className: "bg-red-100 text-red-700",
  },
  pending: {
    label: "Pending",
    className: "bg-gray-100 text-gray-600",
  },
};

function RetryButton({ policyId }: { policyId: string }) {
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const [retrying, setRetrying] = useState(false);

  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try {
          await retryExtraction({ policyId: policyId as any });
        } finally {
          setRetrying(false);
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-label-sm font-medium text-amber-700 hover:border-amber-300 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50"
    >
      <RotateCw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
      {retrying ? "Retrying..." : "Retry"}
    </button>
  );
}

function DismissButton({ policyId }: { policyId: string }) {
  const dismiss = useMutation(api.policies.dismiss);
  const [dismissing, setDismissing] = useState(false);

  return (
    <button
      type="button"
      disabled={dismissing}
      onClick={async () => {
        setDismissing(true);
        try {
          await dismiss({ id: policyId as any });
        } finally {
          setDismissing(false);
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 text-label-sm font-medium text-muted-foreground hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer disabled:opacity-50"
    >
      <X className="w-3 h-3" />
      Dismiss
    </button>
  );
}

function ErrorLogDialog({
  error,
  open,
  onClose,
}: {
  error: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-lg border border-foreground/10 shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/6">
          <h3 className="!text-sm !font-medium !font-sans !text-foreground">Error Log</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-foreground/5 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="p-4">
          <pre className="text-label-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3 whitespace-pre-wrap break-words font-mono max-h-[300px] overflow-y-auto">
            {error}
          </pre>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ViewErrorButton({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-label-sm font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
      >
        View error
      </button>
      <ErrorLogDialog error={error} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ExtractionTable({
  extractions,
}: {
  extractions: Extraction[] | undefined;
}) {
  if (!extractions || extractions.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-12 text-center text-muted-foreground">
          No pending extractions. Documents will appear here when email
          attachments are being processed.
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Source Email
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Attachment
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                  Date
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={extractions.map((e) => e._id).join(",")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {extractions.map((extraction, i) => {
                  const badge = STATUS_BADGES[extraction.extractionStatus] || STATUS_BADGES.pending;
                  return (
                    <FadeIn
                      key={extraction._id}
                      as="tr"
                      when={true}
                      delay={i * 0.02}
                      duration={0.35}
                      direction="none"
                      className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <p className="text-body-sm text-foreground font-medium truncate max-w-[250px]">
                          {extraction.emailSubject || "—"}
                        </p>
                        <p className="text-label-sm text-muted-foreground/60 truncate max-w-[250px]">
                          {extraction.emailFrom || "Unknown sender"}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-body-sm text-muted-foreground whitespace-nowrap">
                        {extraction.fileName || "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          {extraction.extractionStatus === "error" && extraction.extractionError && (
                            <ViewErrorButton error={extraction.extractionError} />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-body-sm text-muted-foreground hidden md:table-cell whitespace-nowrap">
                        {formatDate(extraction._creationTime)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <RetryButton policyId={extraction._id} />
                          <DismissButton policyId={extraction._id} />
                        </div>
                      </td>
                    </FadeIn>
                  );
                })}
              </motion.tbody>
            </AnimatePresence>
          </table>
        </div>
        <div className="border-t border-foreground/[0.04] px-4 py-2 flex items-center justify-between bg-foreground/[0.01]">
          <p className="text-label-sm text-muted-foreground/60">
            {extractions.length} pending{" "}
            {extractions.length === 1 ? "extraction" : "extractions"}
          </p>
        </div>
      </div>
    </FadeIn>
  );
}
