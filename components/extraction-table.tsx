"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import { PillButton } from "@/components/ui/pill-button";
import { RotateCw, X } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
          await retryExtraction({ policyId: policyId as any, mode: "full" });
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Error Log</DialogTitle>
          </DialogHeader>
          <pre className="text-label-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3 whitespace-pre-wrap break-words font-mono max-h-[300px] overflow-y-auto">
            {error}
          </pre>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setOpen(false)}>
              Close
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          <table className="w-full text-left md:min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Source Email
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">
                  Attachment
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                  Date
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">
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
                      <td className="px-4 py-2.5 text-body-sm text-muted-foreground whitespace-nowrap hidden sm:table-cell">
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
                      <td className="px-4 py-2.5 text-right whitespace-nowrap hidden md:table-cell">
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
