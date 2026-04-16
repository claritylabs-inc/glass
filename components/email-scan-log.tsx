"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Mail,
  Inbox,
  Send,
  Plus,
  Copy,
} from "lucide-react";
import { ActivityLogSection, type LogEntry, type StatPill } from "@/components/activity-log-section";

interface ScanLogEntry extends LogEntry {
  connectionLabel: string;
  trigger: "manual" | "daily" | "calendar";
  inboxFound: number;
  sentFound: number;
  totalInserted: number;
  duplicatesSkipped: number;
  insuranceFound?: number;
}

export function EmailScanLog() {
  const logs = useQuery(api.emailScanLogs.list, {});

  function renderEntryTitle(entry: ScanLogEntry) {
    const triggerLabel =
      entry.trigger === "daily" ? "Daily Scan" :
      entry.trigger === "calendar" ? "Calendar Scan" :
      "Email Scan";
    return `${triggerLabel} · ${entry.connectionLabel}`;
  }

  function renderStats(entry: ScanLogEntry): StatPill[] {
    const pills: StatPill[] = [];
    if (entry.inboxFound > 0) {
      pills.push({
        icon: Inbox,
        label: `${entry.inboxFound} inbox`,
        colorClass: "text-muted-foreground",
      });
    }
    if (entry.sentFound > 0) {
      pills.push({
        icon: Send,
        label: `${entry.sentFound} sent`,
        colorClass: "text-muted-foreground",
      });
    }
    if (entry.totalInserted > 0) {
      pills.push({
        icon: Plus,
        label: `${entry.totalInserted} new`,
        colorClass: "text-emerald-500/70",
      });
    }
    if (entry.duplicatesSkipped > 0) {
      pills.push({
        icon: Copy,
        label: `${entry.duplicatesSkipped} skipped`,
        colorClass: "text-muted-foreground/50",
      });
    }
    return pills;
  }

  function classifyLogLine(line: string): "reasoning" | "error" | "complete" | "default" {
    if (line.startsWith("Error:") || line.includes("failed")) return "error";
    if (line.startsWith("Complete") || line.startsWith("Inserted")) return "complete";
    return "default";
  }

  return (
    <ActivityLogSection<ScanLogEntry>
      title="Email Scans"
      entries={logs as ScanLogEntry[] | undefined}
      loading={logs === undefined}
      emptyIcon={Mail}
      emptyMessage="No email scans yet"
      emptyDescription="Scan logs will appear here after your first email scan."
      renderEntryTitle={renderEntryTitle}
      renderStats={renderStats}
      classifyLogLine={classifyLogLine}
    />
  );
}
