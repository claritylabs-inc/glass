"use client";

import { usePaginatedQuery } from "convex/react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/ui/status-tag";
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
  routeLabel,
  routingEventOutcome,
  routingEventSummary,
  type RoutingEvent,
} from "../routing/routing-tab";
import { OperatorSidebar } from "../operator-sidebar";

type OutcomeFilter = "all" | "error" | "fallback" | "complete";

function matchesOutcome(event: RoutingEvent, filter: OutcomeFilter) {
  if (filter === "all") return true;
  if (filter === "error") return event.status === "error";
  if (filter === "fallback") {
    return event.kind === "direct_fallback" || Boolean(event.fallbackModel);
  }
  return (
    event.status !== "error" &&
    event.kind !== "direct_fallback" &&
    !event.fallbackModel
  );
}

export default function OperatorTelemetryPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.modelRoutingEvents.listPaginated,
    {},
    { initialNumItems: 100 },
  );
  const events = results;
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("all");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [selectedEvent, setSelectedEvent] = useState<RoutingEvent | null>(null);

  const channels = useMemo(
    () => [...new Set(events.map((event) => event.channel))].sort(),
    [events],
  );
  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (channel !== "all" && event.channel !== channel) return false;
      if (!matchesOutcome(event, outcome)) return false;
      if (!needle) return true;
      return [
        event.task,
        event.taskKind,
        event.channel,
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
  }, [channel, events, outcome, query]);

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
      showBrokerShare={false}
      rightPanel={
        selectedEvent ? (
          <RoutingEventDrawer
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        ) : undefined
      }
    >
      <main className="flex w-full flex-col gap-4">
        <OperationalPanel>
          <OperationalPanelHeader
            title="Agent telemetry"
            description="A live, cross-channel log of direct and routed model runs, fallbacks, tool workflows, and errors. Events are retained for 30 days."
          />
          <OperationalPanelBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search telemetry</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search task, route, error, request, run, or organization"
                className="pl-9"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Select
                value={outcome}
                onValueChange={(value) => setOutcome(value as OutcomeFilter)}
              >
                <SelectTrigger aria-label="Filter by outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All outcomes</SelectItem>
                  <SelectItem value="error">Errors</SelectItem>
                  <SelectItem value="fallback">Fallbacks</SelectItem>
                  <SelectItem value="complete">Completed</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={channel}
                onValueChange={(value) => value && setChannel(value)}
              >
                <SelectTrigger aria-label="Filter by channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  {channels.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </OperationalPanelBody>
        </OperationalPanel>

        <OperationalPanel>
          <OperationalPanelHeader
            title="Global log"
            description={`Showing ${filteredEvents.length.toLocaleString()} of ${events.length.toLocaleString()} loaded events.`}
          />
          {status === "LoadingFirstPage" ? (
            <OperationalPanelBody className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </OperationalPanelBody>
          ) : filteredEvents.length === 0 ? (
            <OperationalPanelBody
              className={`text-muted-foreground ${typeStyle("body.default")}`}
            >
              No telemetry matches these filters.
            </OperationalPanelBody>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Channel / task</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Request</TableHead>
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
                          onClick={() => setSelectedEvent(event)}
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
                      <TableCell>
                        {routeLabel(
                          event.provider && event.model
                            ? {
                                provider: event.provider,
                                model: event.model,
                              }
                            : undefined,
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {event.transport ?? "—"}
                      </TableCell>
                      <TableCell
                        className="max-w-80 truncate text-muted-foreground"
                        title={summary}
                      >
                        {summary}
                      </TableCell>
                      <TableCell
                        className={`max-w-48 truncate text-muted-foreground ${typeStyle("technical.codeCompact")}`}
                        title={event.requestId}
                      >
                        {event.requestId ?? "—"}
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
      </main>
    </AppShell>
  );
}
