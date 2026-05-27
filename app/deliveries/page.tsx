"use client";

import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FileText, Loader2, MessageSquare, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { usePdf } from "@/components/pdf-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DeliveryStatus =
  | "queued"
  | "review_required"
  | "sending"
  | "sent"
  | "partially_sent"
  | "blocked"
  | "failed"
  | "suppressed"
  | "cancelled";

type DeliveryJob = {
  _id: Id<"policyDeliveryJobs">;
  clientOrgId: Id<"organizations">;
  clientName?: string;
  sourceKind: "policy" | "endorsement";
  status: DeliveryStatus;
  action: string;
  channels: Array<"email" | "imessage">;
  ruleName?: string;
  decisionSummary?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  lastError?: string;
  threadId?: Id<"threads">;
  policy?: {
    _id: Id<"policies">;
    fileId?: Id<"_storage">;
    carrier?: string;
    security?: string;
    policyNumber?: string;
    insuredName?: string;
    fileName?: string;
  };
  attempts?: Array<{
    _id: Id<"policyDeliveryAttempts">;
    channel: "email" | "imessage";
    status: "sent" | "failed" | "skipped";
    error?: string;
    createdAt: number;
  }>;
  updatedAt: number;
};

const TABS: Array<{ value: "all" | DeliveryStatus; label: string }> = [
  { value: "review_required", label: "Needs review" },
  { value: "blocked", label: "Blocked" },
  { value: "failed", label: "Failed" },
  { value: "sent", label: "Sent" },
  { value: "all", label: "All" },
];

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  queued: "Queued",
  review_required: "Needs review",
  sending: "Sending",
  sent: "Sent",
  partially_sent: "Partial",
  blocked: "Blocked",
  failed: "Failed",
  suppressed: "Suppressed",
  cancelled: "Cancelled",
};

function statusVariant(status: DeliveryStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "sent") return "default";
  if (status === "failed" || status === "blocked") return "destructive";
  if (status === "review_required" || status === "partially_sent") return "secondary";
  return "outline";
}

function channelLabel(channels: Array<"email" | "imessage">) {
  if (channels.length === 2) return "Email + iMessage";
  if (channels[0] === "imessage") return "iMessage";
  if (channels[0] === "email") return "Email";
  return "None";
}

function actionLabel(action: string) {
  const normalized = action.trim().toLowerCase();
  if (normalized === "do_not_send" || normalized === "suppress") return "Do not deliver";
  if (normalized === "broker_review" || normalized === "review") return "Needs review";
  if (normalized === "auto_send") return "Send automatically";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ") || "Unknown";
}

function statusDescription(job: DeliveryJob) {
  if (job.status === "suppressed") {
    return job.decisionSummary ?? "Delivery was not sent because the current broker or client settings do not allow it.";
  }
  if (job.status === "blocked") {
    return job.lastError ?? job.decisionSummary ?? "Delivery is blocked until the missing setup is resolved.";
  }
  if (job.status === "failed") {
    return job.lastError ?? "Delivery failed. Retry after reviewing the recipient and channel settings.";
  }
  if (job.status === "review_required") {
    return job.decisionSummary ?? "Review this policy delivery before sending it to the client.";
  }
  return job.decisionSummary ?? "Delivery is ready.";
}

function DeliveryDrawer({
  job,
  onClose,
}: {
  job: DeliveryJob;
  onClose: () => void;
}) {
  const sendReviewed = useMutation(api.policyDelivery.sendReviewedJob);
  const retry = useMutation(api.policyDelivery.retryJob);
  const suppress = useMutation(api.policyDelivery.suppressJob);
  const [busy, setBusy] = useState<string | null>(null);
  const canSuppress = !["suppressed", "cancelled", "sent", "partially_sent"].includes(job.status);
  const canRetry = ["failed", "blocked", "suppressed"].includes(job.status);
  const canSend = job.status === "review_required";

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      toast.success("Delivery updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update delivery");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsDrawer
      open={!!job}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Policy delivery"
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={onClose}>
            Close
          </PillButton>
          {canSuppress ? (
            <PillButton type="button" variant="secondary" onClick={() => run("suppress", () => suppress({ id: job._id }))}>
              {busy === "suppress" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Suppress
            </PillButton>
          ) : null}
          {canRetry ? (
            <PillButton type="button" variant="secondary" onClick={() => run("retry", () => retry({ id: job._id }))}>
              {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Retry
            </PillButton>
          ) : null}
          {canSend ? (
            <PillButton type="button" onClick={() => run("send", () => sendReviewed({ id: job._id }))}>
              {busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </PillButton>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3 rounded-lg border border-foreground/6 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-body-sm font-medium text-foreground">
                {job.policy?.policyNumber ?? "Policy"}
              </p>
              <p className="truncate text-body-sm text-muted-foreground">
                {job.clientName ?? "Client"} · {job.policy?.carrier ?? job.policy?.security ?? "Carrier"}
              </p>
            </div>
            <Badge variant={statusVariant(job.status)}>{STATUS_LABELS[job.status]}</Badge>
          </div>
          <p className="text-body-sm text-muted-foreground">{statusDescription(job)}</p>
        </section>
        <section className="border-t border-foreground/6 pt-5">
          <div className="space-y-2 text-body-sm">
          <Detail label="Decision" value={actionLabel(job.action)} />
          <Detail label="Rule" value={job.ruleName ?? "Default action"} />
          <Detail label="Channels" value={channelLabel(job.channels)} />
          <Detail label="Recipient" value={[job.recipientName, job.recipientEmail, job.recipientPhone].filter(Boolean).join(" · ") || "Missing"} />
          <Detail label="Updated" value={dayjs(job.updatedAt).format("MMM D, h:mm A")} />
          {job.lastError ? <Detail label="Error" value={job.lastError} /> : null}
          </div>
        </section>
        <section className="space-y-2 border-t border-foreground/6 pt-5">
          <p className="text-label-sm text-muted-foreground">Attempts</p>
          {(job.attempts ?? []).length === 0 ? (
            <p className="text-body-sm text-muted-foreground">No attempts yet.</p>
          ) : (
            <div className="divide-y divide-foreground/6 rounded-lg border border-foreground/6">
              {(job.attempts ?? []).map((attempt) => (
                <div key={attempt._id} className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm">
                  <span>{attempt.channel === "email" ? "Email" : "iMessage"}</span>
                  <span className="text-muted-foreground">{attempt.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        {job.policy ? <PolicyPreviewCard job={job} /> : null}
        <div className="flex flex-wrap gap-2">
          {job.threadId ? (
            <PillButton type="button" variant="secondary" onClick={() => window.location.assign(`/clients/${job.clientOrgId}/threads/${job.threadId}`)}>
              <MessageSquare className="h-3.5 w-3.5" />
              Thread
            </PillButton>
          ) : null}
        </div>
      </div>
    </SettingsDrawer>
  );
}

function PolicyPreviewCard({ job }: { job: DeliveryJob }) {
  const { openWithUrl } = usePdf();
  const fileUrl = useCachedQuery(
    "policies.getFileUrl",
    api.policies.getFileUrl,
    job.policy?.fileId ? { fileId: job.policy.fileId } : "skip",
  );
  const label = job.policy?.fileName ?? job.policy?.policyNumber ?? "Policy document";
  const detail = [
    job.policy?.policyNumber,
    job.policy?.carrier ?? job.policy?.security,
  ].filter(Boolean).join(" · ");
  const canPreview = typeof fileUrl === "string" && fileUrl.length > 0;

  return (
    <section className="space-y-2 border-t border-foreground/6 pt-5">
      <p className="text-label-sm text-muted-foreground">Policy document</p>
      <button
        type="button"
        onClick={() => {
          if (canPreview) openWithUrl(fileUrl);
        }}
        disabled={!canPreview}
        className="flex w-full items-center gap-3 rounded-lg border border-foreground/6 bg-card px-3 py-3 text-left transition-colors hover:bg-foreground/[0.02] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded-md border border-foreground/8 bg-white text-muted-foreground">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-medium text-foreground">{label}</p>
          <p className="truncate text-label-sm text-muted-foreground">
            {detail || "PDF policy"}
          </p>
        </div>
        {!canPreview ? <span className="shrink-0 text-label-sm text-muted-foreground">Unavailable</span> : null}
      </button>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  );
}

export default function DeliveriesPage() {
  const [tab, setTab] = useState<"all" | DeliveryStatus>("review_required");
  const [selectedId, setSelectedId] = useState<Id<"policyDeliveryJobs"> | null>(null);
  const rows = useQuery(api.policyDelivery.listQueue, {
    status: tab === "all" ? undefined : tab,
    limit: 100,
  }) as DeliveryJob[] | undefined;

  const selected = useMemo(
    () => rows?.find((row) => row._id === selectedId) ?? null,
    [rows, selectedId],
  );

  return (
    <AppShell rightPanel={selected ? <DeliveryDrawer job={selected} onClose={() => setSelectedId(null)} /> : null}>
      <div className="space-y-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as "all" | DeliveryStatus)}>
          <TabsList variant="pill">
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="overflow-hidden rounded-lg border border-foreground/6 bg-card">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[18%] px-4 text-label-sm text-muted-foreground">Client</TableHead>
                <TableHead className="w-[16%] text-label-sm text-muted-foreground">Policy</TableHead>
                <TableHead className="w-[16%] text-label-sm text-muted-foreground">Carrier</TableHead>
                <TableHead className="w-[13%] text-label-sm text-muted-foreground">Channel</TableHead>
                <TableHead className="w-[14%] text-label-sm text-muted-foreground">Decision</TableHead>
                <TableHead className="w-[11%] text-label-sm text-muted-foreground">Status</TableHead>
                <TableHead className="w-[12%] px-4 text-label-sm text-muted-foreground">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="h-32 px-4 text-body-sm text-muted-foreground">
                    No delivery jobs in this view.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((job) => (
                  <TableRow
                    key={job._id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(job._id)}
                  >
                    <TableCell className="max-w-44 truncate px-4 font-medium text-foreground">{job.clientName ?? "Client"}</TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">{job.policy?.policyNumber ?? job.sourceKind}</TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">{job.policy?.carrier ?? job.policy?.security ?? "Unknown"}</TableCell>
                    <TableCell className="text-muted-foreground">{channelLabel(job.channels)}</TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">{job.ruleName ?? "Default"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(job.status)}>{STATUS_LABELS[job.status]}</Badge>
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">{dayjs(job.updatedAt).format("MMM D")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
