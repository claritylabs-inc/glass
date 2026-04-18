"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ActivityLogSection, type LogEntry, type StatPill } from "@/components/activity-log-section";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface DreamLogEntry extends LogEntry {
  entriesReviewed: number;
  entriesDeleted: number;
  entriesConsolidated: number;
  gapsIdentified: number;
}

export function DreamLog() {
  const logs = useQuery(api.dreamLogs.list, {});
  const consolidate = useAction(api.actions.dreamConsolidation.consolidate);
  const [runningNow, setRunningNow] = useState(false);

  function renderEntryTitle() {
    return "Context Consolidation";
  }

  function renderStats(entry: DreamLogEntry): StatPill[] {
    const pills: StatPill[] = [
      {
        label: `${entry.entriesReviewed} reviewed`,
        colorClass: "text-muted-foreground",
      },
    ];
    if (entry.entriesDeleted > 0) {
      pills.push({
        label: `${entry.entriesDeleted} removed`,
        colorClass: "text-red-500/70",
      });
    }
    if (entry.entriesConsolidated > 0) {
      pills.push({
        label: `${entry.entriesConsolidated} consolidated`,
        colorClass: "text-blue-500/70",
      });
    }
    if (entry.gapsIdentified > 0) {
      pills.push({
        label: `${entry.gapsIdentified} gaps`,
        colorClass: "text-amber-500/70",
      });
    }
    return pills;
  }

  async function runConsolidationNow() {
    setRunningNow(true);
    try {
      await consolidate({});
      toast.success("Consolidation run started.");
    } catch {
      toast.error("Failed to start consolidation.");
    } finally {
      setRunningNow(false);
    }
  }

  return (
    <ActivityLogSection<DreamLogEntry>
      title="Context Consolidation"
      entries={logs as DreamLogEntry[] | undefined}
      loading={logs === undefined}

      emptyMessage="No context consolidation runs yet"
      emptyDescription="Run one now to clean and consolidate organization intelligence immediately."
      emptyAction={
        <PillButton onClick={runConsolidationNow} disabled={runningNow}>
          {runningNow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {runningNow ? "Starting run..." : "Run consolidation now"}
        </PillButton>
      }
      renderEntryTitle={renderEntryTitle}
      renderStats={renderStats}
    />
  );
}
