"use client";

import { useCallback, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Copy, Loader2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { ExtractionCards } from "@/app/policies/[id]/extraction-panel";
import type { SourceSpanDoc } from "@/app/policies/[id]/source-provenance";
import { OperatorSidebar } from "../operator-sidebar";
import {
  useCachedOperatorCurrent,
  useCachedOperatorExtractionTraceDetail,
  useCachedOperatorExtractionTraces,
} from "@/lib/sync/operator-cached-queries";

type TraceStatus = "running" | "complete" | "error" | "cancelled";
type TraceRow = {
  traceId: string;
  policyId: string;
  orgId: string;
  orgName: string;
  policyLabel: string;
  fileName?: string;
  documentType?: string;
  status: TraceStatus;
  trigger?: string;
  startedAt: number;
  completedAt?: number;
  lastEventAt?: number;
  totalDurationMs?: number;
  modelCallCount?: number;
  modelDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  slowestLabel?: string;
  slowestKind?: string;
  slowestDurationMs?: number;
  error?: string;
};
type TraceEvent = {
  _id: string;
  kind: "session" | "phase" | "log" | "model_call" | "embedding_batch" | "worker" | "artifact";
  timestamp: number;
  phase?: string;
  level?: string;
  message?: string;
  label?: string;
  task?: string;
  taskKind?: string;
  provider?: string;
  model?: string;
  routeSource?: string;
  transport?: string;
  attempt?: number;
  status?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  details?: unknown;
};
type ModelCallDebugDetails = {
  purpose?: string;
  callKind?: string;
  task?: string;
  taskKind?: string;
  maxOutputTokens?: number;
  systemPreview?: string;
  promptPreview?: string;
  outputPreview?: string;
  outputKind?: string;
  inputSummary?: {
    hasPdfBase64?: boolean;
    pdfBase64Chars?: number;
    hasPdfUrl?: boolean;
    pdfUrl?: string;
    hasPdfBytes?: boolean;
    pdfBytes?: number;
    fileId?: string;
    mimeType?: string;
    images?: Array<{ mimeType?: string; base64Chars?: number }>;
  };
};
type TraceDetail = {
  session: TraceRow;
  policy?: Record<string, unknown> | null;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string | null;
  events: TraceEvent[];
};
type TracePanelTab = "summary" | "extracted" | "timeline" | "timing" | "models" | "log";
const TRACE_PANEL_TABS = ["summary", "extracted", "timeline", "timing", "models", "log"] as const;

const ALL = "__all__";
const STATUS_LABELS: Record<string, string> = {
  [ALL]: "All statuses",
  running: "Running",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled",
};
const RANGE_LABELS: Record<"24h" | "7d" | "30d" | "90d", string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

function formatDuration(ms?: number) {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatTokens(input?: number, output?: number) {
  const total = (input ?? 0) + (output ?? 0);
  if (!total) return "—";
  return `${total.toLocaleString()} (${(input ?? 0).toLocaleString()} in / ${(output ?? 0).toLocaleString()} out)`;
}

function formatCompactTokens(input?: number, output?: number) {
  const total = (input ?? 0) + (output ?? 0);
  if (!total) return "—";
  if (total >= 1000) return `${Math.round(total / 1000).toLocaleString()}k`;
  return total.toLocaleString();
}

function statusVariant(status: TraceStatus): "default" | "secondary" | "destructive" {
  if (status === "complete") return "default";
  if (status === "error" || status === "cancelled") return "destructive";
  return "secondary";
}

function parseTracePanelTab(value: string | null): TracePanelTab {
  return TRACE_PANEL_TABS.includes(value as TracePanelTab) ? value as TracePanelTab : "summary";
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-b border-foreground/6 px-3 py-2.5 last:border-b-0">
      <dt className="text-label-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-body-sm text-foreground">{value}</dd>
    </div>
  );
}

function humanizeTaskKind(value?: string) {
  if (!value) return undefined;
  const labels: Record<string, string> = {
    extraction_classify: "Classify document",
    extraction_form_inventory: "Extract form inventory",
    extraction_page_map: "Map policy pages",
    extraction_focused: "Extract policy fields",
    extraction_long_list: "Extract long policy lists",
    extraction_referential_lookup: "Resolve policy references",
    extraction_review: "Review extraction evidence",
    extraction_summary: "Summarize extracted policy",
    extraction_format: "Format extracted policy",
    query_attachment: "Read attachment",
    query_classify: "Classify question",
    query_reason: "Reason over documents",
    query_verify: "Verify answer evidence",
    query_respond: "Write answer",
    application_classify: "Classify application",
    application_extract_fields: "Extract application fields",
    application_auto_fill: "Autofill application",
    application_lookup: "Look up application context",
    application_parse_answers: "Parse application answers",
    application_batch: "Generate application batch",
    application_email: "Draft application email",
    application_pdf_mapping: "Map application PDF",
    pce_impact_analysis: "Analyze policy change",
    pce_reply_parse: "Parse policy-change reply",
    pce_packet_generation: "Generate policy-change packet",
    extraction: "Extract policy structure",
    classification: "Classify document",
    chat: "Analyze chat context",
    application_authoring: "Process application",
    analysis: "Run analysis",
  };
  return labels[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modelCallTitle(event: TraceEvent) {
  const raw = event.label ?? "";
  if (raw && !/^(external\s+)?generate(Object|Text)$/i.test(raw)) return raw;
  return humanizeTaskKind(event.taskKind) ?? humanizeTaskKind(event.task) ?? "Model call";
}

function eventTitle(event: TraceEvent) {
  if (event.kind === "model_call") return modelCallTitle(event);
  return event.label ?? humanizeTaskKind(event.taskKind) ?? event.phase ?? event.message ?? event.kind;
}

function eventCaption(event: TraceEvent) {
  if (event.kind === "model_call") {
    return [
      [event.provider, event.model].filter(Boolean).join(" / "),
      event.taskKind,
      event.status,
    ].filter(Boolean).join(" · ");
  }
  return [event.kind, event.status].filter(Boolean).join(" · ");
}

type TimingRow = {
  id: string;
  label: string;
  caption: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  status?: string;
};

type TimelineRow = {
  id: string;
  event: TraceEvent;
  parentId?: string;
  label: string;
  caption: string;
  kind: TraceEvent["kind"];
  level: number;
  childCount?: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  status?: string;
};

function modelGroupKey(event: TraceEvent) {
  return [
    eventTitle(event),
    event.provider ?? "unknown",
    event.model ?? "unknown",
  ].join("||");
}

function buildModelTimingRows(events: TraceEvent[]): TimingRow[] {
  const groups = new Map<string, TimingRow & { count: number }>();
  for (const event of events) {
    const durationMs = event.durationMs ?? 0;
    if (durationMs <= 0) continue;
    const key = modelGroupKey(event);
    const existing = groups.get(key);
    const caption = [
      [event.provider, event.model].filter(Boolean).join(" / ") || "model",
      event.taskKind,
    ].filter(Boolean).join(" · ");
    if (existing) {
      existing.durationMs += durationMs;
      existing.inputTokens = (existing.inputTokens ?? 0) + (event.inputTokens ?? 0);
      existing.outputTokens = (existing.outputTokens ?? 0) + (event.outputTokens ?? 0);
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      id: key,
      label: eventTitle(event),
      caption,
      durationMs,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      status: event.status,
      count: 1,
    });
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      caption: `${row.caption} · ${row.count} ${row.count === 1 ? "call" : "calls"}`,
    }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function buildPhaseTimingRows(events: TraceEvent[], session: TraceRow): TimingRow[] {
  const completed = events
    .filter((event) => event.kind === "phase" && (event.durationMs ?? 0) > 0)
    .map((event) => ({
      id: event._id,
      event,
      label: event.phase ?? event.label ?? "phase",
      caption: event.message ?? event.status ?? "completed phase",
      durationMs: event.durationMs ?? 0,
      status: event.status,
    }));
  if (completed.length) return completed.sort((a, b) => b.durationMs - a.durationMs);

  const activeStarts = events.filter(
    (event) => event.kind === "phase" && event.status === "started" && event.phase,
  );
  const endAt = session.completedAt ?? session.lastEventAt ?? dayjs().valueOf();
  return activeStarts
    .filter((event) => {
      const finished = events.some(
        (candidate) =>
          candidate.kind === "phase" &&
          candidate.phase === event.phase &&
          candidate.timestamp > event.timestamp &&
          candidate.status !== "started",
      );
      return !finished && endAt > event.timestamp;
    })
    .map((event) => ({
      id: event._id,
      event,
      label: event.phase ?? "active phase",
      caption: "active; elapsed so far",
      durationMs: endAt - event.timestamp,
      status: "running",
    }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function buildOtherTimingRows(events: TraceEvent[]): TimingRow[] {
  return events
    .filter((event) => event.kind !== "phase" && event.kind !== "model_call" && (event.durationMs ?? 0) > 0)
    .map((event) => ({
      id: event._id,
      label: eventTitle(event),
      caption: eventCaption(event),
      durationMs: event.durationMs ?? 0,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      status: event.status,
    }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function cleanTraceText(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^(unknown|unknown\.pdf|extracting\.\.\.)$/i.test(trimmed)) return undefined;
  const cleaned = trimmed
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && !/^(unknown|unknown\.pdf|extracting\.\.\.)$/i.test(part))
    .join(" · ");
  return cleaned || undefined;
}

function traceDisplayTitle(trace: TraceRow) {
  return cleanTraceText(trace.policyLabel) ?? cleanTraceText(trace.fileName) ?? "Extraction trace";
}

function traceDisplayFile(trace: TraceRow) {
  return cleanTraceText(trace.fileName) ?? "—";
}

function eventTiming(event: TraceEvent, session: TraceRow, level = 0): TimelineRow | null {
  const endAt = session.completedAt ?? session.lastEventAt ?? dayjs().valueOf();
  if ((event.durationMs ?? 0) > 0) {
    const durationMs = event.durationMs ?? 0;
    return {
      id: event._id,
      event,
      label: eventTitle(event),
      caption: eventCaption(event),
      kind: event.kind,
      level,
      startMs: Math.max(session.startedAt, event.timestamp - durationMs),
      endMs: event.timestamp,
      durationMs,
      status: event.status,
    };
  }
  if (event.kind === "phase" && event.status === "started" && endAt > event.timestamp) {
    return {
      id: event._id,
      event,
      label: event.phase ?? "active phase",
      caption: "phase · active",
      kind: event.kind,
      level,
      startMs: event.timestamp,
      endMs: endAt,
      durationMs: endAt - event.timestamp,
      status: "running",
    };
  }
  return null;
}

function assignTimelineChildren(parents: TimelineRow[], children: TimelineRow[]) {
  if (!parents.length) return children;
  const counts = new Map<string, number>();
  const nextChildren = children.map((child) => {
    const parent = parents
      .filter((candidate) =>
        candidate.startMs <= child.startMs &&
        candidate.endMs >= child.endMs
      )
      .sort((a, b) => a.durationMs - b.durationMs)[0];
    if (!parent) return child;
    counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
    return { ...child, parentId: parent.id, level: parent.level + 1 };
  });
  for (const parent of parents) {
    parent.childCount = counts.get(parent.id) ?? 0;
  }
  return nextChildren;
}

function buildTimelineRows(events: TraceEvent[], session: TraceRow) {
  const parentRows = events
    .filter((event) =>
      (event.kind === "phase" || event.kind === "worker") &&
      event.status !== "started" &&
      (event.durationMs ?? 0) > 0
    )
    .map((event) => eventTiming(event, session, 0))
    .filter((row): row is TimelineRow => !!row)
    .sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);

  const activeParentRows = events
    .filter((event) => event.kind === "phase" && event.status === "started" && event.phase)
    .filter((event) => !parentRows.some((row) => row.kind === "phase" && row.label === event.phase))
    .map((event) => eventTiming(event, session, 0))
    .filter((row): row is TimelineRow => !!row);

  const parents = [...parentRows, ...activeParentRows].sort((a, b) => a.startMs - b.startMs);
  const rawChildRows = events
    .filter((event) => event.kind === "model_call" || event.kind === "embedding_batch" || event.kind === "artifact")
    .map((event) => eventTiming(event, session, 1))
    .filter((row): row is TimelineRow => !!row);
  const childRows = assignTimelineChildren(parents, rawChildRows);

  if (parents.length) {
    return [...parents, ...childRows]
      .sort((a, b) => a.startMs - b.startMs || a.level - b.level || b.durationMs - a.durationMs);
  }

  const completedPhases = new Set(
    events
      .filter((event) => event.kind === "phase" && event.status !== "started" && event.phase)
      .map((event) => event.phase),
  );
  return events
    .filter((event) => {
      if (event.kind === "session") return false;
      if (event.kind !== "phase" || event.status !== "started" || !event.phase) return true;
      return !completedPhases.has(event.phase);
    })
    .map((event) => eventTiming(event, session, event.kind === "model_call" ? 1 : 0))
    .filter((row): row is TimelineRow => !!row)
    .sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);
}

function timelineColor(kind: TraceEvent["kind"]) {
  if (kind === "model_call") return "bg-blue-500";
  if (kind === "phase") return "bg-foreground";
  if (kind === "embedding_batch") return "bg-emerald-500";
  if (kind === "worker") return "bg-violet-500";
  if (kind === "artifact") return "bg-amber-500";
  return "bg-muted-foreground";
}

function timelineInsideTextColor(kind: TraceEvent["kind"]) {
  return kind === "phase" ? "text-background" : "text-white";
}

function modelCallDebugDetails(event?: TraceEvent): ModelCallDebugDetails | null {
  if (!event?.details || typeof event.details !== "object") return null;
  return event.details as ModelCallDebugDetails;
}

function DebugPreview({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-label-sm font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-lg border border-foreground/6 bg-muted/20 p-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {value}
      </pre>
    </div>
  );
}

function ModelCallDebugPanel({ event }: { event?: TraceEvent }) {
  if (!event) return null;
  const details = modelCallDebugDetails(event);
  if (!details) {
    return (
      <div className="rounded-lg border border-foreground/6 px-3 py-3 text-body-sm text-muted-foreground">
        No prompt or output details were recorded for this call. Rerun the extraction to capture model-call debug payloads.
      </div>
    );
  }
  const inputSummary = details.inputSummary;
  const inputRows = [
    inputSummary?.mimeType ? ["MIME type", inputSummary.mimeType] : null,
    inputSummary?.fileId ? ["File ID", inputSummary.fileId] : null,
    inputSummary?.hasPdfUrl ? ["PDF URL", inputSummary.pdfUrl ?? "present"] : null,
    inputSummary?.hasPdfBytes ? ["PDF bytes", inputSummary.pdfBytes?.toLocaleString() ?? "present"] : null,
    inputSummary?.hasPdfBase64 ? ["PDF base64", `${inputSummary.pdfBase64Chars?.toLocaleString() ?? "present"} chars`] : null,
    inputSummary?.images?.length ? ["Images", `${inputSummary.images.length} image${inputSummary.images.length === 1 ? "" : "s"}`] : null,
  ].filter((row): row is [string, string] => !!row);

  return (
    <div className="space-y-3 rounded-lg border border-foreground/6 p-3">
      <div className="grid gap-2 text-label-sm text-muted-foreground sm:grid-cols-2">
        <div>
          <span className="font-medium text-foreground">Purpose</span>
          <span className="ml-2">{details.purpose ?? eventTitle(event)}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Task</span>
          <span className="ml-2">{[details.task, details.taskKind].filter(Boolean).join(" / ") || "—"}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Output</span>
          <span className="ml-2">{details.outputKind ?? "—"}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Max tokens</span>
          <span className="ml-2">{details.maxOutputTokens?.toLocaleString() ?? "—"}</span>
        </div>
      </div>
      {inputRows.length ? (
        <div className="space-y-1">
          <p className="text-label-sm font-medium text-muted-foreground">Input attachments</p>
          <div className="rounded-lg border border-foreground/6">
            {inputRows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 border-b border-foreground/6 px-3 py-2 last:border-b-0">
                <span className="text-label-sm text-muted-foreground">{label}</span>
                <span className="truncate text-label-sm text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <DebugPreview label="System" value={details.systemPreview} />
      <DebugPreview label="Prompt / input text" value={details.promptPreview} />
      <DebugPreview label="Output" value={details.outputPreview} />
    </div>
  );
}

function TimelineEventDetail({ row }: { row?: TimelineRow }) {
  if (!row) return null;
  return (
    <div className="space-y-2 rounded-lg border border-foreground/6 p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-body-sm font-medium text-foreground">{row.label}</p>
        </div>
        <Badge variant="secondary">{formatDuration(row.durationMs)}</Badge>
      </div>
      <div className="grid gap-2 text-label-sm text-muted-foreground sm:grid-cols-2">
        <div>
          <span className="font-medium text-foreground">Kind</span>
          <span className="ml-2">{row.kind}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Status</span>
          <span className="ml-2">{row.status ?? "—"}</span>
        </div>
        {row.event.provider || row.event.model ? (
          <div className="sm:col-span-2">
            <span className="font-medium text-foreground">Model</span>
            <span className="ml-2">{[row.event.provider, row.event.model].filter(Boolean).join(" / ")}</span>
          </div>
        ) : null}
        {row.event.inputTokens || row.event.outputTokens ? (
          <div className="sm:col-span-2">
            <span className="font-medium text-foreground">Tokens</span>
            <span className="ml-2">{formatTokens(row.event.inputTokens, row.event.outputTokens)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimingBar({ row, maxDurationMs }: { row: TimingRow; maxDurationMs: number }) {
  const width = Math.max(4, Math.min(100, (row.durationMs / Math.max(maxDurationMs, 1)) * 100));
  return (
    <div className="border-b border-foreground/6 px-3 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-body-sm font-medium text-foreground">{row.label}</p>
          <p className="truncate text-label-sm text-muted-foreground">{row.caption}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-body-sm text-foreground">{formatDuration(row.durationMs)}</p>
          <p className="text-label-sm text-muted-foreground">
            {formatCompactTokens(row.inputTokens, row.outputTokens) !== "—"
              ? formatCompactTokens(row.inputTokens, row.outputTokens)
              : (row.status ?? "")}
          </p>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function TimelineWaterfall({
  rows,
  session,
  labelWidth,
  onLabelWidthChange,
  collapsedIds,
  onToggleCollapsed,
  selectedRowId,
  onSelectRow,
}: {
  rows: TimelineRow[];
  session: TraceRow;
  labelWidth: number;
  onLabelWidthChange: (width: number) => void;
  collapsedIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  selectedRowId?: string | null;
  onSelectRow: (id: string) => void;
}) {
  const startAt = session.startedAt;
  const endAt = Math.max(
    session.completedAt ?? 0,
    session.lastEventAt ?? 0,
    ...rows.map((row) => row.endMs),
    startAt + 1,
  );
  const durationMs = Math.max(1, endAt - startAt);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const gridTemplateColumns = `${labelWidth}px minmax(0, 1fr)`;
  const visibleRows = rows.filter((row) => !row.parentId || !collapsedIds.has(row.parentId));

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = labelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(110, Math.min(280, startWidth + moveEvent.clientX - startX));
      onLabelWidthChange(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-foreground/6">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid border-b border-foreground/6 bg-muted/20" style={{ gridTemplateColumns }}>
          <div className="relative border-r border-foreground/6 px-2.5 py-2 text-label-sm font-medium text-muted-foreground">
            Event
            <button
              type="button"
              aria-label="Resize event column"
              className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onPointerDown={startResize}
            />
          </div>
          <div className="relative h-8 min-w-0 overflow-hidden">
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute top-0 h-full border-l border-foreground/10"
                style={{ left: `${tick * 100}%` }}
              >
                <span className="ml-1 text-[10px] leading-8 text-muted-foreground">
                  {formatDuration(durationMs * tick)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleRows.length ? visibleRows.map((row) => {
            const left = ((row.startMs - startAt) / durationMs) * 100;
            const width = Math.max(1.5, (row.durationMs / durationMs) * 100);
            const constrainedLeft = Math.max(0, Math.min(100, left));
            const constrainedWidth = Math.min(100 - constrainedLeft, width);
            const durationLabel = formatDuration(row.durationMs);
            const showDurationInside = constrainedWidth >= 8;
            const showOutsideAfter = constrainedLeft + constrainedWidth <= 88;
            const isCollapsed = collapsedIds.has(row.id);
            const hasChildren = (row.childCount ?? 0) > 0;
            return (
              <div
                role="button"
                tabIndex={0}
                key={row.id}
                className={`grid min-h-7 border-b border-foreground/6 text-left last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                  selectedRowId === row.id ? "bg-muted/50" : ""
                }`}
                style={{ gridTemplateColumns }}
                onClick={() => onSelectRow(row.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectRow(row.id);
                }}
              >
                <div className={`min-w-0 border-r border-foreground/6 py-1.5 pr-2.5 ${row.level > 0 ? "pl-5" : "pl-2.5"}`}>
                  <div className="flex min-w-0 items-center gap-1">
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-label={isCollapsed ? "Expand timeline row" : "Collapse timeline row"}
                        className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleCollapsed(row.id);
                        }}
                      >
                        {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    ) : (
                      <span className="h-4 w-4 shrink-0" />
                    )}
                    <p className="min-w-0 truncate text-label-sm font-medium text-foreground">{row.label}</p>
                  </div>
                </div>
                <div className="relative min-w-0 overflow-hidden px-0 py-1.5">
                  {ticks.map((tick) => (
                    <span
                      key={tick}
                      aria-hidden="true"
                      className="absolute top-0 h-full border-l border-foreground/6"
                      style={{ left: `${tick * 100}%` }}
                    />
                  ))}
                  <div
                    className={`absolute top-1.5 flex h-4 items-center justify-center rounded-sm px-1 ${timelineColor(row.kind)}`}
                    style={{
                      left: `${constrainedLeft}%`,
                      width: `${constrainedWidth}%`,
                    }}
                    title={`${row.label} · ${durationLabel} · ${row.caption}`}
                  >
                    {showDurationInside ? (
                      <span className={`truncate text-[10px] font-medium ${timelineInsideTextColor(row.kind)}`}>
                        {durationLabel}
                      </span>
                    ) : null}
                  </div>
                  {!showDurationInside ? (
                    <span
                      className="pointer-events-none absolute top-1/2 max-w-14 -translate-y-1/2 truncate px-1 text-[10px] font-medium text-foreground"
                      style={showOutsideAfter
                        ? { left: `${constrainedLeft + constrainedWidth}%` }
                        : { right: `${100 - constrainedLeft}%` }}
                    >
                      {durationLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          }) : (
            <p className="px-3 py-3 text-body-sm text-muted-foreground">No timed events recorded yet.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 border-t border-foreground/6 px-3 py-2 text-[10px] text-muted-foreground">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-foreground" />phase</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />model call</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />embedding</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-500" />worker</span>
        </div>
      </div>
    </div>
  );
}

export default function OperatorExtractionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const traceIdParam = searchParams.get("traceId");
  const traceTabParam = parseTracePanelTab(searchParams.get("tab"));
  const [status, setStatus] = useState<string>(ALL);
  const [range, setRange] = useState<keyof typeof RANGE_LABELS>("90d");
  const [orgId, setOrgId] = useState<string>(ALL);
  const selectedTraceId = traceIdParam;
  const activeTraceTab = traceIdParam ? traceTabParam : "summary";
  const [selectedModelEventId, setSelectedModelEventId] = useState<string | null>(null);
  const [timelineLabelWidth, setTimelineLabelWidth] = useState(150);
  const [collapsedTimelineIds, setCollapsedTimelineIds] = useState<Set<string>>(() => new Set());
  const [selectedTimelineRowId, setSelectedTimelineRowId] = useState<string | null>(null);

  const current = useCachedOperatorCurrent();
  const traces = useCachedOperatorExtractionTraces({
    status: status === ALL ? undefined : status as TraceStatus,
    orgId: orgId === ALL ? undefined : orgId,
    range,
    limit: 250,
  }) as TraceRow[] | undefined;
  const detail = useCachedOperatorExtractionTraceDetail(selectedTraceId) as
    | TraceDetail
    | null
    | undefined;

  const orgOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const trace of traces ?? []) map.set(trace.orgId, trace.orgName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [traces]);
  const selectedOrgLabel = orgId === ALL
    ? "All orgs"
    : orgOptions.find(([id]) => id === orgId)?.[1] ?? "Selected org";

  const selected = detail?.session ?? traces?.find((trace) => trace.traceId === selectedTraceId) ?? null;
  const modelEvents = (detail?.events ?? []).filter((event) => event.kind === "model_call");
  const selectedModelEvent = modelEvents.find((event) => event._id === selectedModelEventId) ?? modelEvents[0];
  const logEvents = (detail?.events ?? []).filter((event) => event.kind === "log");
  const modelTimingRows = selected ? buildModelTimingRows(modelEvents) : [];
  const phaseTimingRows = selected && detail?.events ? buildPhaseTimingRows(detail.events, selected) : [];
  const otherTimingRows = detail?.events ? buildOtherTimingRows(detail.events) : [];
  const timelineRows = selected && detail?.events ? buildTimelineRows(detail.events, selected) : [];
  const selectedTimelineRow = timelineRows.find((row) => row.id === selectedTimelineRowId) ?? null;
  const maxPhaseDuration = Math.max(...phaseTimingRows.map((row) => row.durationMs), 1);
  const maxModelDuration = Math.max(...modelTimingRows.map((row) => row.durationMs), 1);
  const maxOtherDuration = Math.max(...otherTimingRows.map((row) => row.durationMs), 1);
  const wallDurationMs = selected?.totalDurationMs ?? (
    selected?.lastEventAt ? selected.lastEventAt - selected.startedAt : undefined
  );
  const updateTraceUrl = useCallback((traceId: string | null, tab: TracePanelTab) => {
    const next = new URLSearchParams(searchParams.toString());
    if (traceId) {
      next.set("traceId", traceId);
      next.set("tab", tab);
    } else {
      next.delete("traceId");
      next.delete("tab");
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  const resetTraceLocalState = useCallback(() => {
    setSelectedModelEventId(null);
    setCollapsedTimelineIds(new Set());
    setSelectedTimelineRowId(null);
  }, []);
  const openTrace = useCallback((traceId: string, tab: TracePanelTab = "summary") => {
    resetTraceLocalState();
    updateTraceUrl(traceId, tab);
  }, [resetTraceLocalState, updateTraceUrl]);
  const closeTrace = useCallback(() => {
    resetTraceLocalState();
    updateTraceUrl(null, "summary");
  }, [resetTraceLocalState, updateTraceUrl]);
  const selectTraceTab = useCallback((tab: TracePanelTab) => {
    if (selectedTraceId) updateTraceUrl(selectedTraceId, tab);
  }, [selectedTraceId, updateTraceUrl]);
  const copyExtractionId = useCallback((traceId: string) => {
    void navigator.clipboard
      .writeText(traceId)
      .then(() => toast.success("Extraction ID copied"))
      .catch(() => toast.error("Couldn't copy extraction ID"));
  }, []);
  const toggleTimelineCollapsed = useCallback((id: string) => {
    setCollapsedTimelineIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const actions = (
    <div className="flex items-center gap-2">
      <Select value={status} onValueChange={(value) => setStatus(value ?? ALL)}>
        <SelectTrigger size="sm" className="w-32">
          <SelectValue>{STATUS_LABELS[status] ?? status}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          <SelectItem value="running">Running</SelectItem>
          <SelectItem value="complete">Complete</SelectItem>
          <SelectItem value="error">Error</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>
      <Select value={range} onValueChange={(value) => {
        if (value && value in RANGE_LABELS) setRange(value as keyof typeof RANGE_LABELS);
      }}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue>{RANGE_LABELS[range]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="24h">24 hours</SelectItem>
          <SelectItem value="7d">7 days</SelectItem>
          <SelectItem value="30d">30 days</SelectItem>
          <SelectItem value="90d">90 days</SelectItem>
        </SelectContent>
      </Select>
      <Select value={orgId} onValueChange={(value) => setOrgId(value ?? ALL)}>
        <SelectTrigger size="sm" className="w-48">
          <SelectValue>{selectedOrgLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All orgs</SelectItem>
          {orgOptions.map(([id, name]) => (
            <SelectItem key={id} value={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const rightPanel = (
    <SettingsDrawer
      open={!!selectedTraceId}
      onOpenChange={(open) => {
        if (!open) closeTrace();
      }}
      title={selected ? traceDisplayTitle(selected) : "Extraction trace"}
    >
      {detail === undefined && selectedTraceId ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : selected ? (
        <div className="flex min-h-0 flex-1">
          <Tabs
            value={activeTraceTab}
            onValueChange={(value) => selectTraceTab(parseTracePanelTab(value))}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <TabsList variant="pill" className="sticky top-0 z-10 max-w-full shrink-0 overflow-x-auto bg-background py-1">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="extracted">Extracted data</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="timing">Timing</TabsTrigger>
              <TabsTrigger value="models">Model calls</TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="min-h-0 overflow-y-auto pt-3">
              <dl className="rounded-lg border border-foreground/6">
                <DetailRow
                  label="Extraction ID"
                  value={(
                    <div className="flex min-w-0 items-center gap-2">
                      <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-label-sm">
                        {selected.traceId}
                      </code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Copy extraction ID"
                        onClick={() => copyExtractionId(selected.traceId)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                />
                <DetailRow label="Org" value={selected.orgName} />
                <DetailRow label="File" value={traceDisplayFile(selected)} />
                <DetailRow label="Status" value={<Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>} />
                <DetailRow label="Started" value={dayjs(selected.startedAt).format("MMM D, h:mm:ss A")} />
                <DetailRow label="Duration" value={formatDuration(selected.totalDurationMs ?? (selected.lastEventAt ? selected.lastEventAt - selected.startedAt : undefined))} />
                <DetailRow label="Model time" value={formatDuration(selected.modelDurationMs)} />
                <DetailRow label="Tokens" value={formatTokens(selected.inputTokens, selected.outputTokens)} />
                <DetailRow label="Slowest" value={selected.slowestLabel ? `${selected.slowestLabel} · ${formatDuration(selected.slowestDurationMs)}` : "—"} />
                {selected.error ? <DetailRow label="Error" value={<span className="text-destructive">{selected.error}</span>} /> : null}
              </dl>
            </TabsContent>

            <TabsContent value="extracted" className="min-h-0 overflow-y-auto pt-3">
              {detail?.policy ? (
                <ExtractionCards
                  policyId={selected.policyId as Id<"policies">}
                  policyDocument={detail.policy}
                  sourceSpansOverride={detail.sourceSpans}
                  fileUrl={detail.fileUrl ?? undefined}
                />
              ) : (
                <div className="rounded-lg border border-foreground/6 px-3 py-3 text-body-sm text-muted-foreground">
                  Extracted policy data is unavailable for this trace.
                </div>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden pt-3">
              <TimelineWaterfall
                rows={timelineRows}
                session={selected}
                labelWidth={timelineLabelWidth}
                onLabelWidthChange={setTimelineLabelWidth}
                collapsedIds={collapsedTimelineIds}
                onToggleCollapsed={toggleTimelineCollapsed}
                selectedRowId={selectedTimelineRowId}
                onSelectRow={setSelectedTimelineRowId}
              />
              <div className="min-h-0 max-h-44 overflow-y-auto">
                <TimelineEventDetail row={selectedTimelineRow ?? timelineRows[0]} />
              </div>
            </TabsContent>

            <TabsContent value="timing" className="min-h-0 space-y-3 overflow-y-auto pt-3">
              <div className="space-y-2">
                <div>
                  <h4 className="mb-1 text-label-sm font-medium text-muted-foreground">Phases</h4>
                  <div className="rounded-lg border border-foreground/6">
                    {phaseTimingRows.length ? phaseTimingRows.map((row) => (
                      <TimingBar key={row.id} row={row} maxDurationMs={maxPhaseDuration} />
                    )) : (
                      <p className="px-3 py-3 text-body-sm text-muted-foreground">No phase timings recorded.</p>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="mb-1 text-label-sm font-medium text-muted-foreground">Model calls</h4>
                  <div className="rounded-lg border border-foreground/6">
                    {modelTimingRows.length ? modelTimingRows.map((row) => (
                      <TimingBar key={row.id} row={row} maxDurationMs={maxModelDuration} />
                    )) : (
                      <p className="px-3 py-3 text-body-sm text-muted-foreground">No model timings recorded.</p>
                    )}
                  </div>
                </div>
                {otherTimingRows.length ? (
                  <div>
                    <h4 className="mb-1 text-label-sm font-medium text-muted-foreground">Other timed work</h4>
                    <div className="rounded-lg border border-foreground/6">
                      {otherTimingRows.map((row) => (
                        <TimingBar key={row.id} row={row} maxDurationMs={maxOtherDuration} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              {selected.modelDurationMs && wallDurationMs && selected.modelDurationMs > wallDurationMs ? (
                <p className="text-label-sm text-muted-foreground">
                  Aggregate model time can exceed wall time when extraction runs model calls in parallel.
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="models" className="min-h-0 min-w-0 space-y-2 overflow-y-auto pt-3">
              <div className="w-full min-w-0 overflow-hidden rounded-lg border border-foreground/6">
                <Table className="min-w-0 table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[38%] px-3 text-label-sm text-muted-foreground">Call</TableHead>
                      <TableHead className="w-[28%] text-label-sm text-muted-foreground">Model</TableHead>
                      <TableHead className="w-[12%] text-label-sm text-muted-foreground">Time</TableHead>
                      <TableHead className="w-[22%] px-3 text-label-sm text-muted-foreground">Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelEvents.length ? modelEvents.map((event) => (
                      <TableRow
                        key={event._id}
                        tabIndex={0}
                        onClick={() => setSelectedModelEventId(event._id)}
                        onKeyDown={(keyboardEvent) => {
                          if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
                          keyboardEvent.preventDefault();
                          setSelectedModelEventId(event._id);
                        }}
                        className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                          selectedModelEvent?._id === event._id ? "bg-muted/50" : ""
                        }`}
                      >
                        <TableCell className="min-w-0 px-3">
                          <p className="truncate text-body-sm text-foreground">{eventTitle(event)}</p>
                          <p className="truncate text-label-sm text-muted-foreground">
                            {[event.status, event.routeSource, modelCallDebugDetails(event) ? "debug details" : undefined].filter(Boolean).join(" · ")}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-0 truncate text-muted-foreground">
                          {[event.provider, event.model].filter(Boolean).join(" / ") || "—"}
                        </TableCell>
                        <TableCell className="min-w-0 truncate text-muted-foreground">{formatDuration(event.durationMs)}</TableCell>
                        <TableCell className="min-w-0 truncate px-3 text-muted-foreground">{formatTokens(event.inputTokens, event.outputTokens)}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="h-20 px-3 text-body-sm text-muted-foreground">
                          No model calls recorded.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <ModelCallDebugPanel event={selectedModelEvent} />
            </TabsContent>

            <TabsContent value="log" className="min-h-0 space-y-2 overflow-y-auto pt-3">
              <div className="rounded-lg border border-foreground/6">
                {logEvents.length ? logEvents.map((event) => (
                  <div key={event._id} className="border-b border-foreground/6 px-3 py-2 last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-label-sm text-muted-foreground">
                        {dayjs(event.timestamp).format("h:mm:ss A")}{event.phase ? ` · ${event.phase}` : ""}
                      </p>
                      {event.level && event.level !== "info" ? <Badge variant={event.level === "error" ? "destructive" : "secondary"}>{event.level}</Badge> : null}
                    </div>
                    <p className="mt-1 text-body-sm text-foreground">{event.message}</p>
                  </div>
                )) : (
                  <p className="px-3 py-3 text-body-sm text-muted-foreground">No log messages recorded.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <p className="text-body-sm text-muted-foreground">Trace not found.</p>
      )}
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={actions}
      breadcrumbDetail="Extractions"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="extractions"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
      rightPanel={rightPanel}
    >
      <main className="flex w-full flex-col">
        <section className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[13%] px-4 text-label-sm text-muted-foreground">Started</TableHead>
                <TableHead className="w-[16%] text-label-sm text-muted-foreground">Org</TableHead>
                <TableHead className="w-[22%] text-label-sm text-muted-foreground">Policy / file</TableHead>
                <TableHead className="w-[9%] text-label-sm text-muted-foreground">Status</TableHead>
                <TableHead className="w-[9%] text-label-sm text-muted-foreground">Duration</TableHead>
                <TableHead className="w-[15%] text-label-sm text-muted-foreground">Slowest area</TableHead>
                <TableHead className="w-[8%] text-label-sm text-muted-foreground">Calls</TableHead>
                <TableHead className="w-[8%] px-4 text-label-sm text-muted-foreground">Model time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="h-32 px-4 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                    <p className="text-body-sm">Loading extraction traces...</p>
                  </TableCell>
                </TableRow>
              ) : traces.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="h-32 px-4 text-body-sm text-muted-foreground">
                    No extraction traces yet. Run a policy extraction and traces will appear here.
                  </TableCell>
                </TableRow>
              ) : (
                traces.map((trace) => (
                  <TableRow
                    key={trace.traceId}
                    tabIndex={0}
                    onClick={() => openTrace(trace.traceId)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openTrace(trace.traceId);
                    }}
                    className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selectedTraceId === trace.traceId ? "bg-muted/50" : ""
                    }`}
                  >
                    <TableCell className="px-4 text-muted-foreground">
                      {dayjs(trace.startedAt).format("MMM D, h:mm A")}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-foreground">{trace.orgName}</TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate text-foreground">{traceDisplayTitle(trace)}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(trace.status)}>{trace.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDuration(trace.totalDurationMs ?? (trace.lastEventAt ? trace.lastEventAt - trace.startedAt : undefined))}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {trace.slowestLabel ? `${trace.slowestLabel} · ${formatDuration(trace.slowestDurationMs)}` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{trace.modelCallCount ?? 0}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{formatDuration(trace.modelDurationMs)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </main>
    </AppShell>
  );
}
