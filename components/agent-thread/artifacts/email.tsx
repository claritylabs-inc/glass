"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { useAction, useMutation } from "convex/react";
import dayjs from "dayjs";
import { Loader2, Mail as MailIcon, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { ThreadAttachmentChip } from "../thread-attachment-chip";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
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
    return value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }
  return [];
}

function parseEmailPayloadPreview(
  payload: string | undefined,
): EmailPayloadPreview | null {
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

function formatEmailAddressList(
  addresses: string[] | undefined,
): string | null {
  return addresses?.filter(Boolean).join(", ") || null;
}

function isSafeEmailPreviewUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return (
      ["http:", "https:", "mailto:"].includes(url.protocol) ||
      value.startsWith("data:image/")
    );
  } catch {
    return false;
  }
}

function sanitizeEmailPreviewHtml(html: string | undefined): string | null {
  if (!html || typeof window === "undefined") return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll("script, style, iframe, object, embed, link, meta")
    .forEach((node) => node.remove());
  document.body.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on") || name === "srcset") {
        element.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src") &&
        !isSafeEmailPreviewUrl(value)
      ) {
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
        className="break-words text-base leading-6 text-foreground/90 [overflow-wrap:anywhere] [&_a]:text-primary-light [&_a]:underline [&_img]:inline-block [&_img]:align-middle"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return (
    <div className="whitespace-pre-wrap break-words text-base leading-6 text-foreground/90 [overflow-wrap:anywhere]">
      {text}
    </div>
  );
}

function EmailHeaderRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;

  return (
    <>
      <dt className="pt-0.5 text-base font-medium leading-5 text-muted-foreground/55">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-base leading-6 text-foreground/80">
        {value}
      </dd>
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
  const [isExpanded, setIsExpanded] = useState(false);

  if (!attachments?.length) return null;

  const hasHiddenAttachments = attachments.length > 2;
  const hiddenAttachmentCount = Math.max(attachments.length - 2, 0);
  const visibleAttachments =
    hasHiddenAttachments && !isExpanded ? attachments.slice(0, 2) : attachments;

  return (
    <>
      <dt className="col-span-1 mt-2 text-label font-medium leading-4 text-muted-foreground/55">
        Attachments
      </dt>
      <dd className="col-span-1 min-w-0 mt-1">
        <div className="flex flex-wrap gap-2">
          {visibleAttachments.map((att, index) => (
            <ThreadAttachmentChip
              key={index}
              attachment={att}
              threadId={threadId}
            />
          ))}
          {hasHiddenAttachments ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((value) => !value)}
              className="inline-flex h-6 shrink-0 items-center rounded-full bg-foreground/5 px-2 text-label font-medium text-foreground/40 transition-colors hover:bg-foreground/8 hover:text-foreground/80"
            >
              {isExpanded ? "Hide" : `+ ${hiddenAttachmentCount} more`}
            </button>
          ) : null}
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
  const pendingEmail = useCachedQuery(
    "pendingEmails.get.summary",
    api.pendingEmails.get,
    message.pendingEmailId ? { id: message.pendingEmailId } : "skip",
  );
  const updatePendingEmail = useUpdateCachedQuery<
    typeof pendingEmail,
    { id: Id<"pendingEmails"> }
  >("pendingEmails.get.summary");
  const [isSending, setIsSending] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const recipients = message.toAddresses?.length
    ? message.toAddresses.join(", ")
    : (message.fromEmail ?? "Email");
  const preview =
    message.subject ||
    message.content.split(/\n+/).find((line) => line.trim()) ||
    "Email";
  const label =
    message.status === "draft_email"
      ? "Email draft"
      : message.status === "cancelled"
        ? "Email cancelled"
        : message.role === "agent"
          ? "Email sent"
          : "Email received";
  const canQuickSend =
    message.status === "draft_email" && pendingEmail?.status === "draft";
  const canRestore =
    message.pendingEmailId &&
    (message.status === "cancelled" || pendingEmail?.status === "cancelled");
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
      await updatePendingEmail({ id: message.pendingEmailId }, (current) =>
        current ? { ...current, status: "sent" } : current,
      );
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
      await updatePendingEmail({ id: message.pendingEmailId }, (current) =>
        current ? { ...current, status: "draft" } : current,
      );
      toast.success("Email restored as draft");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to restore email",
      );
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div
      className={`${compact ? "mt-2" : ""} w-fit min-w-64 max-w-sm overflow-hidden rounded-md border border-foreground/8 bg-card transition-colors hover:border-foreground/15 hover:bg-foreground/[0.025]`}
    >
      <button
        type="button"
        onClick={() => onOpen?.(message)}
        className="block w-full min-w-0 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-medium leading-4 text-muted-foreground/45">
            {label}
          </span>
          <span className="block truncate text-base font-medium leading-5 text-foreground/85">
            {preview}
          </span>
          <span className="block truncate text-label leading-4 text-muted-foreground/40">
            {recipients}
          </span>
        </span>
      </button>
      {isOpen ? null : (
        <div className="flex items-center justify-end gap-1 border-t border-foreground/6 px-2 py-2">
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.(message);
            }}
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
              {isSending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <MailIcon className="h-3 w-3" />
              )}
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
              {isRestoring ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Restore
            </PillButton>
          ) : null}
        </div>
      )}
    </div>
  );
}

function getEmailSummaryRecipients(message: ThreadMessage) {
  return message.toAddresses?.length
    ? message.toAddresses.join(", ")
    : (message.fromEmail ?? "Email");
}

function getEmailSummaryPreview(message: ThreadMessage) {
  return (
    message.subject ||
    message.content.split(/\n+/).find((line) => line.trim()) ||
    "Email"
  );
}

function getEmailStatusLabel(message: ThreadMessage) {
  if (message.status === "draft_email") return "Draft";
  if (message.status === "cancelled") return "Cancelled";
  if (message.role === "agent") return "Sent";
  return "Email";
}

export function EmailStackCard({
  messages,
  onOpen,
  isOpenMessageId,
}: {
  messages: ThreadMessage[];
  onOpen?: (message: ThreadMessage) => void;
  isOpenMessageId?: Id<"threadMessages"> | null;
}) {
  const sendDrafts = useAction(api.actions.sendPendingEmail.sendDraftsNow);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a._creationTime - b._creationTime),
    [messages],
  );
  const draftPendingEmailIds = useMemo(
    () => [
      ...new Set(
        orderedMessages
          .filter(
            (message) =>
              message.status === "draft_email" && message.pendingEmailId,
          )
          .map((message) => message.pendingEmailId as Id<"pendingEmails">),
      ),
    ],
    [orderedMessages],
  );
  const draftCount = draftPendingEmailIds.length;

  async function handleSendAll(event: MouseEvent) {
    event.stopPropagation();
    if (draftPendingEmailIds.length === 0) return;
    setIsSendingAll(true);
    try {
      const result = await sendDrafts({ ids: draftPendingEmailIds });
      if (result.failed.length > 0) {
        toast.error(
          `Sent ${result.sent.length} email${result.sent.length === 1 ? "" : "s"}; ${result.failed.length} failed.`,
        );
      } else {
        toast.success(
          `Sent ${result.sent.length} email${result.sent.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send emails");
    } finally {
      setIsSendingAll(false);
    }
  }

  if (orderedMessages.length === 1) {
    const [message] = orderedMessages;
    return (
      <EmailSummaryCard
        message={message}
        onOpen={onOpen}
        compact
        isOpen={isOpenMessageId === message._id}
      />
    );
  }

  return (
    <div className="w-full max-w-md overflow-hidden rounded-md border border-foreground/8 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2">
        <div className="min-w-0">
          <p className="text-label font-medium leading-4 text-muted-foreground/45">
            Email drafts
          </p>
          <p className="truncate text-base font-medium leading-5 text-foreground/85">
            {orderedMessages.length} email
            {orderedMessages.length === 1 ? "" : "s"}
          </p>
        </div>
        {draftCount > 1 ? (
          <PillButton
            type="button"
            size="compact"
            variant="primary"
            onClick={handleSendAll}
            disabled={isSendingAll}
          >
            {isSendingAll ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <MailIcon className="h-3 w-3" />
            )}
            Send all
          </PillButton>
        ) : null}
      </div>
      <div className="divide-y divide-foreground/6">
        {orderedMessages.map((message) => {
          const attachmentCount = message.attachments?.length ?? 0;
          const isOpen = isOpenMessageId === message._id;
          return (
            <button
              key={message._id}
              type="button"
              onClick={() => onOpen?.(message)}
              className={`block w-full min-w-0 px-3 py-2.5 text-left transition-colors ${
                isOpen ? "bg-foreground/[0.035]" : "hover:bg-foreground/[0.025]"
              }`}
            >
              <span className="flex min-w-0 items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium leading-5 text-foreground/85">
                    {getEmailSummaryPreview(message)}
                  </span>
                  <span className="block truncate text-label leading-4 text-muted-foreground/45">
                    {getEmailSummaryRecipients(message)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {attachmentCount > 0 ? (
                    <span className="text-label leading-4 text-muted-foreground/35">
                      {attachmentCount} file{attachmentCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <Badge
                    variant="outline"
                    className="h-5 border-foreground/10 px-1.5 text-label font-medium text-muted-foreground/55"
                  >
                    {getEmailStatusLabel(message)}
                  </Badge>
                </span>
              </span>
            </button>
          );
        })}
      </div>
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
  const pendingEmail = useCachedQuery(
    "pendingEmails.get.detail",
    api.pendingEmails.get,
    message?.pendingEmailId ? { id: message.pendingEmailId } : "skip",
  );
  const updatePendingEmail = useUpdateCachedQuery<
    typeof pendingEmail,
    { id: Id<"pendingEmails"> }
  >("pendingEmails.get.detail");
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  if (!message) return null;
  const isDraft =
    message.status === "draft_email" && pendingEmail?.status === "draft";
  const isSent = pendingEmail?.status === "sent" || !!message.responseMessageId;
  const isCancelled =
    pendingEmail?.status === "cancelled" || message.status === "cancelled";
  const payloadPreview = parseEmailPayloadPreview(pendingEmail?.emailPayload);
  const fromLine =
    payloadPreview?.from ??
    (message.fromEmail
      ? message.fromName
        ? `${message.fromName} <${message.fromEmail}>`
        : message.fromEmail
      : null);
  const toLine =
    formatEmailAddressList(payloadPreview?.to) ??
    formatEmailAddressList(message.toAddresses);
  const ccLine =
    formatEmailAddressList(payloadPreview?.cc) ??
    formatEmailAddressList(message.ccAddresses);
  const bccLine =
    formatEmailAddressList(payloadPreview?.bcc) ??
    formatEmailAddressList(message.bccAddresses);
  const previewBody = payloadPreview?.text ?? message.content;
  const previewHtml = payloadPreview?.html;
  const sentAt = dayjs(message._creationTime).format("MMM D, YYYY [at] h:mm A");

  async function handleSend() {
    if (!message?.pendingEmailId) return;
    setIsSending(true);
    try {
      const result = await sendDraft({ id: message.pendingEmailId });
      await updatePendingEmail({ id: message.pendingEmailId }, (current) =>
        current ? { ...current, status: "sent" } : current,
      );
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
      await updatePendingEmail({ id: message.pendingEmailId }, (current) =>
        current ? { ...current, status: "cancelled" } : current,
      );
      toast.success("Email draft cancelled");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel email",
      );
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleRestore() {
    if (!message?.pendingEmailId) return;
    setIsRestoring(true);
    try {
      await restoreDraft({ id: message.pendingEmailId });
      await updatePendingEmail({ id: message.pendingEmailId }, (current) =>
        current ? { ...current, status: "draft" } : current,
      );
      toast.success("Email restored as draft");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to restore email",
      );
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">
            {message.subject ||
              (message.role === "agent" ? "Sent email" : "Received email")}
          </h2>
          <Badge
            variant="outline"
            className="h-5 shrink-0 border-foreground/10 px-1.5 text-label font-medium text-muted-foreground/55"
          >
            {isDraft
              ? "Draft"
              : isCancelled
                ? "Cancelled"
                : isSent
                  ? "Sent"
                  : "Email"}
          </Badge>
        </div>
        <PillButton
          size="compact"
          variant="icon"
          onClick={onClose}
          label="Close email"
        >
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <dl
        className="grid items-start gap-x-4 border-b border-foreground/8 px-5 py-5"
        style={{
          gridTemplateColumns: "6rem minmax(0, 1fr)",
          rowGap: "0.25rem",
        }}
      >
        <EmailHeaderRow label="From" value={fromLine} />
        <EmailHeaderRow label="To" value={toLine} />
        <EmailHeaderRow label="Cc" value={ccLine} />
        <EmailHeaderRow label="Bcc" value={bccLine} />
        <EmailHeaderRow label="Time" value={sentAt} />
        <EmailHeaderAttachments
          attachments={message.attachments}
          threadId={message.threadId}
        />
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
            {isCancelling ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Cancel
          </PillButton>
          <PillButton
            type="button"
            size="compact"
            variant="primary"
            onClick={handleSend}
            disabled={isSending || isCancelling}
          >
            {isSending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MailIcon className="mr-1.5 h-3.5 w-3.5" />
            )}
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
            {isRestoring ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Restore draft
          </PillButton>
        </div>
      ) : null}
    </aside>
  );
}
