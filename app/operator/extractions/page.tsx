"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
const RANGE_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};
const STATUS_LABELS: Record<string, string> = {
  [ALL]: "All statuses",
  running: "Running",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled",
};
const RANGE_LABELS: Record<keyof typeof RANGE_MS, string> = {
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

export default function OperatorExtractionsPage() {
  const [status, setStatus] = useState<string>(ALL);
  const [range, setRange] = useState<keyof typeof RANGE_MS>("90d");
  const [orgId, setOrgId] = useState<string>(ALL);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = useQuery((api as any).operator.current, {});
  const dateFrom = useMemo(() => dayjs().valueOf() - RANGE_MS[range], [range]);
  const traces = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.listExtractionTraces,
    {
      status: status === ALL ? undefined : status,
      orgId: orgId === ALL ? undefined : orgId,
      dateFrom,
      limit: 250,
    },
  ) as TraceRow[] | undefined;
  const detail = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.getExtractionTrace,
    selectedTraceId ? { traceId: selectedTraceId } : "skip",
  ) as TraceDetail | null | undefined;

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
        if (value && value in RANGE_MS) setRange(value as keyof typeof RANGE_MS);
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
      title={selected?.policyLabel ?? "Extraction trace"}
    >
      {detail === undefined && selectedTraceId ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : selected ? (
        <>
          <section>
            <dl className="rounded-lg border border-foreground/6">
              <DetailRow label="Org" value={selected.orgName} />
              <DetailRow label="File" value={selected.fileName ?? "—"} />
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
            <h3 className="text-body-sm font-medium text-foreground">Phases</h3>
            <div className="rounded-lg border border-foreground/6">
              {phaseEvents.length ? phaseEvents.map((event) => (
                <div key={event._id} className="flex items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm text-foreground">{event.phase}</p>
                    <p className="text-label-sm text-muted-foreground">{event.status}</p>
                  </div>
                  <span className="shrink-0 text-body-sm text-muted-foreground">{formatDuration(event.durationMs)}</span>
                </div>
              )) : (
                <p className="px-3 py-3 text-body-sm text-muted-foreground">No phase timings recorded.</p>
              )}
            </div>
          </section>

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
        </>
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
                      <p className="truncate text-foreground">{trace.policyLabel}</p>
                      <p className="truncate text-label-sm text-muted-foreground">{trace.fileName ?? trace.trigger ?? trace.policyId}</p>
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
