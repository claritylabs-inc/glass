"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import { PillButton } from "@/components/ui/pill-button";
import { RotateCw, FileText, Sparkles } from "lucide-react";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface LogEntry {
  _id: string;
  emailId?: string;
  carrier: string;
  policyNumber: string;
  policyTypes?: string[];
  policyType?: string;
  documentType?: string;
  extractionStatus: string;
  _creationTime: number;
  emailSubject?: string;
  emailFrom?: string;
}

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 text-blue-700",
  workers_comp: "bg-orange-100 text-orange-700",
  commercial_auto: "bg-purple-100 text-purple-700",
  non_owned_auto: "bg-violet-100 text-violet-700",
  property: "bg-green-100 text-green-700",
  umbrella: "bg-sky-100 text-sky-700",
  professional_liability: "bg-amber-100 text-amber-700",
  cyber: "bg-red-100 text-red-700",
  epli: "bg-pink-100 text-pink-700",
  directors_officers: "bg-indigo-100 text-indigo-700",
  other: "bg-gray-100 text-gray-700",
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ReExtractButton({ policyId }: { policyId: string }) {
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);

  const handleReExtract = async (mode: "reparse" | "full") => {
    setOpen(false);
    setSyncing(true);
    try {
      await retryExtraction({ policyId: policyId as any, mode });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={syncing}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 text-label-sm font-medium text-muted-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer disabled:opacity-50"
      >
        <RotateCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Extracting..." : "Re-extract"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Re-extract Policy</DialogTitle>
            <DialogDescription>
              Choose how to re-extract policy data from this document.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => handleReExtract("reparse")}
              className="flex items-start gap-3 rounded-lg border border-foreground/8 p-3 text-left hover:bg-foreground/[0.02] hover:border-foreground/15 transition-colors cursor-pointer"
            >
              <FileText className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-body-sm font-medium text-foreground">Re-parse prior output</p>
                <p className="text-label-sm text-muted-foreground">
                  Re-extract fields from the saved AI response. Fast, no API call needed.
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleReExtract("full")}
              className="flex items-start gap-3 rounded-lg border border-foreground/8 p-3 text-left hover:bg-foreground/[0.02] hover:border-foreground/15 transition-colors cursor-pointer"
            >
              <Sparkles className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-body-sm font-medium text-foreground">Full AI re-extraction</p>
                <p className="text-label-sm text-muted-foreground">
                  Re-download the PDF and run a new AI extraction. Slower but may fix errors.
                </p>
              </div>
            </button>
          </div>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExtractionLog({ entries }: { entries: LogEntry[] }) {
  const router = useRouter();
  if (!entries || entries.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-12 text-center text-muted-foreground">
          No completed extractions yet.
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
                  Policy
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Type
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                  Source Email
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">
                  Date
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={entries.map((e) => e._id).join(",")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {entries.map((entry, i) => {
                  const types = entry.policyTypes ?? [entry.policyType ?? "other"];
                  const firstType = types[0];
                  const isComplete = entry.extractionStatus === "complete";
                  const isDismissed = entry.extractionStatus === "not_insurance";
                  return (
                    <FadeIn
                      key={entry._id}
                      as="tr"
                      when={true}
                      delay={i * 0.02}
                      duration={0.35}
                      direction="none"
                      className={`border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors ${isComplete ? "cursor-pointer" : ""}`}
                      onClick={() => isComplete && router.push(`/policies/${entry._id}`)}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <p className="text-body-sm text-foreground font-medium">
                          {entry.policyNumber}
                        </p>
                        <p className="text-label-sm text-muted-foreground/60">
                          {entry.carrier}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {entry.documentType === "quote" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-yellow-100 text-yellow-800">
                              Quote
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium ${
                              TYPE_COLORS[firstType] || TYPE_COLORS.other
                            }`}
                          >
                            {POLICY_TYPE_LABELS[firstType] || firstType}
                          </span>
                          {types.length > 1 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-label-sm font-medium bg-gray-100 text-gray-600">
                              +{types.length - 1}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell whitespace-nowrap">
                        <p className="text-body-sm text-muted-foreground truncate max-w-[200px]">
                          {entry.emailSubject || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {isComplete && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-green-100 text-green-700">
                            Complete
                          </span>
                        )}
                        {isDismissed && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-gray-100 text-gray-600">
                            Dismissed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-body-sm text-muted-foreground text-right hidden md:table-cell whitespace-nowrap">
                        {formatDate(entry._creationTime)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap hidden md:table-cell">
                        <div className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {entry.emailId && (
                            <ReExtractButton policyId={entry._id} />
                          )}
                          {isComplete && (
                            <Link
                              href={`/policies/${entry._id}`}
                              className="px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors"
                            >
                              View
                            </Link>
                          )}
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
            {entries.length} {entries.length === 1 ? "extraction" : "extractions"}
          </p>
        </div>
      </div>
    </FadeIn>
  );
}
