"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Brain,
  Trash2,
  Sparkles,
  HelpCircle,
} from "lucide-react";
import { ActivityLogSection, type LogEntry, type StatPill } from "@/components/activity-log-section";

interface DreamLogEntry extends LogEntry {
  entriesReviewed: number;
  entriesDeleted: number;
  entriesConsolidated: number;
  gapsIdentified: number;
}

export function DreamLog() {
  const logs = useQuery(api.dreamLogs.list, {});

  function renderEntryTitle() {
    return "Context Consolidation";
  }

  function renderStats(entry: DreamLogEntry): StatPill[] {
    const pills: StatPill[] = [
      {
        icon: Brain,
        label: `${entry.entriesReviewed} reviewed`,
        colorClass: "text-muted-foreground",
      },
    ];
    if (entry.entriesDeleted > 0) {
      pills.push({
        icon: Trash2,
        label: `${entry.entriesDeleted} removed`,
        colorClass: "text-red-500/70",
      });
    }
    if (entry.entriesConsolidated > 0) {
      pills.push({
        icon: Sparkles,
        label: `${entry.entriesConsolidated} consolidated`,
        colorClass: "text-blue-500/70",
      });
    }
    if (entry.gapsIdentified > 0) {
      pills.push({
        icon: HelpCircle,
        label: `${entry.gapsIdentified} gaps`,
        colorClass: "text-amber-500/70",
      });
    }
    return pills;
  }

  return (
    <ActivityLogSection<DreamLogEntry>
      title="Context Consolidation"
      entries={logs as DreamLogEntry[] | undefined}
      loading={logs === undefined}
      emptyIcon={Brain}
      emptyMessage="No context consolidation runs yet"
      emptyDescription="Runs weekly to deduplicate and synthesize intelligence entries."
      renderEntryTitle={renderEntryTitle}
      renderStats={renderStats}
    />
  );
}
