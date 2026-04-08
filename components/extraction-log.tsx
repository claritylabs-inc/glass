"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCw } from "lucide-react";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";

interface LogEntry {
  _id: string;
  emailId?: string;
  fileId?: string;
  fileName?: string;
  carrier: string;
  policyNumber: string;
  insuredName?: string;
  summary?: string;
  policyTypes?: string[];
  policyType?: string;
  documentType?: string;
  extractionStatus: string;
  extractionError?: string;
  _creationTime: number;
  emailSubject?: string;
  emailFrom?: string;
  hasRawResponse?: boolean;
  hasRawMetadata?: boolean;
  isDemo?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  commercial_property: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  commercial_auto: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  non_owned_auto: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
  workers_comp: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  umbrella: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  excess_liability: "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
  professional_liability: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  cyber: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  epli: "bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400",
  directors_officers: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  fiduciary_liability: "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
  crime_fidelity: "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
  inland_marine: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  builders_risk: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400",
  environmental: "bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400",
  ocean_marine: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  surety: "bg-stone-100 dark:bg-stone-950/40 text-stone-700 dark:text-stone-400",
  product_liability: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  bop: "bg-slate-100 dark:bg-slate-950/40 text-slate-700 dark:text-slate-400",
  management_liability_package: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  property: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  other: "bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-400",
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ReExtractButton({ entry }: { entry: LogEntry }) {
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);
  const [running, setRunning] = useState(false);

  return (
    <button
      type="button"
      disabled={running}
      onClick={async () => {
        setRunning(true);
        try {
          await retryExtraction({ policyId: entry._id as Id<"policies">, mode: "full" });
        } finally {
          setRunning(false);
        }
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 dark:bg-white/[0.06] text-label-sm font-medium text-muted-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer disabled:opacity-50"
    >
      <RotateCw className="w-3 h-3" />
      {running ? "Re-extracting..." : "Re-extract"}
    </button>
  );
}

export function ExtractionLog({ entries }: { entries: LogEntry[] }) {
  const router = useRouter();
  if (!entries || entries.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">No completed extractions</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
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
                  Source
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
                        <p className="text-body-sm text-foreground font-medium truncate max-w-[250px]">
                          {entry.carrier === "Extracting..."
                            ? (entry.fileName ?? entry.emailSubject ?? "Unknown document")
                            : `${entry.carrier} ${entry.policyNumber !== "Extracting..." ? entry.policyNumber : ""}`}
                        </p>
                        <p className="text-label-sm text-muted-foreground/60 truncate max-w-[250px]">
                          {entry.carrier === "Extracting..."
                            ? (entry.emailFrom ?? "Dismissed before extraction completed")
                            : (entry.insuredName ?? entry.emailFrom ?? (entry.fileName ? "Uploaded file" : ""))}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {entry.documentType === "quote" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400">
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
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-label-sm font-medium bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400">
                              +{types.length - 1}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell whitespace-nowrap">
                        <p className="text-body-sm text-muted-foreground truncate max-w-[200px]">
                          {entry.emailSubject || entry.fileName || "—"}
                        </p>
                        {entry.emailFrom && (
                          <p className="text-label-sm text-muted-foreground/40 truncate max-w-[200px]">{entry.emailFrom}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isComplete && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400">
                              Complete
                            </span>
                          )}
                          {isDismissed && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400">
                              Dismissed
                            </span>
                          )}
                          {entry.isDemo && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
                              Demo
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-body-sm text-muted-foreground text-right hidden md:table-cell whitespace-nowrap">
                        {formatDate(entry._creationTime)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap hidden md:table-cell">
                        <div className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {(entry.fileId || entry.emailId) && !entry.isDemo && (
                            <ReExtractButton entry={entry} />
                          )}
                          {isComplete && (
                            <Link
                              href={`/policies/${entry._id}`}
                              className="px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 dark:bg-white/[0.06] text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors"
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
