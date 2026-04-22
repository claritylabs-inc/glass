"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  UserCheck,
  CheckCircle,
  FileUp,
  Send,
  FileText,
  Bell,
  Package,
} from "lucide-react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyStateCard } from "@/components/ui/empty-state-card";

export type ActivityEvent = {
  _id: Id<"brokerActivity">;
  type: string;
  summary: string;
  createdAt: number;
  actorSide: "broker" | "client" | "system";
  clientOrgId: Id<"organizations">;
  clientOrgName?: string;
  payload?: Record<string, unknown>;
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  invitation_accepted: UserCheck,
  onboarding_completed: CheckCircle,
  document_uploaded: FileUp,
  application_sent: Send,
  application_batch_submitted: Package,
  application_completed: CheckCircle,
  policy_uploaded: FileText,
  policy_extraction_completed: FileText,
  notification_fired: Bell,
};

const TYPE_LABELS: Record<string, string> = {
  invitation_accepted: "Invitation accepted",
  onboarding_completed: "Onboarding completed",
  document_uploaded: "Document uploaded",
  application_sent: "Application sent",
  application_batch_submitted: "Application batch submitted",
  application_completed: "Application completed",
  policy_uploaded: "Policy uploaded",
  policy_extraction_completed: "Policy extracted",
  notification_fired: "Notification",
};

function groupByDay(events: ActivityEvent[]): { date: Date; events: ActivityEvent[] }[] {
  const groups: Map<string, { date: Date; events: ActivityEvent[] }> = new Map();
  for (const event of events) {
    const d = new Date(event.createdAt);
    const key = format(d, "yyyy-MM-dd");
    if (!groups.has(key)) {
      groups.set(key, { date: d, events: [] });
    }
    groups.get(key)!.events.push(event);
  }
  return Array.from(groups.values());
}

export function ActivityFeed({
  events,
  showClientColumn,
}: {
  events: ActivityEvent[] | undefined;
  showClientColumn: boolean;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const allTypes = useMemo(
    () => [...new Set((events ?? []).map((e) => e.type))],
    [events],
  );

  const filtered = useMemo(() => {
    if (!events) return [];
    if (typeFilter === "all") return events;
    return events.filter((e) => e.type === typeFilter);
  }, [events, typeFilter]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="space-y-6">
      {/* Type filter */}
      <Tabs value={typeFilter} onValueChange={setTypeFilter}>
        <TabsList variant="pill">
          <TabsTrigger value="all">All</TabsTrigger>
          {allTypes.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {events === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : grouped.length === 0 ? (
        <EmptyStateCard
          icon={<Bell className="w-5 h-5" />}
          title="No activity yet"
          description="Client events like invitations, document uploads, and policy changes will appear here."
        />
      ) : (
        grouped.map((group) => (
          <div key={group.date.toISOString()}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {format(group.date, "MMMM d, yyyy")}
            </p>
            <div className="space-y-2">
              {group.events.map((event) => {
                const Icon: React.ComponentType<{ className?: string }> = TYPE_ICONS[event.type] ?? Bell;
                return (
                  <div
                    key={event._id}
                    className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3"
                  >
                    <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{event.summary}</p>
                      {showClientColumn && event.clientOrgName && (
                        <Link
                          href={`/clients/${event.clientOrgId}`}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {event.clientOrgName}
                        </Link>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(event.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
