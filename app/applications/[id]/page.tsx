"use client";

import { use } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";
import {
  ArrowLeft,
  Download,
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
import { useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import type { Id } from "@/convex/_generated/dataModel";
import type { FormField } from "@/convex/lib/applicationTypes";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  extracting_fields: { label: "Extracting Fields", color: "bg-blue-50 text-blue-600" },
  filling_known: { label: "Auto-filling", color: "bg-blue-50 text-blue-600" },
  asking_questions: { label: "Asking Questions", color: "bg-amber-50 text-amber-600" },
  pending_confirmation: { label: "Pending Confirmation", color: "bg-orange-50 text-orange-600" },
  confirmed: { label: "Confirmed", color: "bg-emerald-50 text-emerald-600" },
  complete: { label: "Complete", color: "bg-emerald-50 text-emerald-600" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-500" };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const colors: Record<string, string> = {
    org_context: "bg-violet-50 text-violet-600",
    user_answer: "bg-emerald-50 text-emerald-600",
    inferred: "bg-amber-50 text-amber-600",
  };
  const labels: Record<string, string> = {
    org_context: "auto-filled",
    user_answer: "answered",
    inferred: "inferred",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap shrink-0 ${colors[source] ?? "bg-gray-100 text-gray-500"}`}>
      {labels[source] ?? source}
    </span>
  );
}

function FieldRow({ field }: { field: FormField }) {
  if (field.fieldType === "declaration") {
    const f = field as any;
    return (
      <div className="py-2.5">
        <p className="text-body-sm text-foreground">{f.text}</p>
        <div className="flex items-center gap-2 mt-1">
          {f.value ? (
            <span className={`text-label-sm font-medium ${f.value === "yes" ? "text-amber-600" : "text-emerald-600"}`}>
              {f.value.toUpperCase()}
            </span>
          ) : (
            <span className="text-label-sm text-muted-foreground/30 italic">Pending</span>
          )}
          <SourceBadge source={f.source} />
        </div>
        {f.explanation && (
          <p className="text-label-sm text-muted-foreground/60 mt-1 pl-3 border-l-2 border-foreground/6">
            {f.explanation}
          </p>
        )}
      </div>
    );
  }

  if (field.fieldType === "table") {
    const f = field as any;
    return (
      <div className="py-2.5">
        <div className="flex items-center gap-2">
          <p className="text-label-sm text-muted-foreground/60">{f.label}</p>
          <SourceBadge source={f.source} />
        </div>
        {f.rows && f.rows.length > 0 ? (
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full text-xs border border-foreground/6 rounded">
              <thead>
                <tr className="bg-foreground/[0.02]">
                  {f.columns?.map((col: any) => (
                    <th key={col.name} className="text-left px-2 py-1 text-muted-foreground/50 font-medium border-b border-foreground/6">
                      {col.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.rows.map((row: Record<string, string>, i: number) => (
                  <tr key={i} className="border-b border-foreground/6 last:border-0">
                    {f.columns?.map((col: any) => (
                      <td key={col.name} className="px-2 py-1">
                        {row[col.name] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-label-sm text-muted-foreground/30 mt-1 italic">No data</p>
        )}
      </div>
    );
  }

  // Simple field
  const f = field as any;
  return (
    <div className="flex items-baseline gap-6 py-2">
      <span className="text-body-sm text-muted-foreground shrink-0 w-56 sm:w-64">{f.label}</span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 flex-1 min-w-0">
        {f.value ? (
          <span className="text-body-sm text-foreground">{f.value}</span>
        ) : (
          <span className="text-body-sm text-muted-foreground/30 italic">Pending</span>
        )}
        <SourceBadge source={f.source} />
      </div>
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
  return (
    <>
      {sourceFileUrl && (
        <PillButton
          variant="icon"
          label="Source PDF"
          onClick={() => window.open(sourceFileUrl, "_blank")}
        >
          <Download className="w-4 h-4" />
        </PillButton>
      )}
      {summaryFileUrl && (
        <PillButton
          variant="icon"
          label="Summary PDF"
          onClick={() => window.open(summaryFileUrl, "_blank")}
        >
          <FileText className="w-4 h-4" />
        </PillButton>
      )}
      {filledFileUrl && (
        <PillButton
          variant="icon"
          label="Filled PDF"
          onClick={() => window.open(filledFileUrl, "_blank")}
        >
          <FileCheck className="w-4 h-4" />
        </PillButton>
      )}
      {canFill && (
        <PillButton
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
        <PillButton variant="icon" label="Retry" onClick={onRetry}>
          <RotateCcw className="w-4 h-4" />
        </PillButton>
      )}
      {isActive && (
        <PillButton variant="icon" label="Cancel" onClick={onCancel}>
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

  if (session === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
        </div>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-body-sm text-muted-foreground/50">Application not found</p>
        </div>
      </div>
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

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 pb-32 md:pb-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            {/* Back + header */}
            <div className="mb-6">
              <button
                type="button"
                onClick={() => router.push("/applications")}
                className="inline-flex items-center gap-1 text-label-sm text-muted-foreground/50 hover:text-foreground mb-3 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Applications
              </button>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="!mb-1 truncate">
                    {session.applicationTitle ?? session.sourceFileName}
                  </h1>
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusBadge status={session.status} />
                    <span className="text-label-sm text-muted-foreground/40">
                      {dayjs(session._creationTime).format("MMM D, YYYY h:mm A")}
                    </span>
                  </div>
                </div>
                {/* Desktop action buttons */}
                <div className="hidden md:flex items-center gap-2 shrink-0">
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
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Progress + batch overview card */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-white/60 p-4 mb-6">
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
                      return (
                        <div
                          key={i}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors ${
                            batch.complete
                              ? "bg-emerald-50 text-emerald-600"
                              : isCurrent
                                ? "bg-amber-50 text-amber-600 ring-1 ring-amber-200"
                                : "bg-foreground/[0.03] text-muted-foreground/40"
                          }`}
                        >
                          {batch.complete ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : isCurrent ? (
                            <CircleDot className="w-3 h-3" />
                          ) : (
                            <Circle className="w-3 h-3" />
                          )}
                          <span>
                            {batch.fieldIds.length}
                            {batch.complete && batch.answeredFieldIds.length < batch.fieldIds.length
                              ? ` (${batch.answeredFieldIds.length})`
                              : ""}
                          </span>
                        </div>
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
                    className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-4 py-3 bg-foreground/[0.015] border-b border-foreground/5">
                      {sectionComplete ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                      )}
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
                        <FieldRow key={field.id} field={field} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </FadeIn>
        </div>
      </main>

      {/* Mobile footer */}
      <FixedMobileFooter>
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
      </FixedMobileFooter>
    </div>
  );
}
