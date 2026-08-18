"use client";

import { usePaginatedQuery } from "convex/react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
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

export default function OperatorTelemetryPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.modelRoutingEvents.listPaginated,
    {},
    { initialNumItems: 100 },
  );
  const events = results;
  const [query, setQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<RoutingEvent | null>(null);

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
        selectedEvent ? (
          <RoutingEventDrawer
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        ) : undefined
      }
    >
      <main className="w-full">
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
