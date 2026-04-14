"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { usePaginatedQuery, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn } from "@/components/ui/fade-in";
import {
  Paperclip,
  Search,
  ShieldCheck,
  ShieldX,
  RotateCcw,
  FileDown,
  Loader2,
} from "lucide-react";

type ClassificationFilter = "all" | "insurance" | "not_insurance" | "unclassified";

const PAGE_SIZE = 50;

export function EmailReviewTable({
  connectionId,
}: {
  connectionId: Id<"emailConnections">;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.emails.listPaginated,
    { connectionId },
    { initialNumItems: PAGE_SIZE }
  );
  const totalCount = useQuery(api.emails.count, { connectionId });
  const emailIdsWithPolicies = useQuery(api.policies.emailIdsWithPolicies);
  const updateClassification = useMutation(api.emails.updateClassification);
  const resetProcessed = useMutation(api.emails.resetProcessed);
  const triggerExtraction = useMutation(api.emails.triggerExtraction);

  const [filter, setFilter] = useState<ClassificationFilter>("all");
  const [search, setSearch] = useState("");

  const policyEmailIds = useMemo(
    () => new Set(emailIdsWithPolicies ?? []),
    [emailIdsWithPolicies]
  );

  const filtered = useMemo(() => {
    if (!results) return [];
    let list = results;

    if (filter === "insurance") {
      list = list.filter((e) => e.isInsuranceRelated === true);
    } else if (filter === "not_insurance") {
      list = list.filter((e) => e.isInsuranceRelated === false);
    } else if (filter === "unclassified") {
      list = list.filter(
        (e) => e.isInsuranceRelated === undefined || e.isInsuranceRelated === null
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.subject.toLowerCase().includes(q) ||
          e.from.toLowerCase().includes(q)
      );
    }

    return list;
  }, [results, filter, search]);

  // Infinite scroll sentinel — only trigger when CanLoadMore (not while loading)
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status !== "CanLoadMore") return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && status === "CanLoadMore") {
          loadMore(PAGE_SIZE);
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [status, loadMore]);

  const handleClassify = async (
    id: Id<"emails">,
    isInsuranceRelated: boolean
  ) => {
    try {
      await updateClassification({ id, isInsuranceRelated });
      toast.success(
        isInsuranceRelated ? "Marked as insurance" : "Marked as not insurance"
      );
    } catch {
      toast.error("Failed to update classification");
    }
  };

  const handleReset = async (id: Id<"emails">) => {
    try {
      await resetProcessed({ id });
      toast.success("Email reset for re-classification");
    } catch {
      toast.error("Failed to reset email");
    }
  };

  const handleExtract = async (id: Id<"emails">) => {
    try {
      await triggerExtraction({ id });
      toast.success("Extraction started");
    } catch {
      toast.error("Failed to trigger extraction");
    }
  };

  const FILTERS: { value: ClassificationFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "insurance", label: "Insurance" },
    { value: "not_insurance", label: "Not Insurance" },
    { value: "unclassified", label: "Unclassified" },
  ];

  if (status === "LoadingFirstPage") {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1 rounded-full text-label-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-foreground text-background"
                : "bg-foreground/6 text-muted-foreground hover:bg-foreground/10"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search subject or sender..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/20 w-64"
          />
        </div>
      </div>

      {/* Summary */}
      <p className="text-label-sm text-muted-foreground">
        {filter !== "all" || search
          ? `${filtered.length} of ${totalCount ?? "..."} emails (${filter.replace("_", " ")})`
          : `${totalCount ?? "..."} emails`}
      </p>

      {/* Table */}
      {filtered.length === 0 && status !== "CanLoadMore" ? (
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">
            {search ? "No emails match your search" : "No emails found"}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-foreground/6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-foreground/6 bg-foreground/[0.02]">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    Subject / From
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Date
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-muted-foreground w-10">
                    <Paperclip className="w-3.5 h-3.5 mx-auto" />
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    Classification
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">
                    Reason
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((email, i) => {
                  const hasPolicy = policyEmailIds.has(email._id);
                  const isInsurance = email.isInsuranceRelated === true;
                  const isNotInsurance = email.isInsuranceRelated === false;
                  const isUnclassified =
                    email.isInsuranceRelated === undefined ||
                    email.isInsuranceRelated === null;
                  const canExtract =
                    isInsurance && email.hasAttachments && !hasPolicy;

                  return (
                    <FadeIn
                      key={email._id}
                      when={true}
                      staggerIndex={i % PAGE_SIZE}
                      duration={0.3}
                      as="tr"
                      className="border-b border-foreground/4 last:border-b-0 hover:bg-foreground/[0.02] transition-colors"
                    >
                      <td className="px-3 py-2 max-w-xs">
                        <p className="font-medium text-foreground truncate">
                          {email.subject || "(no subject)"}
                        </p>
                        <p className="text-label-sm text-muted-foreground/60 truncate">
                          {email.from}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(email.date)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {email.hasAttachments && (
                          <Paperclip className="w-3.5 h-3.5 text-muted-foreground/50 mx-auto" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <ClassificationBadge
                          isInsurance={isInsurance}
                          isNotInsurance={isNotInsurance}
                          isUnclassified={isUnclassified}
                          confidence={email.classificationConfidence}
                        />
                      </td>
                      <td className="px-3 py-2 hidden lg:table-cell max-w-[200px]">
                        <p className="text-label-sm text-muted-foreground/60 truncate">
                          {email.classificationReason || "—"}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        {email.processed ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                            Processed
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
                            Pending
                          </span>
                        )}
                        {hasPolicy && (
                          <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                            Has Policy
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {isInsurance || isUnclassified ? (
                            <PillButton
                              size="compact"
                              variant="secondary"
                              onClick={() => handleClassify(email._id, false)}
                              title="Mark as Not Insurance"
                            >
                              <ShieldX className="w-3 h-3" />
                              Not Ins.
                            </PillButton>
                          ) : (
                            <PillButton
                              size="compact"
                              variant="secondary"
                              onClick={() => handleClassify(email._id, true)}
                              title="Mark as Insurance"
                            >
                              <ShieldCheck className="w-3 h-3" />
                              Insurance
                            </PillButton>
                          )}
                          {canExtract && (
                            <PillButton
                              size="compact"
                              variant="primary"
                              onClick={() => handleExtract(email._id)}
                              title="Trigger extraction"
                            >
                              <FileDown className="w-3 h-3" />
                              Extract
                            </PillButton>
                          )}
                          {email.processed && (
                            <PillButton
                              size="compact"
                              variant="secondary"
                              onClick={() => handleReset(email._id)}
                              title="Reset for re-classification"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Reset
                            </PillButton>
                          )}
                        </div>
                      </td>
                    </FadeIn>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Infinite scroll sentinel + loading indicator */}
          <div ref={sentinelRef} className="h-1" />
          {status === "LoadingMore" && (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-label-sm">Loading more emails...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClassificationBadge({
  isInsurance,
  isNotInsurance,
  isUnclassified,
  confidence,
}: {
  isInsurance: boolean;
  isNotInsurance: boolean;
  isUnclassified: boolean;
  confidence?: number;
}) {
  const tooltip = confidence != null ? `Confidence: ${Math.round(confidence * 100)}%` : undefined;

  if (isInsurance) {
    return (
      <span
        title={tooltip}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
      >
        Insurance
      </span>
    );
  }
  if (isNotInsurance) {
    return (
      <span
        title={tooltip}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-zinc-100 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400"
      >
        Not Insurance
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">
      Unclassified
    </span>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
