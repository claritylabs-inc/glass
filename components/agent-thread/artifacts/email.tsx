"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Loader2, Mail as MailIcon, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { ThreadAttachmentChip } from "../thread-attachment-chip";
import type { ThreadMessage } from "../types";

type EmailPayloadPreview = {
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  text?: string;
  html?: string;
};

function normalizeEmailPayloadAddresses(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }
  return [];
}

function parseEmailPayloadPreview(payload: string | undefined): EmailPayloadPreview | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      from: typeof parsed.from === "string" ? parsed.from : undefined,
      to: normalizeEmailPayloadAddresses(parsed.to),
      cc: normalizeEmailPayloadAddresses(parsed.cc),
      bcc: normalizeEmailPayloadAddresses(parsed.bcc),
      text: typeof parsed.text === "string" ? parsed.text : undefined,
      html: typeof parsed.html === "string" ? parsed.html : undefined,
    };
  } catch {
    return null;
  }
}

function formatEmailAddressList(addresses: string[] | undefined): string | null {
  return addresses?.filter(Boolean).join(", ") || null;
}

function isSafeEmailPreviewUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      || value.startsWith("data:image/");
  } catch {
    return false;
  }
}

function sanitizeEmailPreviewHtml(html: string | undefined): string | null {
  if (!html || typeof window === "undefined") return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());
  document.body.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on") || name === "srcset") {
        element.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && !isSafeEmailPreviewUrl(value)) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name === "style" && /\bexpression\s*\(|url\s*\(/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    }
    if (element instanceof HTMLAnchorElement) {
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
  });
  return document.body.innerHTML;
}

function EmailBodyPreview({ html, text }: { html?: string; text: string }) {
  const safeHtml = useMemo(() => sanitizeEmailPreviewHtml(html), [html]);

  if (safeHtml) {
    return (
      <div
        className="break-words text-body-sm leading-6 text-foreground/90 [overflow-wrap:anywhere] [&_a]:text-primary-light [&_a]:underline [&_img]:inline-block [&_img]:align-middle"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return (
    <div className="whitespace-pre-wrap break-words text-body-sm leading-6 text-foreground/90 [overflow-wrap:anywhere]">
      {text}
    </div>
  );
}

function EmailHeaderRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <>
      <dt className="pt-0.5 text-[13px] font-medium leading-5 text-muted-foreground/55">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] leading-6 text-foreground/80">{value}</dd>
    </>
  );
}

function EmailHeaderAttachments({
  attachments,
  threadId,
}: {
  attachments: ThreadMessage["attachments"];
  threadId: Id<"threads">;
}) {
  if (!attachments?.length) return null;

  return (
    <>
      <dt className="pt-1.5 text-[13px] font-medium leading-5 text-muted-foreground/55">Attachments</dt>
      <dd className="min-w-0">
        <div className="flex flex-wrap gap-2">
          {attachments.map((att, index) => (
            <ThreadAttachmentChip key={index} attachment={att} threadId={threadId} />
          ))}
        </div>
      </dd>
    </>
  );
}

export function EmailSummaryCard({
  message,
  onOpen,
  compact = false,
  isOpen = false,
}: {
  message: ThreadMessage;
  onOpen?: (message: ThreadMessage) => void;
  compact?: boolean;
  isOpen?: boolean;
}) {
  const sendDraft = useAction(api.actions.sendPendingEmail.sendDraftNow);
  const restoreDraft = useMutation(api.pendingEmails.restoreAsDraft);
  const pendingEmail = useQuery(
    api.pendingEmails.get,
    message.pendingEmailId ? { id: message.pendingEmailId } : "skip",
  );
  const [isSending, setIsSending] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const recipients = message.toAddresses?.length
    ? message.toAddresses.join(", ")
    : message.fromEmail ?? "Email";
  const preview = message.subject || message.content.split(/\n+/).find((line) => line.trim()) || "Email";
  const label = message.status === "draft_email"
    ? "Email draft"
      : message.status === "cancelled"
        ? "Email cancelled"
        : message.role === "agent" ? "Email sent" : "Email received";
  const canQuickSend = message.status === "draft_email" && pendingEmail?.status === "draft";
  const canRestore = message.pendingEmailId && (
    message.status === "cancelled" || pendingEmail?.status === "cancelled"
  );
  const reviewLabel = canQuickSend
    ? "Review draft"
    : message.status === "cancelled" || pendingEmail?.status === "cancelled"
      ? "View cancelled email"
      : "View sent email";

  async function handleQuickSend(event: MouseEvent) {
    event.stopPropagation();
    if (!message.pendingEmailId) return;
    setIsSending(true);
    try {
      const result = await sendDraft({ id: message.pendingEmailId });
      toast.success(`Email sent to ${result.recipientEmail}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setIsSending(false);
    }
  }

  async function handleRestore(event: MouseEvent) {
    event.stopPropagation();
    if (!message.pendingEmailId) return;
    setIsRestoring(true);
    try {
      await restoreDraft({ id: message.pendingEmailId });
      toast.success("Email restored as draft");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore email");
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div className={`${compact ? "mt-2" : ""} w-fit min-w-64 max-w-sm overflow-hidden rounded-md border border-foreground/8 bg-card transition-colors hover:border-foreground/15 hover:bg-foreground/[0.025]`}>
      <button
        type="button"
        onClick={() => onOpen?.(message)}
        className="block w-full min-w-0 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium leading-4 text-muted-foreground/45">
            {label}
          </span>
          <span className="block truncate text-[13px] font-medium leading-5 text-foreground/85">{preview}</span>
          <span className="block truncate text-[11px] leading-4 text-muted-foreground/40">{recipients}</span>
        </span>
      </button>
      {isOpen ? null : (
        <div className="flex items-center justify-end gap-1 border-t border-foreground/6 px-2 py-2">
          <PillButton
            type="button"
            size="compact"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.(message);
            }}
            className="text-muted-foreground/60"
          >
            {reviewLabel}
          </PillButton>
          {canQuickSend ? (
            <PillButton
              type="button"
              size="compact"
              variant="primary"
              onClick={handleQuickSend}
              disabled={isSending}
            >
              {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MailIcon className="h-3 w-3" />}
              Send
            </PillButton>
          ) : null}
          {canRestore ? (
            <PillButton
              type="button"
              size="compact"
              variant="primary"
              onClick={handleRestore}
              disabled={isRestoring}
            >
              {isRestoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Restore
            </PillButton>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function EmailThreadSidebar({
  message,
  onClose,
}: {
  message: ThreadMessage | null;
  onClose: () => void;
}) {
  const sendDraft = useAction(api.actions.sendPendingEmail.sendDraftNow);
  const cancelDraft = useMutation(api.pendingEmails.cancel);
  const restoreDraft = useMutation(api.pendingEmails.restoreAsDraft);
  const pendingEmail = useQuery(
    api.pendingEmails.get,
    message?.pendingEmailId ? { id: message.pendingEmailId } : "skip",
  );
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  if (!message) return null;
  const isDraft = message.status === "draft_email" && pendingEmail?.status === "draft";
  const isSent = pendingEmail?.status === "sent" || !!message.responseMessageId;
  const isCancelled = pendingEmail?.status === "cancelled" || message.status === "cancelled";
  const payloadPreview = parseEmailPayloadPreview(pendingEmail?.emailPayload);
  const fromLine = payloadPreview?.from
    ?? (message.fromEmail ? (message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail) : null);
  const toLine = formatEmailAddressList(payloadPreview?.to) ?? formatEmailAddressList(message.toAddresses);
  const ccLine = formatEmailAddressList(payloadPreview?.cc) ?? formatEmailAddressList(message.ccAddresses);
  const bccLine = formatEmailAddressList(payloadPreview?.bcc) ?? formatEmailAddressList(message.bccAddresses);
  const previewBody = payloadPreview?.text ?? message.content;
  const previewHtml = payloadPreview?.html;
  const sentAt = dayjs(message._creationTime).format("MMM D, YYYY [at] h:mm A");

  async function handleSend() {
    if (!message?.pendingEmailId) return;
    setIsSending(true);
    try {
      const result = await sendDraft({ id: message.pendingEmailId });
      toast.success(`Email sent to ${result.recipientEmail}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setIsSending(false);
    }
  }

  async function handleCancel() {
    if (!message?.pendingEmailId) return;
    setIsCancelling(true);
    try {
      await cancelDraft({ id: message.pendingEmailId });
      toast.success("Email draft cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel email");
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleRestore() {
    if (!message?.pendingEmailId) return;
    setIsRestoring(true);
    try {
      await restoreDraft({ id: message.pendingEmailId });
      toast.success("Email restored as draft");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore email");
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-body-sm font-semibold text-foreground">
            {message.subject || (message.role === "agent" ? "Sent email" : "Received email")}
          </h2>
          <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground/55">
            {isDraft ? "Draft" : isCancelled ? "Cancelled" : isSent ? "Sent" : "Email"}
          </Badge>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close email">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <dl
        className="grid items-start gap-x-4 border-b border-foreground/8 px-5 py-5"
        style={{ gridTemplateColumns: "6rem minmax(0, 1fr)", rowGap: "0.25rem" }}
      >
        <EmailHeaderRow label="From" value={fromLine} />
        <EmailHeaderRow label="To" value={toLine} />
        <EmailHeaderRow label="Cc" value={ccLine} />
        <EmailHeaderRow label="Bcc" value={bccLine} />
        <EmailHeaderRow label="Time" value={sentAt} />
        <EmailHeaderAttachments attachments={message.attachments} threadId={message.threadId} />
      </dl>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <EmailBodyPreview html={previewHtml} text={previewBody} />
      </div>
      {isDraft ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="ghost"
            size="compact"
            onClick={handleCancel}
            disabled={isSending || isCancelling}
          >
            {isCancelling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Cancel
          </PillButton>
          <PillButton
            type="button"
            size="compact"
            variant="primary"
            onClick={handleSend}
            disabled={isSending || isCancelling}
          >
            {isSending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MailIcon className="mr-1.5 h-3.5 w-3.5" />}
            Send Email
          </PillButton>
        </div>
      ) : isCancelled ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            size="compact"
            variant="primary"
            onClick={handleRestore}
            disabled={isRestoring}
          >
            {isRestoring ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
            Restore draft
          </PillButton>
        </div>
      ) : null}
    </aside>
  );
}
