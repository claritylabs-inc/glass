"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
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
import { Loader2 } from "lucide-react";
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
type TraceDetail = {
  session: TraceRow;
  events: TraceEvent[];
};

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

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  if (value < 1 && value > 0) return "<1%";
  return `${Math.round(value)}%`;
}

function statusVariant(status: TraceStatus): "default" | "secondary" | "destructive" {
  if (status === "complete") return "default";
  if (status === "error" || status === "cancelled") return "destructive";
  return "secondary";
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-foreground/6 py-2.5 last:border-b-0">
      <dt className="shrink-0 text-label-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body-sm text-foreground">{value}</dd>
    </div>
  );
}

function eventTitle(event: TraceEvent) {
  return event.label ?? event.taskKind ?? event.phase ?? event.message ?? event.kind;
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
  label: string;
  caption: string;
  kind: TraceEvent["kind"];
  startMs: number;
  endMs: number;
  durationMs: number;
  status?: string;
};

function modelGroupKey(event: TraceEvent) {
  return [
    event.label ?? event.taskKind ?? "model call",
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
    const caption = [event.provider, event.model].filter(Boolean).join(" / ") || "model";
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
      caption: [event.kind, event.status].filter(Boolean).join(" · "),
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

function eventTiming(event: TraceEvent, session: TraceRow): TimelineRow | null {
  const endAt = session.completedAt ?? session.lastEventAt ?? dayjs().valueOf();
  if ((event.durationMs ?? 0) > 0) {
    const durationMs = event.durationMs ?? 0;
    return {
      id: event._id,
      label: eventTitle(event),
      caption: [event.kind, event.status].filter(Boolean).join(" · "),
      kind: event.kind,
      startMs: Math.max(session.startedAt, event.timestamp - durationMs),
      endMs: event.timestamp,
      durationMs,
      status: event.status,
    };
  }
  if (event.kind === "phase" && event.status === "started" && endAt > event.timestamp) {
    return {
      id: event._id,
      label: event.phase ?? "active phase",
      caption: "phase · active",
      kind: event.kind,
      startMs: event.timestamp,
      endMs: endAt,
      durationMs: endAt - event.timestamp,
      status: "running",
    };
  }
  return null;
}

function buildTimelineRows(events: TraceEvent[], session: TraceRow) {
  const completedPhases = new Set(
    events
      .filter((event) => event.kind === "phase" && event.status !== "started" && event.phase)
      .map((event) => event.phase),
  );
  return events
    .filter((event) => {
      if (event.kind !== "phase" || event.status !== "started" || !event.phase) return true;
      return !completedPhases.has(event.phase);
    })
    .map((event) => eventTiming(event, session))
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
}: {
  rows: TimelineRow[];
  session: TraceRow;
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

  return (
    <div className="overflow-hidden rounded-lg border border-foreground/6">
      <div className="grid grid-cols-[11rem_1fr] border-b border-foreground/6 bg-muted/20">
        <div className="border-r border-foreground/6 px-3 py-2 text-label-sm font-medium text-muted-foreground">
          Event
        </div>
        <div className="relative h-8">
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
      <div className="max-h-80 overflow-y-auto">
        {rows.length ? rows.map((row) => {
          const left = ((row.startMs - startAt) / durationMs) * 100;
          const width = Math.max(1.5, (row.durationMs / durationMs) * 100);
          return (
            <div key={row.id} className="grid min-h-10 grid-cols-[11rem_1fr] border-b border-foreground/6 last:border-b-0">
              <div className="min-w-0 border-r border-foreground/6 px-3 py-2">
                <p className="truncate text-label-sm font-medium text-foreground">{row.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{formatDuration(row.durationMs)}</p>
              </div>
              <div className="relative px-0 py-2">
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    aria-hidden="true"
                    className="absolute top-0 h-full border-l border-foreground/6"
                    style={{ left: `${tick * 100}%` }}
                  />
                ))}
                <div
                  className={`absolute top-2 h-5 rounded-sm ${timelineColor(row.kind)}`}
                  style={{
                    left: `${Math.max(0, Math.min(100, left))}%`,
                    width: `${Math.min(100 - Math.max(0, left), width)}%`,
                  }}
                  title={`${row.label} · ${formatDuration(row.durationMs)} · ${row.caption}`}
                />
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
  );
}

export default function OperatorExtractionsPage() {
  const [status, setStatus] = useState<string>(ALL);
  const [range, setRange] = useState<keyof typeof RANGE_LABELS>("90d");
  const [orgId, setOrgId] = useState<string>(ALL);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

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
  const phaseEvents = (detail?.events ?? []).filter((event) => event.kind === "phase" && event.durationMs !== undefined);
  const logEvents = (detail?.events ?? []).filter((event) => event.kind === "log");
  const modelTimingRows = selected ? buildModelTimingRows(modelEvents) : [];
  const phaseTimingRows = selected && detail?.events ? buildPhaseTimingRows(detail.events, selected) : [];
  const otherTimingRows = detail?.events ? buildOtherTimingRows(detail.events) : [];
  const visibleTimingRows = [...phaseTimingRows, ...otherTimingRows, ...modelTimingRows]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);
  const timelineRows = selected && detail?.events ? buildTimelineRows(detail.events, selected) : [];
  const maxTimingDuration = Math.max(...visibleTimingRows.map((row) => row.durationMs), 1);
  const wallDurationMs = selected?.totalDurationMs ?? (
    selected?.lastEventAt ? selected.lastEventAt - selected.startedAt : undefined
  );
  const modelShare = wallDurationMs && selected?.modelDurationMs
    ? (selected.modelDurationMs / wallDurationMs) * 100
    : 0;

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
        if (!open) setSelectedTraceId(null);
      }}
      title={selected ? traceDisplayTitle(selected) : "Extraction trace"}
    >
      {detail === undefined && selectedTraceId ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : selected ? (
        <div className="space-y-5 pt-4">
          <section>
            <dl className="rounded-lg border border-foreground/6">
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
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-body-sm font-medium text-foreground">Timeline</h3>
              <span className="text-label-sm text-muted-foreground">
                {formatDuration(wallDurationMs)}
              </span>
            </div>
            <TimelineWaterfall rows={timelineRows} session={selected} />
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-body-sm font-medium text-foreground">Timing breakdown</h3>
              <span className="text-label-sm text-muted-foreground">
                Model time is {formatPercent(modelShare)} of elapsed wall time
              </span>
            </div>
            <div className="rounded-lg border border-foreground/6">
              {visibleTimingRows.length ? visibleTimingRows.map((row) => (
                <TimingBar key={row.id} row={row} maxDurationMs={maxTimingDuration} />
              )) : (
                <p className="px-3 py-3 text-body-sm text-muted-foreground">
                  No timed events recorded yet. The trace will fill in as phases, model calls, or worker events finish.
                </p>
              )}
            </div>
            {selected.modelDurationMs && wallDurationMs && selected.modelDurationMs > wallDurationMs ? (
              <p className="text-label-sm text-muted-foreground">
                Aggregate model time can exceed wall time when extraction runs model calls in parallel.
              </p>
            ) : null}
          </section>

          {phaseEvents.length ? (
            <section className="space-y-2">
              <h3 className="text-body-sm font-medium text-foreground">Recorded phases</h3>
              <div className="rounded-lg border border-foreground/6">
                {phaseEvents.map((event) => (
                  <div key={event._id} className="flex items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-body-sm text-foreground">{event.phase}</p>
                      <p className="text-label-sm text-muted-foreground">{event.status}</p>
                    </div>
                    <span className="shrink-0 text-body-sm text-muted-foreground">{formatDuration(event.durationMs)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-body-sm font-medium text-foreground">Model calls</h3>
            <div className="overflow-hidden rounded-lg border border-foreground/6">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-3 text-label-sm text-muted-foreground">Call</TableHead>
                    <TableHead className="text-label-sm text-muted-foreground">Model</TableHead>
                    <TableHead className="text-label-sm text-muted-foreground">Time</TableHead>
                    <TableHead className="px-3 text-label-sm text-muted-foreground">Tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelEvents.length ? modelEvents.map((event) => (
                    <TableRow key={event._id}>
                      <TableCell className="max-w-40 px-3">
                        <p className="truncate text-body-sm text-foreground">{eventTitle(event)}</p>
                        <p className="truncate text-label-sm text-muted-foreground">{event.status}{event.routeSource ? ` · ${event.routeSource}` : ""}</p>
                      </TableCell>
                      <TableCell className="max-w-44 truncate text-muted-foreground">
                        {[event.provider, event.model].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDuration(event.durationMs)}</TableCell>
                      <TableCell className="px-3 text-muted-foreground">{formatTokens(event.inputTokens, event.outputTokens)}</TableCell>
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
          </section>

          <section className="space-y-2">
            <h3 className="text-body-sm font-medium text-foreground">Pipeline log</h3>
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
          </section>
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
                    onClick={() => setSelectedTraceId(trace.traceId)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedTraceId(trace.traceId);
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
