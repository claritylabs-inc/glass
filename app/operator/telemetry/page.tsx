"use client";

import { usePaginatedQuery } from "convex/react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExtractionReviewPanel } from "@/components/operator/extraction-review-panel";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import {
  RoutingEventDrawer,
  actualRouteLabel,
  routeLabel,
  routingEventOutcome,
  routingEventSummary,
  type RoutingEvent,
} from "../routing/routing-tab";
import { OperatorSidebar } from "../operator-sidebar";
import { useTabParam } from "@/hooks/use-tab-param";

type RequirementExtractionRun = {
  _id: string;
  runId: string;
  orgName: string;
  sourceName: string;
  sourceType: string;
  trigger: "web_import" | "mailbox_import";
  scope: "vendors" | "own_org";
  status: "running" | "complete" | "error";
  phase?: string;
  parserBackend?: string;
  sourceCharacterCount?: number;
  requestId?: string;
  provider?: string;
  model?: string;
  routeSource?: string;
  transport?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
  extractedRequirementCount?: number;
  checkableRequirementCount?: number;
  extractedHolderCount?: number;
  createdRequirementCount?: number;
  duplicateRequirementCount?: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
  totalDurationMs?: number;
};

function displayIdentifier(value: string | undefined) {
  return value?.replaceAll("_", " ") ?? "—";
}

function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function RequirementExtractionDrawer({
  run,
  onClose,
}: {
  run: RequirementExtractionRun;
  onClose: () => void;
}) {
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Requirement extraction"
    >
      <div className="space-y-4">
        <ExtractionReviewPanel
          targetKind="requirement_extraction"
          targetId={run.runId}
        />
        <OperationalLabelValueList title="Run">
          <OperationalLabelValueRow label="Source" value={run.sourceName} />
          <OperationalLabelValueRow label="Organization" value={run.orgName} />
          <OperationalLabelValueRow
            label="Status"
            value={
              <StatusTag
                tone={
                  run.status === "complete"
                    ? "success"
                    : run.status === "error"
                      ? "danger"
                      : "neutral"
                }
              >
                {displayIdentifier(run.status)}
              </StatusTag>
            }
          />
          <OperationalLabelValueRow
            label="Started"
            value={formatDisplayDateTime(run.startedAt)}
          />
          <OperationalLabelValueRow
            label="Duration"
            value={formatDuration(run.totalDurationMs)}
          />
          <OperationalLabelValueRow
            label="Source type"
            value={displayIdentifier(run.sourceType)}
          />
          <OperationalLabelValueRow
            label="Parser"
            value={displayIdentifier(run.parserBackend)}
          />
          <OperationalLabelValueRow
            label="Characters"
            value={run.sourceCharacterCount?.toLocaleString()}
          />
          <OperationalLabelValueRow
            label="Extracted / saved"
            value={
              run.extractedRequirementCount === undefined
                ? undefined
                : `${run.extractedRequirementCount.toLocaleString()} / ${(run.createdRequirementCount ?? 0).toLocaleString()}`
            }
          />
          <OperationalLabelValueRow
            label="Checkable requirements"
            value={run.checkableRequirementCount?.toLocaleString()}
          />
          <OperationalLabelValueRow
            label="Certificate holders"
            value={run.extractedHolderCount?.toLocaleString()}
          />
          <OperationalLabelValueRow
            label="Duplicates"
            value={run.duplicateRequirementCount?.toLocaleString()}
          />
          <OperationalLabelValueRow
            label="Route"
            value={
              run.provider && run.model
                ? `${run.provider} / ${run.model}`
                : undefined
            }
          />
          <OperationalLabelValueRow
            label="Transport"
            value={displayIdentifier(run.transport)}
          />
          <OperationalLabelValueRow
            label="Tokens"
            value={
              run.inputTokens === undefined && run.outputTokens === undefined
                ? undefined
                : `${(run.inputTokens ?? 0).toLocaleString()} in / ${(run.outputTokens ?? 0).toLocaleString()} out`
            }
          />
          <OperationalLabelValueRow
            label="Cost"
            value={
              run.costUsd === undefined
                ? undefined
                : run.costUsd === null
                  ? "Unpriced"
                  : `$${run.costUsd.toFixed(6)}`
            }
          />
          <OperationalLabelValueRow
            label="Request ID"
            value={
              run.requestId ? (
                <code className={`break-all ${typeStyle("technical.codeCompact")}`}>
                  {run.requestId}
                </code>
              ) : undefined
            }
          />
          <OperationalLabelValueRow
            label="Error"
            value={
              run.error ? <span className="text-destructive">{run.error}</span> : undefined
            }
          />
        </OperationalLabelValueList>
      </div>
    </SettingsDrawer>
  );
}

const TELEMETRY_TABS = ["requirement-extractions", "model-routing"] as const;

export default function OperatorTelemetryPage() {
  const [activeTab, selectTab] = useTabParam(TELEMETRY_TABS);
  const { results, status, loadMore } = usePaginatedQuery(
    api.modelRoutingEvents.listPaginated,
    {},
    { initialNumItems: 100 },
  );
  const events = results;
  const requirementRunsQuery = usePaginatedQuery(
    api.requirementExtractionRuns.listPaginated,
    {},
    { initialNumItems: 50 },
  );
  const requirementRuns = requirementRunsQuery.results as RequirementExtractionRun[];
  const [query, setQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<RoutingEvent | null>(null);
  const [selectedRequirementRun, setSelectedRequirementRun] =
    useState<RequirementExtractionRun | null>(null);

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (!needle) return true;
      return [
        event.task,
        event.taskKind,
        event.channel,
        event.kind,
        event.status,
        event.label,
        event.phase,
        event.provider,
        event.model,
        event.fallbackProvider,
        event.fallbackModel,
        event.error,
        event.fallbackReason,
        event.requestId,
        event.runId,
        event.orgId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [events, query]);

  const filteredRequirementRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return requirementRuns.filter((run) => {
      if (!needle) return true;
      return [
        run.sourceName,
        run.orgName,
        run.sourceType,
        run.trigger,
        run.scope,
        run.status,
        run.phase,
        run.parserBackend,
        run.provider,
        run.model,
        run.transport,
        run.requestId,
        run.runId,
        run.error,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [query, requirementRuns]);

  return (
    <AppShell
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="telemetry"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      actions={
        <InputGroup className="w-44 sm:w-72">
          <InputGroupAddon>
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search telemetry"
            aria-label="Search telemetry"
          />
        </InputGroup>
      }
      rightPanel={
        selectedRequirementRun ? (
          <RequirementExtractionDrawer
            run={selectedRequirementRun}
            onClose={() => setSelectedRequirementRun(null)}
          />
        ) : selectedEvent ? (
          <RoutingEventDrawer
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        ) : undefined
      }
    >
      <main className="w-full">
        <Tabs
          value={activeTab}
          className="gap-4"
          onValueChange={(tab) => {
            setSelectedEvent(null);
            setSelectedRequirementRun(null);
            selectTab(tab);
          }}
        >
          <TabsList variant="pill" aria-label="Telemetry section">
            <TabsTrigger value="requirement-extractions">
              Requirement extractions
            </TabsTrigger>
            <TabsTrigger value="model-routing">Model routing</TabsTrigger>
          </TabsList>

          <TabsContent value="requirement-extractions">
            <OperationalPanel>
              {requirementRunsQuery.status === "LoadingFirstPage" ? (
                <OperationalPanelBody className="flex h-24 items-center justify-center text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </OperationalPanelBody>
              ) : filteredRequirementRuns.length === 0 ? (
                <OperationalPanelBody
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {query.trim()
                    ? "No requirement extractions match this search."
                    : "No requirement extraction runs yet."}
                </OperationalPanelBody>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Parser</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Extracted / saved</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequirementRuns.map((run) => (
                      <TableRow
                        key={run._id}
                        data-state={
                          selectedRequirementRun?._id === run._id
                            ? "selected"
                            : undefined
                        }
                      >
                        <TableCell className="text-muted-foreground">
                          {formatDisplayDateTime(run.startedAt)}
                        </TableCell>
                        <TableCell>
                          <StatusTag
                            tone={
                              run.status === "complete"
                                ? "success"
                                : run.status === "error"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {displayIdentifier(run.status)}
                          </StatusTag>
                        </TableCell>
                        <TableCell className="min-w-64 whitespace-normal">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEvent(null);
                              setSelectedRequirementRun(run);
                            }}
                            className="group flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus-visible:ring-1 focus-visible:ring-foreground/20"
                          >
                            <span className="min-w-0">
                              <span
                                className={`block truncate text-foreground ${typeStyle("body.medium")}`}
                              >
                                {run.sourceName}
                              </span>
                              <span
                                className={`block text-muted-foreground ${typeStyle("caption.default")}`}
                              >
                                {run.orgName} ·{" "}
                                {displayIdentifier(run.sourceType)}
                              </span>
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                          </button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {displayIdentifier(run.parserBackend)}
                        </TableCell>
                        <TableCell>
                          {run.provider && run.model
                            ? `${run.provider} / ${run.model}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {run.extractedRequirementCount === undefined
                            ? "—"
                            : `${run.extractedRequirementCount.toLocaleString()} / ${(run.createdRequirementCount ?? 0).toLocaleString()}`}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDuration(run.totalDurationMs)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {requirementRunsQuery.status === "CanLoadMore" ||
              requirementRunsQuery.status === "LoadingMore" ? (
                <div className="flex justify-center border-t border-border p-4">
                  <PillButton
                    variant="secondary"
                    size="compact"
                    disabled={requirementRunsQuery.status === "LoadingMore"}
                    onClick={() => requirementRunsQuery.loadMore(50)}
                  >
                    {requirementRunsQuery.status === "LoadingMore" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Load older requirement runs
                  </PillButton>
                </div>
              ) : null}
            </OperationalPanel>
          </TabsContent>

          <TabsContent value="model-routing">
            <OperationalPanel>
              {status === "LoadingFirstPage" ? (
                <OperationalPanelBody className="flex h-24 items-center justify-center text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </OperationalPanelBody>
              ) : filteredEvents.length === 0 ? (
                <OperationalPanelBody
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {query.trim()
                    ? "No telemetry matches this search."
                    : "No telemetry events yet."}
                </OperationalPanelBody>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Channel / task</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Would choose</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvents.map((event) => {
                      const eventOutcome = routingEventOutcome(event);
                      const summary = routingEventSummary(event);
                      return (
                        <TableRow
                          key={event._id}
                          data-state={
                            selectedEvent?._id === event._id
                              ? "selected"
                              : undefined
                          }
                        >
                          <TableCell className="text-muted-foreground">
                            {formatDisplayDateTime(event.timestamp)}
                          </TableCell>
                          <TableCell>
                            <StatusTag tone={eventOutcome.tone}>
                              {eventOutcome.label}
                            </StatusTag>
                          </TableCell>
                          <TableCell className="min-w-64 whitespace-normal">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRequirementRun(null);
                                setSelectedEvent(event);
                              }}
                              className="group flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus-visible:ring-1 focus-visible:ring-foreground/20"
                            >
                              <span className="min-w-0">
                                <span
                                  className={`block truncate text-foreground ${typeStyle("body.medium")}`}
                                >
                                  {event.channel} · {event.task}
                                </span>
                                <span
                                  className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
                                >
                                  {event.taskKind} · {event.phase}
                                </span>
                              </span>
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-active:translate-x-0.5 motion-reduce:transition-none" />
                            </button>
                          </TableCell>
                          <TableCell>{actualRouteLabel(event)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {routeLabel(event.routing?.wouldHaveChosen)}
                          </TableCell>
                          <TableCell
                            className="max-w-80 truncate text-muted-foreground"
                            title={summary}
                          >
                            {summary}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              {status === "CanLoadMore" || status === "LoadingMore" ? (
                <div className="flex justify-center border-t border-border p-4">
                  <PillButton
                    variant="secondary"
                    size="compact"
                    disabled={status === "LoadingMore"}
                    onClick={() => loadMore(100)}
                  >
                    {status === "LoadingMore" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Load older events
                  </PillButton>
                </div>
              ) : null}
            </OperationalPanel>
          </TabsContent>
        </Tabs>
      </main>
    </AppShell>
  );
}
