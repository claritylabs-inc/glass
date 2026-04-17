"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCw } from "lucide-react";
import { POLICY_TYPE_LABELS, POLICY_TYPE_COLORS } from "@/convex/lib/policyTypes";
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
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-foreground/12 bg-card text-label-sm font-medium text-muted-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer disabled:opacity-50"
    >
      <RotateCw className="w-3 h-3" />
      {running ? "Re-extracting..." : "Re-extract"}
    </button>
  );
}

export function ExtractionLog({ entries }: { entries: LogEntry[] }) {
  const router = useRouter();
  if (!entries || entries.length === 0) return null;

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <table className="w-full text-left md:min-w-[700px]">
        <thead>
          <tr className="bg-foreground/[0.02]">
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap">
              Policy
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap">
              Type
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap hidden md:table-cell">
              Source
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap">
              Status
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap text-right hidden md:table-cell">
              Date
            </th>
            <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground  whitespace-nowrap text-right hidden md:table-cell">
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
                              POLICY_TYPE_COLORS[firstType] || POLICY_TYPE_COLORS.other
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
                              className="px-2.5 py-1 rounded-md border border-foreground/12 bg-card text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors"
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
  );
}
