"use client";

import { use, useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import {
  ArrowLeft,
  FileInput,
  FileText,
  FileCheck,
  Loader2,
  X,
  CheckCircle,
  RotateCcw,
  Clock,
  CircleDot,
  Circle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { usePdf } from "@/components/pdf-context";
import { usePageContext } from "@/hooks/use-page-context";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import dayjs from "dayjs";
import type { Id } from "@/convex/_generated/dataModel";
import type { FormField } from "@/convex/lib/applicationTypes";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  extracting_fields: { label: "Extracting Fields", color: "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400" },
  filling_known: { label: "Auto-filling", color: "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400" },
  asking_questions: { label: "Asking Questions", color: "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" },
  pending_confirmation: { label: "Pending Confirmation", color: "bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400" },
  confirmed: { label: "Confirmed", color: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" },
  complete: { label: "Complete", color: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400" };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}

function EditableField({
  field,
  sessionId,
}: {
  field: FormField;
  sessionId: Id<"applicationSessions">;
}) {
  const updateField = useMutation(api.applicationSessions.updateFieldValue);
  const f = field as any;
  const label = f.label ?? f.text ?? field.id;
  const value = f.value ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save() {
    const trimmed = draft.trim();
    if (trimmed !== value) {
      try {
        await updateField({ id: sessionId, fieldId: field.id, value: trimmed });
      } catch {
        toast.error("Failed to save");
        setDraft(value);
      }
    }
    setEditing(false);
  }

  const isLong = value.length > 80 || field.fieldType === "declaration";

  // Declaration fields
  if (field.fieldType === "declaration") {
    return (
      <div className="py-3">
        <p className="text-[11px] text-muted-foreground/50 leading-relaxed mb-1">{f.text}</p>
        {editing ? (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
            placeholder="Yes / No"
            className="w-full text-body-sm font-medium text-foreground bg-transparent border-b border-foreground/15 focus:border-foreground/30 outline-none pb-0.5 transition-colors"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-left cursor-text"
          >
            {value ? (
              <span className={`text-body-sm font-medium ${f.value === "yes" ? "text-amber-600" : f.value === "no" ? "text-emerald-600" : "text-foreground"}`}>
                {value}
              </span>
            ) : (
              <span className="text-body-sm text-muted-foreground/25 italic">Not answered</span>
            )}
          </button>
        )}
        {f.explanation && (
          <p className="text-[11px] text-muted-foreground/40 mt-1">{f.explanation}</p>
        )}
      </div>
    );
  }

  // Table fields — show as sub-fields
  if (field.fieldType === "table") {
    return (
      <div className="py-3">
        <p className="text-[11px] text-muted-foreground/50 mb-2">{label}</p>
        {f.rows && f.rows.length > 0 ? (
          <div className="space-y-2">
            {f.rows.map((row: Record<string, string>, i: number) => (
              <div key={i} className="pl-3 border-l-2 border-foreground/6 space-y-1">
                {f.columns?.map((col: any) => (
                  <div key={col.name}>
                    <span className="text-[10px] text-muted-foreground/35">{col.name}</span>
                    <p className="text-body-sm text-foreground">{row[col.name] || "—"}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-body-sm text-muted-foreground/25 italic">No data</span>
        )}
      </div>
    );
  }

  // Simple field — Q&A text form style
  return (
    <div className="py-3">
      <p className="text-[11px] text-muted-foreground/50 mb-0.5">{label}</p>
      {editing ? (
        isLong ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
            rows={3}
            className="w-full text-body-sm text-foreground bg-transparent border-b border-foreground/15 focus:border-foreground/30 outline-none pb-0.5 resize-none transition-colors"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
            className="w-full text-body-sm text-foreground bg-transparent border-b border-foreground/15 focus:border-foreground/30 outline-none pb-0.5 transition-colors"
          />
        )
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-left cursor-text w-full"
        >
          {value ? (
            <p className="text-body-sm text-foreground">{value}</p>
          ) : (
            <p className="text-body-sm text-muted-foreground/25 italic">Not answered</p>
          )}
        </button>
      )}
    </div>
  );
}

function ActionButtons({
  sourceFileUrl,
  summaryFileUrl,
  filledFileUrl,
  hasError,
  isActive,
  canFill,
  isFilling,
  onRetry,
  onCancel,
  onFill,
}: {
  sourceFileUrl?: string | null;
  summaryFileUrl?: string | null;
  filledFileUrl?: string | null;
  hasError: boolean;
  isActive: boolean;
  canFill: boolean;
  isFilling: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onFill: () => void;
}) {
  const { openWithUrl } = usePdf();
  return (
    <>
      {sourceFileUrl && (
        <PillButton
          size="compact"
          variant="icon"
          label="Original Form"
          onClick={() => sourceFileUrl && openWithUrl(sourceFileUrl)}
        >
          <FileInput className="w-4 h-4" />
        </PillButton>
      )}
      {summaryFileUrl && (
        <PillButton
          size="compact"
          variant="icon"
          label="Summary"
          onClick={() => summaryFileUrl && openWithUrl(summaryFileUrl)}
        >
          <FileText className="w-4 h-4" />
        </PillButton>
      )}
      {filledFileUrl && (
        <PillButton
          size="compact"
          variant="icon"
          label="Filled PDF"
          onClick={() => filledFileUrl && openWithUrl(filledFileUrl)}
        >
          <FileCheck className="w-4 h-4" />
        </PillButton>
      )}
      {canFill && (
        <PillButton
          size="compact"
          variant="secondary"
          onClick={onFill}
          disabled={isFilling}
        >
          {isFilling ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FileCheck className="w-3.5 h-3.5" />
          )}
          {isFilling ? "Filling..." : "Fill Application"}
        </PillButton>
      )}
      {hasError && (
        <PillButton size="compact" variant="icon" label="Retry" onClick={onRetry}>
          <RotateCcw className="w-4 h-4" />
        </PillButton>
      )}
      {isActive && (
        <PillButton size="compact" variant="icon" label="Cancel" onClick={onCancel}>
          <X className="w-4 h-4" />
        </PillButton>
      )}
    </>
  );
}

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const sessionId = id as Id<"applicationSessions">;
  const router = useRouter();
  const session = useQuery(api.applicationSessions.get, { id: sessionId });
  const sourceFileUrl = useQuery(api.applicationSessions.getSourceFileUrl, { id: sessionId });
  const summaryFileUrl = useQuery(api.applicationSessions.getSummaryFileUrl, { id: sessionId });
  const filledFileUrl = useQuery(api.applicationSessions.getFilledFileUrl, { id: sessionId });
  const cancelSession = useMutation(api.applicationSessions.cancel);
  const retryApp = useAction(api.actions.processApplication.retryApplication);
  const fillApp = useAction(api.actions.processApplication.fillApplicationPdf);
  const [isFilling, setIsFilling] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "threads">("details");
  const { setPageContext } = usePageContext();
  useEffect(() => {
    if (session) {
      setPageContext({
        pageType: "application",
        entityId: session._id,
        summary: `Application: ${session.applicationTitle ?? session.sourceFileName}`,
      });
    }
    return () => setPageContext(null);
  }, [session, setPageContext]);

  if (session === undefined) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
        </div>
      </AppShell>
    );
  }

  if (session === null) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <p className="text-body-sm text-muted-foreground/50">Application not found</p>
        </div>
      </AppShell>
    );
  }

  const fields: FormField[] = session.parsedFields ?? [];
  const isActive = !["complete", "cancelled"].includes(session.status);

  // Group fields by section
  const sections = new Map<string, FormField[]>();
  for (const field of fields) {
    const existing = sections.get(field.section) ?? [];
    existing.push(field);
    sections.set(field.section, existing);
  }

  function getBatchTopic(batch: any): string {
    const sectionCounts = new Map<string, number>();
    for (const fid of batch.fieldIds) {
      const f = fields.find((field) => field.id === fid);
      if (f) sectionCounts.set(f.section, (sectionCounts.get(f.section) ?? 0) + 1);
    }
    let best = "";
    let bestCount = 0;
    for (const [sec, count] of sectionCounts) {
      if (count > bestCount) { best = sec; bestCount = count; }
    }
    return best || `Batch ${batch.batchIndex + 1}`;
  }

  const filledCount = fields.filter((f) => {
    if (f.fieldType === "table") return (f as any).rows?.length > 0;
    return !!(f as any).value;
  }).length;

  const pct = fields.length > 0 ? Math.round((filledCount / fields.length) * 100) : 0;

  async function handleRetry() {
    try {
      const result = await retryApp({ sessionId });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("Retrying application processing...");
      }
    } catch {
      toast.error("Failed to retry");
    }
  }

  async function handleCancel() {
    try {
      await cancelSession({ id: sessionId });
      toast.success("Application cancelled");
    } catch {
      toast.error("Failed to cancel");
    }
  }

  async function handleFill() {
    setIsFilling(true);
    try {
      const result = await fillApp({ sessionId });
      if (result?.error) {
        toast.error(result.error);
      } else {
        const modeLabel = result.mode === "acroform" ? "form fill" : result.mode === "overlay" ? "text overlay" : "standalone document";
        toast.success(`Filled PDF generated — ${result.fieldsMapped} fields via ${modeLabel}`);
      }
    } catch {
      toast.error("Failed to fill application PDF");
    } finally {
      setIsFilling(false);
    }
  }

  const headerActions = (
    <ActionButtons
      sourceFileUrl={sourceFileUrl}
      summaryFileUrl={summaryFileUrl}
      filledFileUrl={filledFileUrl}
      hasError={!!session.error}
      isActive={isActive}
      canFill={!filledFileUrl && ["complete", "confirmed"].includes(session.status)}
      isFilling={isFilling}
      onRetry={handleRetry}
      onCancel={handleCancel}
      onFill={handleFill}
    />
  );

  const threadId = session.threadId ?? session.conversationId;

  return (
    <AppShell breadcrumbDetail={session.applicationTitle ?? session.sourceFileName} actions={headerActions}>
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <Link
                href="/applications"
                className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to applications
              </Link>
              <h1 className="!mb-0">{session.applicationTitle ?? session.sourceFileName}</h1>
              <div className="flex items-center gap-3 flex-wrap mt-1">
                <StatusBadge status={session.status} />
                <span className="text-label-sm text-muted-foreground/40">
                  {dayjs(session._creationTime).format("MMM D, YYYY h:mm A")}
                </span>
              </div>
            </div>
          </FadeIn>

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-foreground/6 mb-6">
            {([
              { id: "details" as const, label: "Details" },
              { id: "threads" as const, label: "Threads" },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground/70"
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="app-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>

          {activeTab === "details" && (<>
          {/* Progress + batch overview card */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-4 mb-6">
              {/* Progress bar */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-label-sm text-muted-foreground/60">
                  Fields completed
                </span>
                <span className="text-body-sm font-medium tabular-nums">
                  {filledCount} / {fields.length}
                  <span className="text-muted-foreground/30 ml-1.5 text-[11px] font-normal">
                    ({pct}%)
                  </span>
                </span>
              </div>
              <div className="h-2 bg-foreground/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: pct === 100
                      ? "rgb(16 185 129)" // emerald-500
                      : pct > 50
                        ? "rgb(245 158 11)" // amber-500
                        : "rgba(17, 24, 39, 0.2)",
                  }}
                />
              </div>
              {session.error && (
                <p className="text-label-sm text-red-500 mt-2">{session.error}</p>
              )}

              {/* Inline batch timeline */}
              {session.parsedBatches && session.parsedBatches.length > 0 && (
                <div className="mt-4 pt-3 border-t border-foreground/5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {session.parsedBatches.map((batch: any, i: number) => {
                      const isCurrent = i === (session.currentBatchIndex ?? 0) && !batch.complete && session.status === "asking_questions";
                      const topic = getBatchTopic(batch);
                      return (
                        <motion.div
                          key={i}
                          initial={false}
                          whileHover="hover"
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors cursor-default ${
                            batch.complete
                              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                              : isCurrent
                                ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-900/50"
                                : "bg-foreground/[0.03] text-muted-foreground/40"
                          }`}
                          title={topic}
                        >
                          {batch.complete ? (
                            <CheckCircle className="w-3 h-3 shrink-0" />
                          ) : isCurrent ? (
                            <CircleDot className="w-3 h-3 shrink-0" />
                          ) : (
                            <Circle className="w-3 h-3 shrink-0" />
                          )}
                          <span className="shrink-0">
                            {batch.fieldIds.length}
                          </span>
                          <AnimatePresence>
                            <motion.span
                              variants={{
                                hover: { width: "auto", opacity: 1, marginLeft: 2 },
                              }}
                              initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                              className="overflow-hidden whitespace-nowrap"
                            >
                              {topic}
                            </motion.span>
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                    <span className="text-[11px] text-muted-foreground/30 ml-1">
                      {session.parsedBatches.filter((b: any) => b.complete).length}/{session.parsedBatches.length} sections
                    </span>
                  </div>
                </div>
              )}
            </div>
          </FadeIn>

          {/* Fields by section */}
          <FadeIn when={true} staggerIndex={2} duration={0.6}>
            <div className="space-y-4">
              {Array.from(sections).map(([sectionName, sectionFields]) => {
                const sectionFilled = sectionFields.filter((f) => {
                  if (f.fieldType === "table") return (f as any).rows?.length > 0;
                  return !!(f as any).value;
                }).length;
                const sectionComplete = sectionFilled === sectionFields.length;

                return (
                  <div
                    key={sectionName}
                    className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-4 py-3 bg-foreground/[0.015] border-b border-foreground/5">
                      <h3 className="text-body-sm font-semibold !mb-0 flex-1">
                        {sectionName}
                      </h3>
                      <span className={`text-[11px] font-medium tabular-nums ${
                        sectionComplete ? "text-emerald-500" : "text-muted-foreground/30"
                      }`}>
                        {sectionFilled}/{sectionFields.length}
                      </span>
                    </div>
                    <div className="px-4 divide-y divide-foreground/5">
                      {sectionFields.map((field) => (
                        <EditableField key={field.id} field={field} sessionId={sessionId} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </FadeIn>
          </>)}

          {activeTab === "threads" && (
            <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-12 text-center">
              {threadId ? (
                <>
                  <MessageSquare className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
                  <p className="text-body-sm text-muted-foreground/50 mb-3">This application has an associated email thread.</p>
                  <Link
                    href={`/agent/thread/${threadId}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-body-sm font-medium hover:bg-foreground/90 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    View Thread
                  </Link>
                </>
              ) : (
                <>
                  <MessageSquare className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
                  <p className="text-body-sm text-muted-foreground/50 mb-1">No threads for this application</p>
                  <p className="text-label-sm text-muted-foreground/30">
                    Email threads related to this application will appear here.
                  </p>
                </>
              )}
            </div>
          )}
    </AppShell>
  );
}
