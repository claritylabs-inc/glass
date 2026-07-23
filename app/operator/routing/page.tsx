"use client";

import dayjs from "dayjs";
import { useAction, useQuery } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import { formatDisplayDateTime } from "@/lib/date-format";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { OperatorSidebar } from "../operator-sidebar";

type Route = { provider: string; model: string };
type Routing = {
  decision: string;
  candidatesConsidered: Route[];
  policyVersion: string | null;
  cacheStickinessApplied: boolean;
  routeSource?: string;
  attemptCount?: number;
  shadowMode?: boolean;
  wouldHaveChosen?: Route & { decision: string };
  wouldHaveMatched?: boolean;
};
type RoutingEvent = {
  _id: string;
  kind: "model_step" | "direct_fallback" | "run";
  task: string;
  taskKind: string;
  channel: string;
  step?: number;
  requestId?: string;
  provider?: string;
  model?: string;
  routing?: Routing;
  status?: "complete" | "error" | "fallback";
  toolCallCount?: number;
  workflowOutcomeCount?: number;
  workflowFailureCount?: number;
  costUsd?: number | null;
  error?: string;
  timestamp: number;
};
type RouterHealth = {
  status: "ok" | "degraded";
  environment: string;
  database: boolean;
  frozen: boolean;
  policyVersion: string | null;
};
type Candidate = Route & {
  rank: number;
  role: "primary" | "challenger" | "quarantined";
  trafficPct: number;
  rollingScore: number | null;
  onlineCallCount: number;
};
type Policy = {
  id: string;
  version: number;
  taskFamily: string;
  qualityBar: number;
  explorationPct: number;
  frozen: boolean;
  frozenRoute: Route | null;
  candidates: Candidate[];
};
type Rollup = {
  hourStart: string;
  taskFamily: string;
  provider: string;
  model: string;
  callCount: number;
  successCount: number;
  fallbackCount: number;
  providerErrorCount: number;
  cacheHitCount: number;
  feedbackCount: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  pricedCallCount: number;
  costNanoUsd: string;
};
type DashboardResult = {
  configured: boolean;
  fetchedAt: number;
  health: { data: RouterHealth | null; error: string | null };
  policy: { data: Policy | Policy[] | null; error: string | null };
  rollups: { data: Rollup[] | null; error: string | null };
};

function routeLabel(route: Route | null | undefined) {
  return route ? `${route.provider} / ${route.model}` : "None";
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatCost(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 6 : 2,
  }).format(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function OperatorRoutingPage() {
  const current = useCachedOperatorCurrent();
  const getDashboard = useAction(api.clRouterOperations.getDashboard);
  const events = useQuery(api.modelRoutingEvents.listRecent, { limit: 200 }) as
    | RoutingEvent[]
    | undefined;
  const [dashboard, setDashboard] = useState<DashboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDashboard((await getDashboard({})) as DashboardResult);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [getDashboard]);

  useEffect(() => {
    let cancelled = false;
    void getDashboard({})
      .then((result) => {
        if (cancelled) return;
        setDashboard(result as DashboardResult);
        setLoadError(null);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getDashboard]);

  const policies = useMemo(() => {
    const value = dashboard?.policy.data;
    if (!value) return [];
    return (Array.isArray(value) ? value : [value])
      .slice()
      .sort((left, right) => left.taskFamily.localeCompare(right.taskFamily));
  }, [dashboard?.policy.data]);

  const recentEvents = useMemo(
    () =>
      (events ?? [])
        .filter((event) => event.kind !== "run" || event.status === "error")
        .slice(0, 50),
    [events],
  );
  const recentRuns = useMemo(
    () => (events ?? []).filter((event) => event.kind === "run"),
    [events],
  );
  const shadowMode = recentEvents.find(
    (event) => event.routing?.shadowMode !== undefined,
  )?.routing?.shadowMode;
  const health = dashboard?.health.data;
  const posture = health?.frozen
    ? "Frozen"
    : shadowMode === true
      ? "Shadow"
      : health
        ? "Autonomous"
        : "Unknown";

  const last24HourRollups = useMemo(() => {
    const cutoff = dayjs().subtract(24, "hour");
    return (dashboard?.rollups.data ?? []).filter((row) =>
      dayjs(row.hourStart).isAfter(cutoff),
    );
  }, [dashboard?.rollups.data]);
  const totals = useMemo(
    () =>
      last24HourRollups.reduce(
        (sum, row) => ({
          calls: sum.calls + row.callCount,
          successes: sum.successes + row.successCount,
          fallbacks: sum.fallbacks + row.fallbackCount,
          errors: sum.errors + row.providerErrorCount,
          cacheHits: sum.cacheHits + row.cacheHitCount,
          feedback: sum.feedback + row.feedbackCount,
          pricedCalls: sum.pricedCalls + row.pricedCallCount,
          weightedP50:
            sum.weightedP50 + row.latencyP50Ms * row.callCount,
          peakP95: Math.max(sum.peakP95, row.latencyP95Ms),
          cost: sum.cost + Number(row.costNanoUsd) / 1_000_000_000,
        }),
        {
          calls: 0,
          successes: 0,
          fallbacks: 0,
          errors: 0,
          cacheHits: 0,
          feedback: 0,
          pricedCalls: 0,
          weightedP50: 0,
          peakP95: 0,
          cost: 0,
        },
      ),
    [last24HourRollups],
  );
  const failedRuns = recentRuns.filter((run) => run.status === "error").length;
  const workflowRuns = recentRuns.filter(
    (run) => (run.workflowOutcomeCount ?? 0) > 0,
  );
  const workflowFailures = workflowRuns.filter(
    (run) => (run.workflowFailureCount ?? 0) > 0,
  ).length;

  return (
    <AppShell
      actions={
        <PillButton
          variant="secondary"
          size="compact"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh
        </PillButton>
      }
      breadcrumbDetail="Routing"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="routing"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
    >
      <main className="flex w-full flex-col gap-4">
        <OperationalLabelValueList title="Router state">
          <OperationalLabelValueRow label="Posture" value={posture} />
          <OperationalLabelValueRow
            label="Environment"
            value={health?.environment ?? "Unavailable"}
          />
          <OperationalLabelValueRow
            label="Health"
            value={
              health
                ? `${health.status} · database ${health.database ? "connected" : "unavailable"}`
                : (dashboard?.health.error ?? loadError ?? "Loading")
            }
          />
          <OperationalLabelValueRow
            label="Policy version"
            value={health?.policyVersion ?? "None"}
          />
          <OperationalLabelValueRow
            label="Shadow comparison"
            value={
              shadowMode === undefined
                ? "No recent routed response"
                : shadowMode
                  ? "Enabled"
                  : "Disabled"
            }
          />
          <OperationalLabelValueRow
            label="Last refresh"
            value={
              dashboard
                ? formatDisplayDateTime(dashboard.fetchedAt)
                : loading
                  ? "Loading"
                  : "Unavailable"
            }
          />
        </OperationalLabelValueList>

        <OperationalPanel>
          <OperationalPanelHeader
            title="Last 24 hours"
            description="Router rollups plus Glass workflow outcomes."
          />
          {dashboard?.rollups.error ? (
            <OperationalPanelBody className="text-base text-destructive">
              {dashboard.rollups.error}
            </OperationalPanelBody>
          ) : (
            <div className="grid grid-cols-2 divide-x divide-y divide-foreground/6 sm:grid-cols-4">
              {[
                ["Calls", totals.calls.toLocaleString()],
                [
                  "Success",
                  totals.calls
                    ? formatPercent(totals.successes / totals.calls)
                    : "—",
                ],
                ["Cost", formatCost(totals.cost)],
                [
                  "Cache rate",
                  totals.calls
                    ? formatPercent(totals.cacheHits / totals.calls)
                    : "—",
                ],
                ["Fallbacks", totals.fallbacks.toLocaleString()],
                ["Provider errors", totals.errors.toLocaleString()],
                ["Feedback", totals.feedback.toLocaleString()],
                [
                  "Latency p50 / peak p95",
                  totals.calls
                    ? `${Math.round(totals.weightedP50 / totals.calls).toLocaleString()} / ${totals.peakP95.toLocaleString()} ms`
                    : "—",
                ],
                [
                  "Priced calls",
                  `${totals.pricedCalls.toLocaleString()} / ${totals.calls.toLocaleString()}`,
                ],
                [
                  "Workflow failures",
                  workflowRuns.length
                    ? `${workflowFailures} / ${workflowRuns.length}`
                    : `0 · ${failedRuns} run errors`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 px-4 py-3">
                  <p className="text-label text-muted-foreground">{label}</p>
                  <p className="mt-1 truncate text-base font-medium text-foreground">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </OperationalPanel>

        <OperationalPanel>
          <OperationalPanelHeader
            title="Task policies"
            description="Current frozen route, primary candidate, challengers, and online score."
          />
          {dashboard?.policy.error ? (
            <OperationalPanelBody className="text-base text-destructive">
              {dashboard.policy.error}
            </OperationalPanelBody>
          ) : policies.length === 0 ? (
            <OperationalPanelBody className="text-base text-muted-foreground">
              No active router policies.
            </OperationalPanelBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-base">
                <thead className="border-b border-foreground/6 text-label text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-normal">Task</th>
                    <th className="px-4 py-2.5 font-normal">State</th>
                    <th className="px-4 py-2.5 font-normal">Executing route</th>
                    <th className="px-4 py-2.5 font-normal">Challengers</th>
                    <th className="px-4 py-2.5 font-normal">Score / calls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/6">
                  {policies.map((policy) => {
                    const primary = policy.candidates.find(
                      (candidate) => candidate.role === "primary",
                    );
                    const challengers = policy.candidates.filter(
                      (candidate) => candidate.role === "challenger",
                    );
                    return (
                      <tr key={policy.id}>
                        <td className="px-4 py-3 font-medium">
                          {policy.taskFamily}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {policy.frozen ? "Frozen" : "Autonomous"} · v
                          {policy.version}
                        </td>
                        <td className="px-4 py-3">
                          {routeLabel(policy.frozenRoute ?? primary)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {challengers.length
                            ? challengers.map(routeLabel).join(", ")
                            : "None"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {primary?.rollingScore === null ||
                          primary?.rollingScore === undefined
                            ? "Unscored"
                            : formatPercent(primary.rollingScore)}
                          {" · "}
                          {(primary?.onlineCallCount ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </OperationalPanel>

        <OperationalPanel>
          <OperationalPanelHeader
            title="Recent routing"
            description="Actual route, shadow choice, request ID, fallback, and error evidence from Glass."
          />
          {events === undefined ? (
            <OperationalPanelBody className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </OperationalPanelBody>
          ) : recentEvents.length === 0 ? (
            <OperationalPanelBody className="text-base text-muted-foreground">
              No routed model steps recorded yet.
            </OperationalPanelBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-base">
                <thead className="border-b border-foreground/6 text-label text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-normal">Time</th>
                    <th className="px-4 py-2.5 font-normal">Task / surface</th>
                    <th className="px-4 py-2.5 font-normal">Actual</th>
                    <th className="px-4 py-2.5 font-normal">Would choose</th>
                    <th className="px-4 py-2.5 font-normal">Request</th>
                    <th className="px-4 py-2.5 font-normal">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/6">
                  {recentEvents.map((event) => (
                    <tr key={event._id}>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatDisplayDateTime(event.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{event.task}</span>
                        <span className="text-muted-foreground">
                          {" · "}
                          {event.channel}
                          {event.step ? ` · step ${event.step}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {routeLabel(
                          event.provider && event.model
                            ? { provider: event.provider, model: event.model }
                            : undefined,
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {routeLabel(event.routing?.wouldHaveChosen)}
                      </td>
                      <td
                        className="max-w-48 truncate px-4 py-3 font-mono text-label text-muted-foreground"
                        title={event.requestId}
                      >
                        {event.requestId ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {event.kind === "direct_fallback"
                          ? `Direct fallback${event.error ? ` · ${event.error}` : ""}`
                          : event.kind === "run"
                            ? `Run error${event.error ? ` · ${event.error}` : ""}`
                          : (event.routing?.decision ?? "Completed")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </OperationalPanel>
      </main>
    </AppShell>
  );
}
