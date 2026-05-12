"use client";

import { use, useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { splitQuotedReply, QuotedContent } from "@/components/conversation-message";
import { toast } from "sonner";
import { Loader2, Archive, ArchiveRestore, FileText, Check, ClipboardList, Asterisk, Mail as MailIcon, MessageCircle, Paperclip, Download, Copy, RotateCcw, X } from "lucide-react";
import { EditableBreadcrumbTitle } from "@/components/editable-breadcrumb-title";
import { usePdf } from "@/components/pdf-context";
import { usePresence } from "@/hooks/use-presence";
import { ContextReferenceCard, PolicyReferenceCard, ReferenceCardStrip } from "@/components/context-reference-card";
import { ChatInputOverlay, GlassPromptInput, type GlassPromptInputHandle } from "@/components/glass-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { CollapsibleReasoning } from "@/components/collapsible-reasoning";
import Link from "next/link";
import { ProseMarkdown } from "@/components/prose-markdown";
import dayjs from "dayjs";
import { NewChatEmptyState } from "@/components/new-chat-empty-state";
import {
  PolicyChangeProgress,
  formatPolicyChangeStatus,
  isPolicyChangeTerminal,
} from "@/components/policy-change-progress";

/* ═══════════════════════════════════════════════════
   Unified Thread View (new threads table)
   ═══════════════════════════════════════════════════ */

export type ThreadMessage = {
  _id: Id<"threadMessages">;
  _creationTime: number;
  threadId: Id<"threads">;
  orgId: Id<"organizations">;
  channel: "chat" | "email" | "imessage";
  role: "user" | "agent" | "system";
  userId?: Id<"users">;
  userName?: string;
  imessageSenderAddress?: string;
  imessageParticipantLabel?: string;
  fromEmail?: string;
  fromName?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject?: string;
  content: string;
  contentHtml?: string;
  reasoning?: string;
  messageId?: string;
  responseMessageId?: string;
  attachments?: { filename: string; contentType: string; size: number; fileId?: Id<"_storage"> }[];
  replyToMessageId?: Id<"threadMessages">;
  referencedPolicyIds?: Id<"policies">[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  usedTools?: string[];
  toolCalls?: { name: string; input?: string }[];
  status?: "processing" | "error" | "pending_send" | "draft_email" | "cancelled";
  error?: string;
  pendingEmailId?: Id<"pendingEmails">;
  policyChangeCaseId?: Id<"policyChangeCases">;
};

export type PolicyChangeAccess = {
  canManage: boolean;
  actorLabel: "broker" | "client";
  brokerConnected: boolean;
};

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  lookup_policy: "Searched policies",
  lookup_policy_section: "Read policy sections",
  compare_coverages: "Compared coverages",
  check_application_status: "Checked application",
  save_note: "Saved note",
  generate_coi: "Generated COI",
  send_email: "Drafted email",
  email_expert: "Prepared email",
  create_policy_change_request: "Created policy change request",
};

function formatToolInput(input?: string) {
  if (!input) return "{}";
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

function ToolCallCard({
  toolCall,
  index,
}: {
  toolCall: { name: string; input?: string };
  index: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = TOOL_DISPLAY_NAMES[toolCall.name] ?? toolCall.name;

  return (
    <div className="overflow-hidden rounded-md border border-foreground/6 bg-foreground/[0.015]">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className="h-7 w-full justify-between rounded-none px-2.5 py-1 text-left hover:bg-foreground/[0.03] dark:hover:bg-foreground/[0.06]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-medium text-muted-foreground/65">{displayName}</span>
          </span>
        </span>
        <span className="ml-3 flex shrink-0 items-center gap-2">
          <Badge className="h-4 gap-1 border-success/20 bg-success/10 px-1.5 text-[10px] font-medium text-success/75" variant="outline">
            Completed
          </Badge>
          <span className="text-[10px] font-medium text-muted-foreground/35">
            {isOpen ? "Hide" : "Show"}
          </span>
        </span>
      </Button>
      {isOpen && (
        <div className="border-t border-foreground/6 px-2.5 pb-2.5 pt-2">
          <p className="mb-1 text-[10px] font-medium text-muted-foreground/40">
            Parameters
          </p>
          <pre className="max-h-48 overflow-auto rounded border border-foreground/6 bg-background p-2 font-mono text-[10px] leading-4 text-foreground/70">
            <code className="whitespace-pre-wrap break-words">{formatToolInput(toolCall.input)}</code>
          </pre>
          <span className="sr-only">Tool call {index + 1}</span>
        </div>
      )}
    </div>
  );
}

function ToolCallPanel({
  toolCalls,
}: {
  toolCalls: { name: string; input?: string }[];
}) {
  return (
    <div className="mt-1.5 space-y-1.5">
      {toolCalls.map((toolCall, index) => (
        <ToolCallCard key={`${toolCall.name}-${index}`} toolCall={toolCall} index={index} />
      ))}
    </div>
  );
}

function MessageFooterActions({
  refs,
  citedSections,
  citedCoverageNames,
  toolCalls,
  copyContent,
  showToolCalls,
  onToggleToolCalls,
  rightAligned,
}: {
  refs: { type: "policy"; id: string; page?: number }[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  toolCalls: { name: string; input?: string }[];
  copyContent?: string;
  showToolCalls: boolean;
  onToggleToolCalls: () => void;
  rightAligned?: boolean;
}) {
  if (refs.length === 0 && toolCalls.length === 0 && !copyContent?.trim()) return null;

  return (
    <div className="mt-1.5 flex items-start gap-2">
      <div className={`flex min-w-0 flex-1 flex-wrap items-start gap-1.5 ${rightAligned ? "justify-end" : ""}`}>
        {refs.length > 0 && (
          <ReferenceCardStrip
            refs={refs}
            citedSections={citedSections}
            citedCoverageNames={citedCoverageNames}
            rightAligned={rightAligned}
          />
        )}
        {toolCalls.length > 0 && (
          <button
            type="button"
            onClick={onToggleToolCalls}
            aria-expanded={showToolCalls}
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-foreground/8 bg-transparent px-2 text-[11px] font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/[0.03] hover:text-foreground/75"
          >
            <ClipboardList className="h-3 w-3" />
            {toolCalls.length} tool{toolCalls.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {copyContent?.trim() ? <CopyMessageButton content={copyContent} /> : null}
    </div>
  );
}

/* ── Unified thread actions ── */
function UnifiedThreadActions({
  threadId,
  thread,
  messages,
}: {
  threadId: Id<"threads">;
  thread: { title: string; archivedAt?: number; originChannel?: "chat" | "email" | "imessage"; threadEmail?: string };
  messages?: ThreadMessage[];
}) {
  const archiveThread = useMutation(api.threads.archive);
  const unarchiveThread = useMutation(api.threads.unarchive);
  const isArchived = !!thread.archivedAt;
  async function handleArchiveToggle() {
    try {
      if (isArchived) {
        await unarchiveThread({ id: threadId });
        toast.success("Unarchived");
      } else {
        await archiveThread({ id: threadId });
        toast.success("Archived");
      }
    } catch {
      toast.error("Failed to update");
    }
  }

  function handleCopyThread() {
    if (!messages || messages.length === 0) {
      toast.error("No messages to copy");
      return;
    }
    const lines: string[] = [];
    lines.push(`Thread: ${thread.title}`);
    if (thread.threadEmail) lines.push(`Thread email: ${thread.threadEmail}`);
    lines.push(`Messages: ${messages.length}`);
    lines.push("─".repeat(50));
    for (const msg of messages) {
      if (msg.status === "processing") continue;
      const time = dayjs(msg._creationTime).format("MMM D, YYYY h:mm A");
      const sender = msg.role === "agent"
        ? "Glass"
        : msg.userName ?? msg.fromName ?? msg.fromEmail ?? "User";
      const channel = msg.channel === "email" ? " [Email]" : msg.channel === "imessage" ? " [iMessage]" : " [Chat]";
      lines.push("");
      lines.push(`${sender}${channel} — ${time}`);
      if (msg.fromEmail) lines.push(`From: ${msg.fromEmail}`);
      if (msg.toAddresses?.length) lines.push(`To: ${msg.toAddresses.join(", ")}`);
      if (msg.ccAddresses?.length) lines.push(`CC: ${msg.ccAddresses.join(", ")}`);
      lines.push("");
      lines.push(msg.content);
      if (msg.attachments?.length) {
        lines.push(`Attachments: ${msg.attachments.map((a) => a.filename).join(", ")}`);
      }
      lines.push("─".repeat(50));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Thread copied to clipboard");
  }

  return (
    <>
      <PillButton size="compact" variant="icon" onClick={handleCopyThread} label="Copy thread">
        <Copy className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton size="compact" variant="icon" onClick={handleArchiveToggle} label={isArchived ? "Unarchive" : "Archive"}>
        {isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
      </PillButton>
    </>
  );
}

/* ── Shared markdown container styles ── */
const MARKDOWN_STYLES = "[&_a]:text-primary-light [&_a]:underline";

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href?.startsWith("/policies/")) {
      return <ContextReferenceCard href={href}>{children}</ContextReferenceCard>;
    }
    return <a href={href} className="text-primary-light underline" target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

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

/* ── Attachment chip for unified thread messages ── */
function ThreadAttachmentChip({
  attachment,
  threadId,
}: {
  attachment: { filename: string; contentType: string; size: number; fileId?: Id<"_storage"> };
  threadId: Id<"threads">;
}) {
  const { openWithUrl } = usePdf();
  const url = useQuery(
    api.threads.getAttachmentUrl,
    attachment.fileId ? { threadId, fileId: attachment.fileId } : "skip",
  );
  const isPdf = attachment.contentType === "application/pdf";

  const handleClick = (e: React.MouseEvent) => {
    if (isPdf && url) {
      e.preventDefault();
      openWithUrl(url);
    }
  };

  return (
    <a
      href={isPdf ? undefined : (url ?? undefined)}
      target={isPdf ? undefined : "_blank"}
      rel={isPdf ? undefined : "noopener noreferrer"}
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-label-sm transition-colors ${
        url
          ? "border-foreground/10 bg-card hover:bg-foreground/[0.03] hover:border-foreground/15 cursor-pointer"
          : "border-foreground/6 bg-foreground/[0.02] text-muted-foreground/40 pointer-events-none"
      }`}
    >
      {isPdf ? (
        <FileText className="w-3.5 h-3.5 text-red-400 shrink-0" />
      ) : (
        <Paperclip className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
      )}
      <span className="truncate max-w-[180px] text-foreground/80">{attachment.filename}</span>
      {url && !isPdf && <Download className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
    </a>
  );
}

function EmailSummaryCard({
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
  const pendingEmail = useQuery(
    api.pendingEmails.get,
    message.pendingEmailId ? { id: message.pendingEmailId } : "skip",
  );
  const [isSending, setIsSending] = useState(false);
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
  const reviewLabel = canQuickSend
    ? "Review draft"
    : message.status === "cancelled" || pendingEmail?.status === "cancelled"
      ? "View cancelled email"
      : "View sent email";

  async function handleQuickSend(event: React.MouseEvent) {
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

  return (
    <div className={`${compact ? "mt-2" : ""} w-fit min-w-md max-w-xl overflow-hidden rounded-md border border-foreground/8 bg-card transition-colors hover:border-foreground/15 hover:bg-foreground/[0.025]`}>
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
        </div>
      )}
    </div>
  );
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function PolicyChangeSummaryCard({
  caseId,
  onOpen,
  isOpen = false,
}: {
  caseId: Id<"policyChangeCases">;
  onOpen?: (caseId: Id<"policyChangeCases">) => void;
  isOpen?: boolean;
}) {
  const detail = useQuery(api.policyChanges.getCaseDetail, { caseId });
  const changeCase = detail?.case;
  const title = changeCase?.summary ?? "Policy change request";
  const status = formatPolicyChangeStatus(changeCase?.status);
  const missingInfo = asRecordArray(changeCase?.missingInfoQuestions).length;
  const validationIssues = asRecordArray(changeCase?.validationIssues).length;

  return (
    <div className={`w-fit min-w-md max-w-xl overflow-hidden rounded-md border bg-card transition-colors ${
      isOpen ? "border-foreground/18" : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.025]"
    }`}>
      <button
        type="button"
        onClick={() => onOpen?.(caseId)}
        className="block w-full min-w-0 px-3 py-2.5 text-left"
      >
        <span className="block truncate text-[11px] font-medium leading-4 text-muted-foreground/45">
          Policy change request
        </span>
        <span className="block truncate text-[13px] font-medium leading-5 text-foreground/85">
          {title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-4 text-muted-foreground/40">
          <span className="capitalize">{status}</span>
          {missingInfo > 0 ? <span>{missingInfo} question{missingInfo === 1 ? "" : "s"}</span> : null}
          {validationIssues > 0 ? <span>{validationIssues} validation issue{validationIssues === 1 ? "" : "s"}</span> : null}
        </span>
      </button>
      {!isOpen ? (
        <div className="flex items-center justify-end border-t border-foreground/6 px-2 py-2">
          <PillButton
            type="button"
            size="compact"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.(caseId);
            }}
            className="text-muted-foreground/60"
          >
            Review request
          </PillButton>
        </div>
      ) : null}
    </div>
  );
}

export function PolicyChangeThreadSidebar({
  caseId,
  access,
  onClose,
}: {
  caseId: Id<"policyChangeCases">;
  access: PolicyChangeAccess;
  onClose: () => void;
}) {
  const detail = useQuery(api.policyChanges.getCaseDetail, { caseId });
  const generatePacket = useMutation(api.policyChanges.generateCarrierPacket);
  const markStatus = useMutation(api.policyChanges.markStatus);
  const cancelRequest = useMutation(api.policyChanges.cancelRequest);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const changeCase = detail?.case;
  const packet = detail?.latestPacket;
  const items = asRecordArray(changeCase?.items);
  const missingInfo = asRecordArray(changeCase?.missingInfoQuestions);
  const validationIssues = asRecordArray(changeCase?.validationIssues);
  const artifacts = asRecordArray(packet?.artifacts);

  async function runAction(name: string, action: () => Promise<unknown>, success: string) {
    setLoadingAction(name);
    try {
      await action();
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update policy change request");
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-body-sm font-semibold text-foreground">
            {changeCase?.summary ?? "Policy change request"}
          </h2>
          <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 text-[10px] font-medium capitalize text-muted-foreground/55">
            {formatPolicyChangeStatus(changeCase?.status)}
          </Badge>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close policy change request">
          <X className="h-4 w-4" />
        </PillButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {detail === undefined ? (
          <div className="space-y-3">
            <div className="h-5 w-48 rounded bg-foreground/[0.04]" />
            <div className="h-24 rounded-md bg-foreground/[0.035]" />
            <div className="h-24 rounded-md bg-foreground/[0.035]" />
          </div>
        ) : changeCase ? (
          <div className="space-y-5">
            <section>
              <h3 className="text-label-sm font-medium text-muted-foreground/50">Request</h3>
              <p className="mt-2 whitespace-pre-wrap text-body-sm leading-6 text-foreground/85">
                {changeCase.requestText}
              </p>
            </section>

            <PolicyChangeProgress status={changeCase.status} />

            {access.canManage ? (
              <>
                <section>
                  <h3 className="text-label-sm font-medium text-muted-foreground/50">Affected values</h3>
                  <div className="mt-2 space-y-2">
                    {items.length > 0 ? items.map((item, index) => (
                      <div key={String(item.id ?? index)} className="rounded-md border border-foreground/6 p-3">
                        <p className="text-label-sm font-medium text-foreground">
                          {String(item.label ?? item.fieldPath ?? "Change item")}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground/45">
                          {String(item.action ?? "update")} · {String(item.kind ?? "general")}
                        </p>
                        <p className="mt-2 text-label-sm text-muted-foreground/70">
                          {String(item.beforeValue ?? "(not cited)")} → {String(item.requestedValue ?? item.afterValue ?? "(pending)")}
                        </p>
                      </div>
                    )) : (
                      <p className="text-label-sm text-muted-foreground/45">No structured change items yet.</p>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="text-label-sm font-medium text-muted-foreground/50">Validation</h3>
                  <div className="mt-2 space-y-2">
                    {validationIssues.length > 0 ? validationIssues.map((issue, index) => (
                      <div key={`${String(issue.code ?? "issue")}-${index}`} className="rounded-md border border-foreground/6 p-3">
                        <p className="text-label-sm font-medium text-foreground">
                          {String(issue.message ?? issue.code ?? "Validation issue")}
                        </p>
                        <p className="mt-1 text-[11px] capitalize text-muted-foreground/45">
                          {String(issue.severity ?? "warning")}
                        </p>
                      </div>
                    )) : (
                      <p className="text-label-sm text-muted-foreground/45">No validation issues recorded.</p>
                    )}
                  </div>
                </section>
              </>
            ) : null}

            <section>
              <h3 className="text-label-sm font-medium text-muted-foreground/50">Missing info</h3>
              <div className="mt-2 space-y-2">
                {missingInfo.length > 0 ? missingInfo.map((question, index) => (
                  <div key={String(question.id ?? index)} className="rounded-md border border-foreground/6 p-3">
                    <p className="text-label-sm text-foreground">
                      {String(question.question ?? "Missing information")}
                    </p>
                  </div>
                )) : (
                  <p className="text-label-sm text-muted-foreground/45">No open questions.</p>
                )}
              </div>
            </section>

            {access.canManage ? (
              <section>
                <h3 className="text-label-sm font-medium text-muted-foreground/50">Packet preview</h3>
                <div className="mt-2 space-y-2">
                  {artifacts.length > 0 ? artifacts.map((artifact, index) => (
                    <details key={`${String(artifact.kind ?? "artifact")}-${index}`} className="rounded-md border border-foreground/6 p-3">
                      <summary className="cursor-pointer text-label-sm font-medium text-foreground">
                        {String(artifact.title ?? artifact.kind ?? "Packet artifact")}
                      </summary>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
                        {String(artifact.content ?? "")}
                      </pre>
                    </details>
                  )) : (
                    <p className="text-label-sm text-muted-foreground/45">No generated packet yet.</p>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <p className="text-body-sm text-muted-foreground/45">Policy change request not found.</p>
        )}
      </div>

      {changeCase && access.canManage ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => runAction("packet", () => generatePacket({ caseId }), "Carrier packet generated")}
            disabled={loadingAction !== null}
          >
            {loadingAction === "packet" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            Packet
          </PillButton>
          {!isPolicyChangeTerminal(changeCase.status) ? (
            <PillButton
              type="button"
              variant="secondary"
              size="compact"
              onClick={() => runAction("cancel", () => cancelRequest({ caseId }), "Policy change request cancelled")}
              disabled={loadingAction !== null}
            >
              {loadingAction === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Cancel
            </PillButton>
          ) : null}
          {(["submitted", "accepted", "declined"] as const).map((status) => (
            <PillButton
              key={status}
              type="button"
              variant="secondary"
              size="compact"
              onClick={() => runAction(status, () => markStatus({ caseId, status }), `Marked ${status}`)}
              disabled={loadingAction !== null}
            >
              {loadingAction === status ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span className="capitalize">{status}</span>
            </PillButton>
          ))}
        </div>
      ) : changeCase && !isPolicyChangeTerminal(changeCase.status) ? (
        <div className="flex shrink-0 justify-end border-t border-foreground/8 px-4 py-3">
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => runAction("cancel", () => cancelRequest({ caseId }), "Policy change request cancelled")}
            disabled={loadingAction !== null}
          >
            {loadingAction === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Cancel
          </PillButton>
        </div>
      ) : null}
    </aside>
  );
}

function EmailThreadSidebar({
  message,
  onClose,
}: {
  message: ThreadMessage | null;
  onClose: () => void;
}) {
  const sendDraft = useAction(api.actions.sendPendingEmail.sendDraftNow);
  const cancelDraft = useMutation(api.pendingEmails.cancel);
  const pendingEmail = useQuery(
    api.pendingEmails.get,
    message?.pendingEmailId ? { id: message.pendingEmailId } : "skip",
  );
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

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
      ) : null}
    </aside>
  );
}

/* ── Pending email countdown + cancel ── */
function PendingSendCountdown({ pendingEmailId }: { pendingEmailId: Id<"pendingEmails"> }) {
  const pendingEmail = useQuery(api.pendingEmails.get, { id: pendingEmailId });
  const cancelMutation = useMutation(api.pendingEmails.cancel);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!pendingEmail || pendingEmail.status !== "pending") {
      return;
    }
    function tick() {
      const left = Math.max(0, Math.ceil((pendingEmail!.scheduledSendTime - Date.now()) / 1000));
      setRemaining(left);
    }
    tick();
    const interval = setInterval(tick, 200);
    return () => {
      clearInterval(interval);
      setRemaining(null);
    };
  }, [pendingEmail]);

  if (!pendingEmail || pendingEmail.status !== "pending" || remaining === null) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-label-sm text-muted-foreground/50">
        Sending in {remaining}s...
      </span>
      <button
        type="button"
        onClick={async () => {
          try {
            await cancelMutation({ id: pendingEmailId });
            toast.success("Email cancelled");
          } catch {
            toast.error("Failed to cancel");
          }
        }}
        className="text-label-sm font-medium text-red-500 hover:text-red-600 transition-colors cursor-pointer"
      >
        Cancel
      </button>
    </div>
  );
}

/* ── Unified message bubble ── */
export function UnifiedMessageBubble({
  msg,
  relatedEmailMessage,
  viewerId,
  viewerEmail,
  isLastAgentMessage,
  isFirstUserMessage,
  threadContext,
  brokerPerspective,
  agentBranding,
  collapseEmailMessages,
  onOpenEmail,
  openEmailMessageId,
  onOpenPolicyChange,
  openPolicyChangeCaseId,
}: {
  msg: ThreadMessage;
  relatedEmailMessage?: ThreadMessage;
  viewerId?: string;
  viewerEmail?: string;
  isLastAgentMessage?: boolean;
  isFirstUserMessage?: boolean;
  threadContext?: { pageType: string; entityId?: string; summary?: string };
  /** When true, render agent messages as if sent "by the broker" — right-aligned. */
  brokerPerspective?: boolean;
  /** Optional branding — when set, replaces generic "Glass" + asterisk on agent bubble. */
  agentBranding?: { name: string; iconUrl?: string | null };
  collapseEmailMessages?: boolean;
  onOpenEmail?: (message: ThreadMessage) => void;
  openEmailMessageId?: Id<"threadMessages"> | null;
  onOpenPolicyChange?: (caseId: Id<"policyChangeCases">) => void;
  openPolicyChangeCaseId?: Id<"policyChangeCases"> | null;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState(false);
  const [now] = useState(() => Date.now());
  const time = dayjs(msg._creationTime);
  const channelIcon = msg.channel === "email"
    ? <MailIcon className="w-3 h-3 text-muted-foreground/30" />
    : msg.channel === "imessage"
      ? <MessageCircle className="w-3 h-3 text-muted-foreground/30" />
      : null;

  // Processing state — unified bubble with thinking, tool status, and streaming content
  if (msg.role === "agent" && msg.status === "processing") {
    const hasContent = msg.content && msg.content.length > 0;
    const hasReasoning = msg.reasoning && msg.reasoning.length > 0;
    const ageMs = now - msg._creationTime;
    const isStale = ageMs > 60_000;
    // Tool status messages are like "*Searching policies...*"
    const isToolStatus = hasContent && /^\*[^*]+\.\.\.\*$/.test(msg.content.trim());
    const toolLabel = isToolStatus ? msg.content.trim().replace(/^\*|\*$/g, "") : null;
    // Clean content strips tool labels — only show real generated text
    const displayContent = isToolStatus ? "" : msg.content;

    return (
      <div className="flex items-start gap-2.5 max-w-lg">
        <div className="w-7 h-7 rounded-full bg-primary-light/15 flex items-center justify-center shrink-0 overflow-hidden">
          {agentBranding?.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agentBranding.iconUrl} alt="" className="w-7 h-7 object-cover" />
          ) : (
            <Asterisk className="w-3.5 h-3.5 text-primary-light" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-label-sm font-medium text-muted-foreground/50">{agentBranding?.name ?? "Glass"}</p>
            {channelIcon}
            <CancelButton messageId={msg._id} show />
          </div>

          {/* Reasoning toggle — appears above content */}
          {hasReasoning && (
            <CollapsibleReasoning
              reasoning={msg.reasoning ?? ""}
              isStreaming={true}
            />
          )}

          {/* Content bubble or thinking indicator */}
          {displayContent ? (
            <div className="rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 mt-1">
              <ProseMarkdown gfm breaks className={MARKDOWN_STYLES} components={markdownComponents}>{displayContent}</ProseMarkdown>
              <span className="inline-block w-1.5 h-4 bg-primary-light rounded-sm animate-pulse ml-0.5 align-middle" />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 h-6 mt-1">
              <span className="flex gap-[3px]">
                <span className="w-1 h-1 rounded-full bg-primary-light/60 animate-pulse" />
                <span className="w-1 h-1 rounded-full bg-primary-light/60 animate-pulse [animation-delay:150ms]" />
                <span className="w-1 h-1 rounded-full bg-primary-light/60 animate-pulse [animation-delay:300ms]" />
              </span>
              <span className="text-label-sm text-muted-foreground/40 select-none">
                {toolLabel ?? (isStale ? "Taking longer than expected" : "Thinking")}
              </span>
            </div>
          )}
          {relatedEmailMessage ? (
            <div className="mt-3">
              <EmailSummaryCard
                message={relatedEmailMessage}
                onOpen={onOpenEmail}
                compact
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Error state
  if (msg.status === "error") {
    return (
      <div className="rounded-lg bg-red-50/50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 p-3">
        <p className="text-label-sm text-red-600 dark:text-red-400">
          {msg.error ?? "An error occurred processing this message."}
        </p>
        <RetryButton messageId={msg._id} />
      </div>
    );
  }

  // Agent message
  if (msg.role === "agent") {
    const fixedContent = msg.content;

    // Cited sections from tool results (stored on message by processThreadChat)
    const citedSections = msg.citedSections;
    const citedCoverageNames = msg.citedCoverageNames;
    const toolCalls = msg.toolCalls?.length
      ? msg.toolCalls
      : (msg.usedTools ?? []).map((name) => ({ name }));

    // Build reference cards — referencedPolicyIds now only contains policies actually cited via lookup_policy_section
    const allRefs: { type: "policy"; id: string; page?: number }[] = [];
    const referencedPolicyIds = [
      ...(msg.referencedPolicyIds ?? []),
      ...(relatedEmailMessage?.referencedPolicyIds ?? []),
    ];
    const seenRefKeys = new Set<string>();
    for (const pid of referencedPolicyIds) {
      const key = `policy:${pid}`;
      if (!seenRefKeys.has(key)) {
        seenRefKeys.add(key);
        allRefs.push({ type: "policy", id: pid as string });
      }
    }
    return (
      <div>
        <div className={`flex items-start gap-2.5 max-w-lg w-fit ${brokerPerspective ? "ml-auto flex-row-reverse" : ""}`}>
          <div className="w-7 h-7 rounded-full bg-primary-light/15 flex items-center justify-center shrink-0 overflow-hidden">
            {agentBranding?.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agentBranding.iconUrl} alt="" className="w-7 h-7 object-cover" />
            ) : (
              <Asterisk className="w-3.5 h-3.5 text-primary-light" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`flex items-center gap-2 mb-1 ${brokerPerspective ? "justify-end" : ""}`}>
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-label-sm font-medium text-muted-foreground/50">{agentBranding?.name ?? "Glass"}</p>
                {channelIcon}
                <span className="text-muted-foreground/20">·</span>
                <span className="text-label-sm text-muted-foreground/25">{time.format("MMM D, h:mm A")}</span>
              </div>
            </div>
            {msg.channel === "email" && !collapseEmailMessages && msg.toAddresses && (
              <div className="flex flex-wrap gap-x-3 text-label-sm text-muted-foreground/35 mb-1">
                <span className="truncate">
                  <span className="text-muted-foreground/25">To:</span>{" "}
                  {msg.toAddresses.join(", ")}
                </span>
                {msg.ccAddresses && msg.ccAddresses.length > 0 && (
                  <span className="truncate">
                    <span className="text-muted-foreground/25">CC:</span>{" "}
                    {msg.ccAddresses.join(", ")}
                  </span>
                )}
              </div>
            )}
            {collapseEmailMessages && msg.channel === "email" ? (
              <EmailSummaryCard message={msg} onOpen={onOpenEmail} isOpen={openEmailMessageId === msg._id} />
            ) : (
              <>
                {/* Reasoning — collapsed above the response */}
                <CollapsibleReasoning
                  reasoning={msg.reasoning ?? ""}
                  isStreaming={false}
                />
                <div className={`rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 ${msg.reasoning ? "mt-1" : ""}`}>
                  <ProseMarkdown gfm breaks className={MARKDOWN_STYLES} components={markdownComponents}>{fixedContent}</ProseMarkdown>
                </div>
                <MessageFooterActions
                  refs={allRefs}
                  citedSections={citedSections}
                  citedCoverageNames={citedCoverageNames}
                  toolCalls={toolCalls}
                  copyContent={msg.content}
                  showToolCalls={showToolCalls}
                  onToggleToolCalls={() => setShowToolCalls((value) => !value)}
                  rightAligned={brokerPerspective}
                />
                {relatedEmailMessage ? (
                  <div className="mt-4">
                    <EmailSummaryCard
                      message={relatedEmailMessage}
                      onOpen={onOpenEmail}
                      compact
                      isOpen={openEmailMessageId === relatedEmailMessage._id}
                    />
                  </div>
                ) : null}
                {msg.policyChangeCaseId ? (
                  <div className="mt-4">
                    <PolicyChangeSummaryCard
                      caseId={msg.policyChangeCaseId}
                      onOpen={onOpenPolicyChange}
                      isOpen={openPolicyChangeCaseId === msg.policyChangeCaseId}
                    />
                  </div>
                ) : null}
                {toolCalls.length > 0 && showToolCalls && <ToolCallPanel toolCalls={toolCalls} />}
              </>
            )}
            {!(collapseEmailMessages && msg.channel === "email") && msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {msg.attachments.map((att, i) => (
                  <ThreadAttachmentChip key={i} attachment={att} threadId={msg.threadId} />
                ))}
              </div>
            )}
            {msg.status === "pending_send" && msg.pendingEmailId && (
              <PendingSendCountdown pendingEmailId={msg.pendingEmailId} />
            )}
          </div>
        </div>
        {isLastAgentMessage && (!msg.content || msg.content.trim().length === 0) && (
          <RetryButton messageId={msg._id} />
        )}
      </div>
    );
  }

  // User message
  const isOwnMessage =
    (viewerId && msg.userId === viewerId) ||
    (viewerEmail && msg.fromEmail?.toLowerCase() === viewerEmail.toLowerCase());

  const displayName =
    msg.channel === "imessage"
      ? msg.imessageParticipantLabel ?? msg.userName ?? msg.imessageSenderAddress ?? "iMessage participant"
      : msg.userName ?? msg.fromName ?? msg.fromEmail ?? "User";

  // For email messages, strip quoted reply text
  const isEmail = msg.channel === "email";
  const { content: cleanContent, quoted } = isEmail
    ? splitQuotedReply(msg.content)
    : { content: msg.content, quoted: null };

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className={`flex items-start gap-2.5 max-w-lg w-fit ${isOwnMessage ? "ml-auto flex-row-reverse" : ""}`}>
      <div className="w-7 h-7 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
        <span className="text-label-sm font-semibold text-foreground/60">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className={`flex items-center gap-2 mb-1 ${isOwnMessage ? "justify-end" : ""}`}>
          <p className="text-label-sm font-medium text-muted-foreground/50">{displayName}</p>
          {channelIcon}
          <span className="text-muted-foreground/20">·</span>
          <span className="text-label-sm text-muted-foreground/25">{time.format("MMM D, h:mm A")}</span>
        </div>
        {isEmail && !collapseEmailMessages && msg.toAddresses && (
          <div className="flex flex-wrap gap-x-3 text-label-sm text-muted-foreground/35 mb-1">
            <span className="truncate">
              <span className="text-muted-foreground/25">To:</span>{" "}
              {msg.toAddresses.join(", ")}
            </span>
            {msg.ccAddresses && msg.ccAddresses.length > 0 && (
              <span className="truncate">
                <span className="text-muted-foreground/25">CC:</span>{" "}
                {msg.ccAddresses.join(", ")}
              </span>
            )}
          </div>
        )}
        {collapseEmailMessages && isEmail ? (
          <EmailSummaryCard message={msg} onOpen={onOpenEmail} isOpen={openEmailMessageId === msg._id} />
        ) : (
        <div className={`rounded-lg px-3.5 py-2.5 text-body-sm text-foreground ${
          isEmail
            ? `border border-foreground/6 ${isOwnMessage ? "bg-foreground/[0.04]" : "bg-foreground/[0.02]"}`
            : isOwnMessage ? "bg-foreground/[0.06]" : "bg-foreground/[0.03]"
        }`}>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {cleanContent}
          </p>
          {quoted && (
            <>
              <button
                type="button"
                onClick={() => setShowQuoted(!showQuoted)}
                className="mt-1.5 text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer"
              >
                {showQuoted ? "Hide quoted text ▴" : "Show quoted text ▾"}
              </button>
              {showQuoted && <QuotedContent text={quoted} />}
            </>
          )}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-foreground/6 flex flex-wrap gap-2">
              {msg.attachments.map((att, i) => (
                <ThreadAttachmentChip key={i} attachment={att} threadId={msg.threadId} />
              ))}
            </div>
          )}
        </div>
        )}
        {isFirstUserMessage && threadContext && (
          <div className="mt-2">
            <ThreadContextLink context={threadContext} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Cancel button for stuck processing messages ── */
function CancelButton({ messageId, show }: { messageId: string; show: boolean }) {
  const cancel = useMutation(api.threads.cancelProcessing);
  const [cancelling, setCancelling] = useState(false);
  if (!show) return null;

  return (
    <button
      type="button"
      disabled={cancelling}
      onClick={async () => {
        setCancelling(true);
        try {
          await cancel({ messageId: messageId as Id<"threadMessages"> });
        } catch {
          toast.error("Failed to cancel");
        } finally {
          setCancelling(false);
        }
      }}
      className="inline-flex h-5 items-center gap-1.5 text-label-sm leading-5 text-muted-foreground/35 transition-colors hover:text-muted-foreground/60 disabled:opacity-50"
    >
      {cancelling ? "Cancelling..." : "Cancel"}
    </button>
  );
}

/* ── Copy button for agent messages ── */
function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  if (!content?.trim()) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground/40 transition-colors hover:border-foreground/8 hover:bg-foreground/[0.03] hover:text-foreground/70"
      title="Copy response"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/* ── Retry button for failed/blank agent messages ── */
function RetryButton({ messageId }: { messageId: string }) {
  const retry = useMutation(api.threads.retryAgentResponse);
  const [retrying, setRetrying] = useState(false);

  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try {
          await retry({ messageId: messageId as Id<"threadMessages"> });
        } catch {
          toast.error("Failed to retry");
        } finally {
          setRetrying(false);
        }
      }}
      className="inline-flex items-center gap-1.5 mt-2 ml-9.5 text-label-sm text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer disabled:opacity-50"
    >
      <RotateCcw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
      {retrying ? "Retrying..." : "Retry response"}
    </button>
  );
}

/* ── Initial context link (shows which entity the chat was started from) ── */
export function ThreadContextLink({
  context,
}: {
  context: { pageType: string; entityId?: string; summary?: string };
}) {
  if (!context.entityId) return null;

  // Policy: delegate to the unified PolicyReferenceCard (opens preview side panel).
  if (context.pageType === "policy") {
    return <PolicyReferenceCard id={context.entityId} />;
  }

  // Quote fallback: no openPreview path today, keep the link-style card.
  if (context.pageType === "quote" && context.summary) {
    const href = `/policies/${context.entityId}`;
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-foreground/6 bg-card hover:bg-foreground/[0.02] hover:border-foreground/10 transition-colors text-left max-w-sm"
      >
        <div className="w-6 h-6 rounded-md bg-foreground/[0.04] flex items-center justify-center shrink-0">
          <ClipboardList className="w-3.5 h-3.5 text-muted-foreground/50" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-label-sm text-muted-foreground/40 font-medium leading-none mb-0.5">Quote</p>
          <p className="text-label-sm text-foreground truncate">{context.summary}</p>
        </div>
      </Link>
    );
  }

  return null;
}

/* ── Thread email mailto link ── */
function ThreadEmailLink({ threadEmail, subject }: { threadEmail?: string; subject?: string }) {
  if (!threadEmail) return null;
  const subjectParam = subject ? `?subject=Re: ${encodeURIComponent(subject)}` : "";
  return (
    <div className="flex items-center justify-center pb-2">
      <a
        href={`mailto:${threadEmail}${subjectParam}`}
        className="inline-flex items-center gap-1.5 text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors no-underline flex-wrap justify-center"
      >
        <MailIcon className="w-3 h-3 shrink-0" />
        <span>Continue via email —</span>
        <span className="font-mono text-muted-foreground/50 break-all">{threadEmail}</span>
      </a>
    </div>
  );
}

/* ── Unified thread content ── */
function UnifiedThreadContent({
  threadId,
  onMeta,
  onRightPanel,
  viewerId,
  viewerEmail,
  agentBranding,
  policyChangeAccess,
}: {
  threadId: Id<"threads">;
  onMeta?: (meta: { detail: React.ReactNode; actions: React.ReactNode }) => void;
  onRightPanel?: (panel: React.ReactNode | null) => void;
  viewerId?: string;
  viewerEmail?: string;
  agentHandle?: string;
  agentBranding?: { name: string; iconUrl?: string | null };
  policyChangeAccess: PolicyChangeAccess;
}) {
  const thread = useQuery(api.threads.get, { id: threadId });
  const messages = useQuery(api.threads.messages, { threadId }) as ThreadMessage[] | undefined;
  const sendMessage = useMutation(api.threads.sendMessage);
  const updateTitle = useMutation(api.threads.updateTitle);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<GlassPromptInputHandle>(null);
  const prevThreadId = useRef<string | null>(null);
  const lastAutoOpenedEmailId = useRef<string | null>(null);
  const lastAutoOpenedPolicyChangeCaseId = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openEmailMessageId, setOpenEmailMessageId] = useState<Id<"threadMessages"> | null>(null);
  const [openPolicyChangeCaseId, setOpenPolicyChangeCaseId] = useState<Id<"policyChangeCases"> | null>(null);
  const openEmailMessage = useMemo(
    () => messages?.find((message) => message._id === openEmailMessageId) ?? null,
    [messages, openEmailMessageId],
  );

  // Error state for chat — stored as { threadId, message } so switching threads auto-clears it
  const [chatErrorState, setChatErrorState] = useState<{ threadId: string; message: string } | null>(null);
  const chatError = chatErrorState?.threadId === threadId ? chatErrorState.message : null;
  const setChatError = useCallback((msg: string | null) =>
    setChatErrorState(msg ? { threadId, message: msg } : null), [threadId]);

  // Push title + actions to parent for AppShell header
  useEffect(() => {
    if (!thread || !onMeta) return;
    onMeta({
      detail: (
        <EditableBreadcrumbTitle
          title={thread.title}
          onSave={async (next) => {
            try {
              await updateTitle({ id: threadId, title: next });
            } catch {
              toast.error("Failed to update title");
            }
          }}
        />
      ),
      actions: (
        <UnifiedThreadActions
          threadId={threadId}
          thread={thread}
          messages={messages}
        />
      ),
    });
  }, [thread, threadId, onMeta, messages, updateTitle]);

  useEffect(() => {
    if (!onRightPanel) return;
    onRightPanel(
      openEmailMessage
        ? <EmailThreadSidebar message={openEmailMessage} onClose={() => setOpenEmailMessageId(null)} />
        : openPolicyChangeCaseId
          ? (
              <PolicyChangeThreadSidebar
                caseId={openPolicyChangeCaseId}
                access={policyChangeAccess}
                onClose={() => setOpenPolicyChangeCaseId(null)}
              />
            )
          : null,
    );
    return () => onRightPanel(null);
  }, [onRightPanel, openEmailMessage, openPolicyChangeCaseId, policyChangeAccess]);

  // Scroll to bottom when messages change or thread switches
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNew = prevThreadId.current !== threadId;
    prevThreadId.current = threadId;
    if (isNew) {
      setOpenEmailMessageId(null);
      setOpenPolicyChangeCaseId(null);
      lastAutoOpenedEmailId.current = null;
      lastAutoOpenedPolicyChangeCaseId.current = null;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: isNew ? "instant" : "smooth" });
  }, [threadId, messages?.length]);

  useEffect(() => {
    const latestDraftEmail = messages
      ?.filter((message) => message.channel === "email" && message.role === "agent" && message.status === "draft_email")
      .at(-1);
    if (!latestDraftEmail) return;
    if (lastAutoOpenedEmailId.current === latestDraftEmail._id) return;
    lastAutoOpenedEmailId.current = latestDraftEmail._id;
    setOpenPolicyChangeCaseId(null);
    setOpenEmailMessageId(latestDraftEmail._id);
  }, [messages]);

  useEffect(() => {
    const latestPolicyChange = messages
      ?.filter((message) => message.role === "agent" && message.policyChangeCaseId)
      .at(-1);
    if (!latestPolicyChange?.policyChangeCaseId) return;
    if (lastAutoOpenedPolicyChangeCaseId.current === latestPolicyChange.policyChangeCaseId) return;
    lastAutoOpenedPolicyChangeCaseId.current = latestPolicyChange.policyChangeCaseId;
    setOpenEmailMessageId(null);
    setOpenPolicyChangeCaseId(latestPolicyChange.policyChangeCaseId);
  }, [messages]);

  // Auto-scroll when new messages arrive (agent streaming via Convex subscription)
  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !messages) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "agent") return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const isAgentProcessing = useMemo(
    () => messages?.some((m) => m.role === "agent" && m.status === "processing") ?? false,
    [messages],
  );
  const isAwaitingAgent = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    const lastUserIndex = messages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);
    const lastAgentIndex = messages.reduce((acc, m, i) => m.role === "agent" ? i : acc, -1);
    return lastUserIndex > lastAgentIndex;
  }, [messages]);
  const isInputBusy = isSubmitting || isAgentProcessing || isAwaitingAgent;

  const handleSend = useCallback(async (message: PromptInputMessage) => {
    if (isInputBusy) return;
    const text = message.text.trim();
    if (!text && message.files.length === 0) return;

    setIsSubmitting(true);
    try {
      // Upload files first if any
      const attachments: { filename: string; contentType: string; size: number; fileId: Id<"_storage"> }[] = [];
      if (message.files.length > 0) {
        for (const file of message.files) {
          const url = await generateUploadUrl();
          const blob = await fetch(file.url).then((r) => r.blob());
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": file.mediaType || "application/octet-stream" },
            body: blob,
          });
          if (res.ok) {
            const { storageId } = await res.json();
            attachments.push({
              filename: file.filename ?? "file",
              contentType: file.mediaType || "application/octet-stream",
              size: blob.size,
              fileId: storageId as Id<"_storage">,
            });
          }
        }
      }

      // If there are attachments, use mutation-based flow (backend handles response)
      if (attachments.length > 0) {
        await sendMessage({
          threadId,
          content: text || "(attached files)",
          attachments,
        });
        return;
      }

      // For text-only messages, send via Convex (processThreadChat handles the response)
      setChatError(null);
      await sendMessage({ threadId, content: text });
    } finally {
      setIsSubmitting(false);
    }
  }, [sendMessage, threadId, generateUploadUrl, setChatError, isInputBusy]);

  const collapseEmailMessages = thread?.originChannel !== "email";

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Messages — full height, content scrolls under the input overlay */}
      <div ref={messagesRef} className="absolute inset-0 overflow-y-auto p-4 pr-5">
        <div className="max-w-2xl mx-auto space-y-4">
          {(!messages || messages.length === 0) && (
            <NewChatEmptyState onSelectPrompt={(prompt) => chatInputRef.current?.setValueAndFocus(prompt)} />
          )}
          {(() => {
            const lastAgentIdx = messages?.reduce((acc, m, i) => m.role === "agent" ? i : acc, -1) ?? -1;
            const firstUserIdx = messages?.findIndex((m) => m.role === "user") ?? -1;
            const attachedEmailMessageIds = new Set<string>();
            return messages?.map((msg, idx) => {
              if (attachedEmailMessageIds.has(msg._id)) return null;
              const isFirstUser = idx === firstUserIdx;
              const firstUserIsOwn =
                isFirstUser &&
                ((viewerId && msg.userId === viewerId) ||
                  (viewerEmail && msg.fromEmail?.toLowerCase() === viewerEmail.toLowerCase()));
              const relatedEmailMessage = msg.role === "agent" && msg.channel === "chat" && msg.pendingEmailId
                ? messages.find((candidate) =>
                    candidate.channel === "email" &&
                    candidate.role === "agent" &&
                    candidate.pendingEmailId === msg.pendingEmailId)
                : undefined;
              if (relatedEmailMessage) attachedEmailMessageIds.add(relatedEmailMessage._id);

              return (
                <div key={msg._id}>
                  <UnifiedMessageBubble
                    msg={msg}
                    relatedEmailMessage={relatedEmailMessage}
                    viewerId={viewerId}
                    viewerEmail={viewerEmail}
                    isLastAgentMessage={idx === lastAgentIdx}
                    isFirstUserMessage={false}
                    threadContext={undefined}
                    agentBranding={agentBranding}
                    collapseEmailMessages={collapseEmailMessages}
                    onOpenEmail={(message) => {
                      setOpenPolicyChangeCaseId(null);
                      setOpenEmailMessageId(message._id);
                    }}
                    openEmailMessageId={openEmailMessageId}
                    onOpenPolicyChange={(caseId) => {
                      setOpenEmailMessageId(null);
                      setOpenPolicyChangeCaseId(caseId);
                    }}
                    openPolicyChangeCaseId={openPolicyChangeCaseId}
                  />
                  {isFirstUser && thread?.initialContext && (
                    <div className={`mt-2 flex ${firstUserIsOwn ? "justify-end mr-9.5" : "ml-9.5"}`}>
                      <ThreadContextLink context={thread.initialContext} />
                    </div>
                  )}
                </div>
              );
            });
          })()}
          {chatError && (
            <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {chatError}
            </div>
          )}
          {/* Padding so last message clears the input overlay */}
          {messages && messages.length > 0 && <div className="h-40" />}
        </div>
      </div>
      {/* Input — overlaid at bottom, content scrolls under it */}
      <ChatInputOverlay>
        {messages && messages.length > 0 && thread.threadEmail && (
          <ThreadEmailLink threadEmail={thread.threadEmail} subject={thread.title !== "New chat" ? thread.title : undefined} />
        )}
        <GlassPromptInput
          ref={chatInputRef}
          onSubmit={handleSend}
          placeholder="Reply to this thread..."
          showAttach
          agentBranding={agentBranding}
          disabled={isInputBusy}
          status={isInputBusy ? "submitted" : undefined}
        />
      </ChatInputOverlay>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Main Thread Page
   ═══════════════════════════════════════════════════ */

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const presenceUsers = usePresence(`thread:${id}`);
  const agentHandle = viewerOrg?.brokerOrg?.agentHandle ?? viewerOrg?.org?.agentHandle;
  const agentBranding = viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false && viewerOrg?.brokerOrg
    ? { name: `${viewerOrg.brokerOrg.name} Agent`, iconUrl: viewerOrg.brokerOrg.iconUrl }
    : undefined;
  const policyChangeAccess = useMemo<PolicyChangeAccess>(() => {
    const isBroker = viewerOrg?.org?.type === "broker";
    const brokerConnected = isBroker || !!viewerOrg?.org?.brokerOrgId || !!viewerOrg?.brokerOrg?._id;
    return {
      canManage: isBroker,
      actorLabel: isBroker ? "broker" : "client",
      brokerConnected,
    };
  }, [viewerOrg?.brokerOrg?._id, viewerOrg?.org?.brokerOrgId, viewerOrg?.org?.type]);

  // Thread metadata lifted from child components for AppShell header
  const [threadMeta, setThreadMeta] = useState<{ detail: React.ReactNode; actions: React.ReactNode }>({
    detail: "Conversation",
    actions: null,
  });
  const [rightPanel, setRightPanel] = useState<React.ReactNode | null>(null);

  // Try unified threads table first
  const unifiedThread = useQuery(api.threads.tryGet, { id });

  const handleUnifiedMeta = useCallback((meta: { detail: React.ReactNode; actions: React.ReactNode }) => {
    setThreadMeta(meta);
  }, []);

  // Loading: unified query still pending
  if (unifiedThread === undefined) {
    return (
      <AppShell breadcrumbDetail="Conversation">
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
          </div>
        </div>
      </AppShell>
    );
  }

  // Found in unified threads table
  if (unifiedThread) {
    return (
      <AppShell
        breadcrumbDetail={threadMeta.detail}
        actions={threadMeta.actions}
        presenceUsers={presenceUsers}
        rightPanel={rightPanel}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full flex flex-col">
            <UnifiedThreadContent
              threadId={unifiedThread._id}
              onMeta={handleUnifiedMeta}
              onRightPanel={setRightPanel}
              viewerId={viewer?._id}
              viewerEmail={viewer?.email ?? undefined}
              agentHandle={agentHandle ?? undefined}
              agentBranding={agentBranding}
              policyChangeAccess={policyChangeAccess}
            />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbDetail="Conversation" presenceUsers={presenceUsers}>
      <div className="absolute inset-0 overflow-hidden">
        <div className="h-full flex items-center justify-center">
          <p className="text-body-sm text-muted-foreground/40">Thread not found</p>
        </div>
      </div>
    </AppShell>
  );
}
