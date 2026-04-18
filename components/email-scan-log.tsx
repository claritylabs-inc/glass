"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ActivityLogSection, type LogEntry, type StatPill } from "@/components/activity-log-section";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ScanLogEntry extends LogEntry {
  connectionLabel: string;
  trigger: "manual" | "daily" | "calendar";
  inboxFound: number;
  sentFound: number;
  totalInserted: number;
  duplicatesSkipped: number;
  insuranceFound?: number;
}

interface ConnectionSummary {
  _id: Id<"emailConnections">;
  provider?: string;
}

export function EmailScanLog() {
  const logs = useQuery(api.emailScanLogs.list, {});
  const connections = useQuery(api.connections.list, {});
  const scanInbox = useAction(api.actions.scanInbox.scanInbox);
  const scanGmail = useAction(api.actions.scanGmail.scanGmail);
  const [scanning, setScanning] = useState(false);

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
        label: `${entry.inboxFound} inbox`,
        colorClass: "text-muted-foreground",
      });
    }
    if (entry.sentFound > 0) {
      pills.push({
        label: `${entry.sentFound} sent`,
        colorClass: "text-muted-foreground",
      });
    }
    if (entry.totalInserted > 0) {
      pills.push({
        label: `${entry.totalInserted} new`,
        colorClass: "text-emerald-500/70",
      });
    }
    if (entry.duplicatesSkipped > 0) {
      pills.push({
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

  async function runAllScans() {
    const available = (connections ?? []) as ConnectionSummary[];
    if (available.length === 0) {
      toast.error("Add an email connection to start scanning.");
      return;
    }

    setScanning(true);
    try {
      await Promise.all(
        available.map((connection) => {
          if (connection.provider === "google") {
            return scanGmail({ connectionId: connection._id });
          }
          return scanInbox({ connectionId: connection._id });
        }),
      );
      toast.success(`Started scans for ${available.length} connection${available.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Failed to start one or more scans.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <ActivityLogSection<ScanLogEntry>
      title="Email Scans"
      entries={logs as ScanLogEntry[] | undefined}
      loading={logs === undefined}

      emptyMessage="No email scans yet"
      emptyDescription="Run a scan now to pull in emails and kick off policy extraction."
      emptyAction={
        <PillButton onClick={runAllScans} disabled={scanning || connections === undefined}>
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {scanning ? "Starting scans..." : "Scan connected inboxes"}
        </PillButton>
      }
      renderEntryTitle={renderEntryTitle}
      renderStats={renderStats}
      classifyLogLine={classifyLogLine}
    />
  );
}
