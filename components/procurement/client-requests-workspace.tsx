"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { FileText, Loader2, MessageSquare, Plus, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Input } from "@/components/ui/input";
import {
  OperationalItem,
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag, type StatusTagTone } from "@/components/ui/status-tag";
import { Textarea } from "@/components/ui/textarea";

type ClientRequestStatus =
  | "submitted"
  | "information_needed"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "cancelled";

type Requirement = { _id?: string; title: string; requirementText?: string };
type Specification = { _id?: string; label: string; value: string };
type RequestRow = {
  _id: Id<"procurementRequests">;
  title: string;
  narrative: string;
  status: ClientRequestStatus;
  targetEffectiveDate?: string;
  updatedAt: number;
  createdAt: number;
};
type Activity = {
  _id: string;
  kind: "message" | "document" | "status";
  body?: string;
  fileName?: string;
  fileUrl?: string;
  authorSide: "operator" | "client";
  createdAt: number;
};
type RequestDetail = RequestRow & {
    requirements: Requirement[];
    specifications: Specification[];
    resultingPolicy?: { _id: Id<"policies">; carrier?: string; policyNumber?: string };
  activity: Activity[];
  files: Array<{ _id: string; name: string; url: string | null; createdAt: number }>;
};

type ClientProcurementApi = {
  list: FunctionReference<"query", "public", Record<string, never>, RequestRow[]>;
  get: FunctionReference<"query", "public", { requestId: Id<"procurementRequests"> }, RequestDetail | null>;
  create: FunctionReference<
    "mutation",
    "public",
    { title: string; narrative: string; targetEffectiveDate?: string },
    { requestId: Id<"procurementRequests"> } | Id<"procurementRequests">
  >;
  postMessage: FunctionReference<"mutation", "public", { requestId: Id<"procurementRequests">; body: string }, unknown>;
  generateUploadUrl: FunctionReference<"mutation", "public", { requestId: Id<"procurementRequests"> }, string>;
  attachFile: FunctionReference<
    "mutation",
    "public",
    {
      requestId: Id<"procurementRequests">;
      storageId: Id<"_storage">;
      fileName: string;
      contentType: string;
      size: number;
    },
    unknown
  >;
};

const clientRequests = (
  api as unknown as { clientProcurementRequests: ClientProcurementApi }
).clientProcurementRequests;

const STATUS_LABELS: Record<ClientRequestStatus, string> = {
  submitted: "Submitted",
  information_needed: "Information needed",
  in_progress: "In progress",
  finalizing: "Finalizing",
  completed: "Completed",
  cancelled: "Cancelled",
};

function statusTone(status: ClientRequestStatus): StatusTagTone {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "information_needed") return "warning";
  return status === "submitted" ? "neutral" : "info";
}

function RequestStatus({ status }: { status: ClientRequestStatus }) {
  return <StatusTag tone={statusTone(status)}>{STATUS_LABELS[status]}</StatusTag>;
}

export function ClientRequestsList() {
  const rows = useQuery(clientRequests.list, {});
  const create = useMutation(clientRequests.create);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [targetEffectiveDate, setTargetEffectiveDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await create({
        title: title.trim(),
        narrative: narrative.trim(),
        targetEffectiveDate: targetEffectiveDate || undefined,
      });
      setTitle("");
      setNarrative("");
      setTargetEffectiveDate("");
      setOpen(false);
      toast.success("Request submitted");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not submit the request"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <PillButton size="compact" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          New request
        </PillButton>
      </div>
      {rows === undefined ? (
        <OperationalPanel className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </OperationalPanel>
      ) : rows.length === 0 ? (
        <EmptyStateCard
          title="No insurance requests"
          description="Submit a request when you need new coverage or help replacing a policy."
          actionLabel="New request"
          onAction={() => setOpen(true)}
        />
      ) : (
        <OperationalPanel as="section">
          {rows.map((request) => (
            <OperationalItem key={request._id} className="p-0">
              <Link
                href={`/requests/${request._id}`}
                className="flex w-full items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-foreground/3"
              >
                <div className="min-w-0">
                  <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
                    {request.title}
                  </p>
                  <p className={`mt-1 line-clamp-2 text-muted-foreground ${typeStyle("body.default")}`}>
                    {request.narrative}
                  </p>
                  <p className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}>
                    Updated {formatDisplayDate(request.updatedAt)}
                  </p>
                </div>
                <RequestStatus status={request.status} />
              </Link>
            </OperationalItem>
          ))}
        </OperationalPanel>
      )}

      <SettingsDrawer
        open={open}
        onOpenChange={setOpen}
        title="New insurance request"
        footer={
          <PillButton type="submit" form="client-request-form" disabled={saving || !title.trim() || !narrative.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Submit request
          </PillButton>
        }
      >
        <form id="client-request-form" className="space-y-5" onSubmit={submit}>
          <div>
            <label className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}>Request name</label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Property and liability coverage" />
          </div>
          <div>
            <label className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}>What do you need?</label>
            <Textarea value={narrative} onChange={(event) => setNarrative(event.target.value)} rows={8} placeholder="Describe the coverage, contract, location, timing, and anything else we should know." />
          </div>
          <div>
            <label className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}>Target effective date</label>
            <Input type="date" value={targetEffectiveDate} onChange={(event) => setTargetEffectiveDate(event.target.value)} />
          </div>
        </form>
      </SettingsDrawer>
    </>
  );
}

export function ClientRequestDetail({ requestId }: { requestId: Id<"procurementRequests"> }) {
  const details = useQuery(clientRequests.get, { requestId });
  const postMessage = useMutation(clientRequests.postMessage);
  const generateUploadUrl = useMutation(clientRequests.generateUploadUrl);
  const attachFile = useMutation(clientRequests.attachFile);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendMessage() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await postMessage({ requestId, body: body.trim() });
      setBody("");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not post the reply"));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({ requestId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await attachFile({
        requestId,
        storageId,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });
      toast.success("File added");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not add the file"));
    } finally {
      setBusy(false);
    }
  }

  if (details === undefined) {
    return <OperationalPanel className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></OperationalPanel>;
  }
  if (!details) {
    return <EmptyStateCard title="Request not found" description="This request is unavailable or you do not have access to it." secondary={<PillButton href="/requests" variant="secondary">Back to requests</PillButton>} />;
  }

  const request = details;
  return (
    <div className="space-y-5">
      <OperationalLabelValueList>
        <OperationalLabelValueRow label="Status" value={<RequestStatus status={request.status} />} />
        <OperationalLabelValueRow label="Target effective date" value={request.targetEffectiveDate ? formatDisplayDate(request.targetEffectiveDate) : "Not set"} />
        <OperationalLabelValueRow label="Submitted" value={formatDisplayDate(request.createdAt)} />
        {request.resultingPolicy ? <OperationalLabelValueRow label="Final policy" value={<Link href={`/policies/${request.resultingPolicy._id}`} className="underline underline-offset-4">{[request.resultingPolicy.carrier, request.resultingPolicy.policyNumber].filter(Boolean).join(" · ") || "View policy"}</Link>} /> : null}
      </OperationalLabelValueList>

      <OperationalPanel>
        <OperationalPanelHeader title="Your request" />
        <OperationalPanelBody>
          <p className={`whitespace-pre-wrap text-foreground ${typeStyle("prose.default")}`}>{request.narrative}</p>
        </OperationalPanelBody>
      </OperationalPanel>

      {request.requirements.length > 0 ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Insurance requirements" />
          {request.requirements.map((requirement) => (
            <OperationalItem key={requirement._id ?? requirement.title}>
              <p className={`text-foreground ${typeStyle("body.medium")}`}>{requirement.title}</p>
              {requirement.requirementText ? <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>{requirement.requirementText}</p> : null}
            </OperationalItem>
          ))}
        </OperationalPanel>
      ) : null}

      {request.specifications.length > 0 ? (
        <OperationalLabelValueList>
          {request.specifications.map((specification) => (
            <OperationalLabelValueRow key={specification._id ?? specification.label} label={specification.label} value={specification.value} />
          ))}
        </OperationalLabelValueList>
      ) : null}

      {request.files.length > 0 ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Shared files" />
          {request.files.map((file) => (
            <OperationalItem key={file._id} className="flex items-center gap-3">
              <FileText className="size-4 text-muted-foreground" />
              {file.url ? <a href={file.url} download className={`text-foreground underline underline-offset-4 ${typeStyle("body.medium")}`}>{file.name}</a> : <span className={typeStyle("body.medium")}>{file.name}</span>}
            </OperationalItem>
          ))}
        </OperationalPanel>
      ) : null}

      <OperationalPanel>
        <OperationalPanelHeader title="Activity" />
        {details.activity.length === 0 ? (
          <OperationalPanelBody className={`text-muted-foreground ${typeStyle("body.default")}`}>No activity yet.</OperationalPanelBody>
        ) : request.activity.map((item) => (
          <OperationalItem key={item._id} className="flex items-start gap-3">
            {item.kind === "document" ? <FileText className="mt-0.5 size-4 text-muted-foreground" /> : <MessageSquare className="mt-0.5 size-4 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              {item.fileUrl ? <a href={item.fileUrl} download className={`text-foreground underline underline-offset-4 ${typeStyle("body.medium")}`}>{item.fileName ?? "Download file"}</a> : <p className={`whitespace-pre-wrap text-foreground ${typeStyle("body.default")}`}>{item.body}</p>}
              <p className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}>{item.authorSide === "client" ? "You" : "Spot"} · {formatDisplayDateTime(item.createdAt)}</p>
            </div>
          </OperationalItem>
        ))}
        <OperationalPanelBody className="space-y-3 border-t border-border">
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} placeholder="Reply to the team" />
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <PillButton variant="secondary" disabled={busy} onClick={() => document.getElementById("request-supporting-file")?.click()}>
              <Upload className="size-3.5" />
              Add file
            </PillButton>
            <input id="request-supporting-file" className="hidden" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
            <PillButton disabled={busy || !body.trim()} onClick={() => void sendMessage()}>
              <Send className="size-3.5" />
              Post reply
            </PillButton>
          </div>
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
