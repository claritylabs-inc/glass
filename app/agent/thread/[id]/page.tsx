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
import { Loader2, Archive, ArchiveRestore, FileText, Check, ClipboardList, Mail as MailIcon, MessageCircle, Paperclip, Download, Copy, RotateCcw, X, AlertTriangle, Clock } from "lucide-react";
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
import { LogoIcon } from "@/components/ui/logo-icon";

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
  referencedQuoteIds?: Id<"policies">[];
  referencedRequirementIds?: Id<"insuranceRequirements">[];
  referencedMailboxIds?: Id<"connectedEmailAccounts">[];
  usedTools?: string[];
  toolCalls?: { name: string; input?: string; output?: string }[];
  toolArtifacts?: { type: string; data: unknown }[];
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
  attach_policy_document: "Attached policy PDF",
  send_email: "Drafted email",
  email_expert: "Prepared email",
  render_email_preview: "Rendered email preview",
  create_policy_change_request: "Created policy change request",
  lookup_connected_vendors: "Checked vendors",
  lookup_vendor_policies: "Read vendor policies",
  lookup_vendor_compliance: "Checked vendor compliance",
  coordinate_mailbox_task: "Coordinated mailbox task",
};

const SUBAGENT_TOOL_NAMES = new Set(["email_expert", "coordinate_mailbox_task"]);
const SCIENTIST_SURNAMES = [
  "Curie",
  "Einstein",
  "Noether",
  "Turing",
  "Hopper",
  "Feynman",
  "Lovelace",
  "Bohr",
  "Faraday",
  "Franklin",
  "Maxwell",
  "Meitner",
  "Newton",
  "Sagan",
  "Tesla",
  "Ramanujan",
];

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scientistSurnameFor(seed: string, index: number) {
  return SCIENTIST_SURNAMES[(stableHash(seed) + index * 7) % SCIENTIST_SURNAMES.length];
}

const EMAIL_SENDING_RE = /^sending email to\s+(.+?)(?:\s*\(cc:.*\))?\s*\.{3}$/i;
const EMAIL_SENT_RE = /^email sent to\s+(.+?)(?:\s*\(cc:.*\))?\s*\.$/i;

function normalizeStatusContent(content: string) {
  return content
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getEmailStatusRecipient(message: ThreadMessage) {
  const normalized = normalizeStatusContent(message.content);
  const match = normalized.match(EMAIL_SENT_RE) ?? normalized.match(EMAIL_SENDING_RE);
  return match?.[1]?.trim().toLowerCase();
}

function isEmailSendStatusMessage(message: ThreadMessage) {
  if (message.role !== "agent") return false;
  if (message.channel !== "chat" && message.channel !== "imessage") return false;
  if (message.pendingEmailId) return true;
  return getEmailStatusRecipient(message) != null;
}

function isEmailSendingStatusMessage(message: ThreadMessage) {
  return EMAIL_SENDING_RE.test(normalizeStatusContent(message.content));
}

function isEmailSentStatusMessage(message: ThreadMessage) {
  return EMAIL_SENT_RE.test(normalizeStatusContent(message.content));
}

function isSavedThreadAttachmentMessage(message: ThreadMessage) {
  const content = message.content.trim();
  return (
    message.role === "agent" &&
    message.channel === "chat" &&
    !!message.attachments?.length &&
    (
      (/^Saved \d+ document/i.test(content) && content.includes("from connected email")) ||
      /^Saved connected email message/i.test(content)
    )
  );
}

function emailMessageMatchesRecipient(message: ThreadMessage, recipient?: string) {
  if (!recipient) return true;
  return message.toAddresses?.some((address) => address.toLowerCase() === recipient) ?? false;
}

function findRelatedEmailMessage(
  messages: ThreadMessage[],
  message: ThreadMessage,
  index: number,
  attachedEmailMessageIds: Set<string>,
) {
  if (!isEmailSendStatusMessage(message)) return undefined;

  if (message.pendingEmailId) {
    const linked = messages.find((candidate) =>
      candidate.channel === "email" &&
      candidate.role === "agent" &&
      candidate.pendingEmailId === message.pendingEmailId &&
      candidate._id !== message._id
    );
    if (linked) return linked;
  }

  const recipient = getEmailStatusRecipient(message);
  let start = index;
  while (start > 0 && messages[start - 1]?.role !== "user") start -= 1;
  let end = index;
  while (end + 1 < messages.length && messages[end + 1]?.role !== "user") end += 1;

  return messages
    .slice(start, end + 1)
    .filter((candidate) =>
      candidate.channel === "email" &&
      candidate.role === "agent" &&
      candidate._id !== message._id &&
      !attachedEmailMessageIds.has(candidate._id) &&
      emailMessageMatchesRecipient(candidate, recipient)
    )
    .sort((a, b) =>
      Math.abs(a._creationTime - message._creationTime) -
      Math.abs(b._creationTime - message._creationTime)
    )[0];
}

function hasLaterEmailSendCompletion(
  messages: ThreadMessage[],
  message: ThreadMessage,
  index: number,
) {
  if (!isEmailSendingStatusMessage(message)) return false;
  const recipient = getEmailStatusRecipient(message);
  for (let i = index + 1; i < messages.length; i += 1) {
    const candidate = messages[i];
    if (!candidate || candidate.role === "user") return false;
    if (
      message.pendingEmailId &&
      candidate.pendingEmailId === message.pendingEmailId &&
      isEmailSentStatusMessage(candidate)
    ) {
      return true;
    }
    if (isEmailSentStatusMessage(candidate) && getEmailStatusRecipient(candidate) === recipient) {
      return true;
    }
  }
  return false;
}

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
  showOutput = false,
  displayName: displayNameOverride,
}: {
  toolCall: { name: string; input?: string; output?: string };
  index: number;
  showOutput?: boolean;
  displayName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = displayNameOverride ?? TOOL_DISPLAY_NAMES[toolCall.name] ?? toolCall.name;

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
        <div className="space-y-2 border-t border-foreground/6 px-2.5 pb-2.5 pt-2">
          {showOutput && toolCall.output ? (
            <div>
              <p className="mb-1 text-[10px] font-medium text-muted-foreground/40">
                Output
              </p>
              <pre className="max-h-64 overflow-auto rounded border border-foreground/6 bg-background p-2 font-mono text-[10px] leading-4 text-foreground/70">
                <code className="whitespace-pre-wrap break-words">{formatToolInput(toolCall.output)}</code>
              </pre>
            </div>
          ) : null}
          {!showOutput || !toolCall.output ? (
            <div>
              <p className="mb-1 text-[10px] font-medium text-muted-foreground/40">
                Parameters
              </p>
              <pre className="max-h-48 overflow-auto rounded border border-foreground/6 bg-background p-2 font-mono text-[10px] leading-4 text-foreground/70">
                <code className="whitespace-pre-wrap break-words">{formatToolInput(toolCall.input)}</code>
              </pre>
            </div>
          ) : null}
          <span className="sr-only">Tool call {index + 1}</span>
        </div>
      )}
    </div>
  );
}

function ToolCallPanel({
  toolCalls,
}: {
  toolCalls: { name: string; input?: string; output?: string }[];
}) {
  return (
    <div className="mt-1.5 space-y-1.5">
      {toolCalls.map((toolCall, index) => (
        <ToolCallCard key={`${toolCall.name}-${index}`} toolCall={toolCall} index={index} />
      ))}
    </div>
  );
}

function EmailRecipientMeta({
  toAddresses,
  ccAddresses,
}: {
  toAddresses?: string[];
  ccAddresses?: string[];
}) {
  if (!toAddresses?.length) return null;
  const ccCount = ccAddresses?.length ?? 0;

  return (
    <span className="min-w-0 truncate text-label-sm font-normal text-muted-foreground/30">
      <span className="text-muted-foreground/22">to</span>{" "}
      <span className="text-muted-foreground/38">{toAddresses.join(", ")}</span>
      {ccCount > 0 ? (
        <span className="text-muted-foreground/28"> +{ccCount} cc</span>
      ) : null}
    </span>
  );
}

function MessageFooterActions({
  refs,
  citedSections,
  citedCoverageNames,
  toolCalls,
  subagentActivityCount,
  mailboxArtifacts,
  messageId,
  onOpenMailboxArtifact,
  openMailboxArtifactRef,
  copyContent,
  retryMessageId,
  showToolCalls,
  onToggleToolCalls,
  showSubagentActivity,
  onToggleSubagentActivity,
  rightAligned,
}: {
  refs: { type: "policy"; id: string; page?: number }[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  toolCalls: { name: string; input?: string; output?: string }[];
  subagentActivityCount?: number;
  mailboxArtifacts?: ToolArtifactData[];
  messageId?: Id<"threadMessages">;
  onOpenMailboxArtifact?: (ref: MailboxArtifactRef) => void;
  openMailboxArtifactRef?: MailboxArtifactRef | null;
  copyContent?: string;
  retryMessageId?: Id<"threadMessages">;
  showToolCalls: boolean;
  onToggleToolCalls: () => void;
  showSubagentActivity?: boolean;
  onToggleSubagentActivity?: () => void;
  rightAligned?: boolean;
}) {
  const [isMailboxExpanded, setIsMailboxExpanded] = useState(false);
  const hasSubagentActivity = (subagentActivityCount ?? 0) > 0;
  const mailboxTasks = mailboxArtifacts?.filter((artifact) => artifact.type === "mailbox_task") ?? [];
  const hasMailboxTasks = mailboxTasks.length > 0;
  const selectedMailboxIndex = openMailboxArtifactRef?.messageId === messageId
    ? (openMailboxArtifactRef?.index ?? null)
    : null;
  if (refs.length === 0 && toolCalls.length === 0 && !hasSubagentActivity && !hasMailboxTasks && !copyContent?.trim() && !retryMessageId) return null;

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
        {hasSubagentActivity && (
          <button
            type="button"
            onClick={onToggleSubagentActivity}
            aria-expanded={showSubagentActivity}
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-foreground/8 bg-transparent px-2 text-[11px] font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/[0.03] hover:text-foreground/75"
          >
            <LogoIcon size={12} static className="h-3 w-3" />
            {subagentActivityCount} subagent{subagentActivityCount === 1 ? "" : "s"}
          </button>
        )}
        {mailboxTasks.length === 1 ? (
          <button
            type="button"
            onClick={() => {
              if (!messageId) return;
              onOpenMailboxArtifact?.({ messageId, index: 0 });
            }}
            className={`inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border bg-transparent px-2 text-label-sm font-medium transition-colors ${
              selectedMailboxIndex === 0
                ? "border-foreground/18 bg-foreground/[0.04] text-foreground/75"
                : "border-foreground/8 text-muted-foreground/60 hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
            }`}
          >
            <span className="text-muted-foreground/35">1</span>
            <span className="truncate">Background agent</span>
          </button>
        ) : mailboxTasks.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setIsMailboxExpanded((value) => !value)}
              aria-expanded={isMailboxExpanded}
              className="inline-flex h-6 items-center rounded-full border border-foreground/8 bg-transparent px-2 text-label-sm font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
            >
              {mailboxTasks.length}+ background agents
            </button>
            {isMailboxExpanded ? (
              <div className="flex flex-wrap items-start gap-1.5">
                {mailboxTasks.map((_, index) => {
                  const isSelected = selectedMailboxIndex === index;
                  return (
                    <span
                      key={`mailbox-footer-${index}`}
                      className="transition-[opacity,transform] duration-200 ease-out"
                      style={{ transitionDelay: `${Math.min(index * 25, 100)}ms` }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!messageId) return;
                          onOpenMailboxArtifact?.({ messageId, index });
                        }}
                        className={`inline-flex h-6 max-w-48 items-center gap-1.5 rounded-full border bg-transparent px-2 text-label-sm font-medium transition-colors ${
                          isSelected
                            ? "border-foreground/18 bg-foreground/[0.04] text-foreground/75"
                            : "border-foreground/8 text-muted-foreground/60 hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
                        }`}
                      >
                        <span className="text-muted-foreground/35">{index + 1}</span>
                        <span className="truncate">Background agent</span>
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {retryMessageId ? <TryAgainMessageButton messageId={retryMessageId} /> : null}
        {copyContent?.trim() ? <CopyMessageButton content={copyContent} /> : null}
      </div>
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
      <PillButton size="compact" variant="iconLabel" onClick={handleCopyThread} label="Copy thread">
        <Copy className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton size="compact" variant="iconLabel" onClick={handleArchiveToggle} label={isArchived ? "Unarchive" : "Archive"}>
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
          ? "border-foreground/10 bg-card hover:bg-foreground/[0.03] hover:border-foreground/15"
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

  async function handleRestore(event: React.MouseEvent) {
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

type VendorComplianceCheck = {
  requirementId?: string;
  title?: string;
  status?: string;
  requiredLimit?: string;
  expiresAt?: string;
  daysUntilExpiration?: number;
  notes?: string;
  matchedPolicy?: {
    carrier?: string;
    policyNumber?: string;
    insuredName?: string;
    expectedInsuredName?: string;
    expirationDate?: string;
    coverageName?: string;
    coverageLimit?: string;
    detectedLimitAmount?: number;
  };
};

type VendorComplianceRow = {
  vendorOrgId?: string;
  name?: string;
  status?: string;
  requirementCount?: number;
  policyCount?: number;
  checks?: VendorComplianceCheck[];
};

type VendorComplianceArtifactData = { type: string; data: unknown };
type VendorComplianceArtifactRef = { messageId: Id<"threadMessages">; index: number };
type ToolArtifactData = { type: string; data: unknown };
type MailboxArtifactRef = { messageId: Id<"threadMessages">; index: number };

function normalizeVendorComplianceRows(data: unknown): VendorComplianceRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      vendorOrgId: typeof row.vendorOrgId === "string" ? row.vendorOrgId : undefined,
      name: typeof row.name === "string" ? row.name : "Vendor",
      status: typeof row.status === "string" ? row.status : undefined,
      requirementCount: typeof row.requirementCount === "number" ? row.requirementCount : undefined,
      policyCount: typeof row.policyCount === "number" ? row.policyCount : undefined,
      checks: Array.isArray(row.checks)
        ? row.checks
            .filter((check): check is Record<string, unknown> => !!check && typeof check === "object")
            .map((check) => ({
              requirementId: typeof check.requirementId === "string" ? check.requirementId : undefined,
              title: typeof check.title === "string" ? check.title : "Requirement",
              status: typeof check.status === "string" ? check.status : undefined,
              requiredLimit: typeof check.requiredLimit === "string" ? check.requiredLimit : undefined,
              expiresAt: typeof check.expiresAt === "string" ? check.expiresAt : undefined,
              daysUntilExpiration:
                typeof check.daysUntilExpiration === "number" ? check.daysUntilExpiration : undefined,
              notes: typeof check.notes === "string" ? check.notes : undefined,
              matchedPolicy:
                check.matchedPolicy && typeof check.matchedPolicy === "object"
                  ? (check.matchedPolicy as VendorComplianceCheck["matchedPolicy"])
                  : undefined,
            }))
        : [],
    }));
}

function vendorStatusLabel(status?: string) {
  switch (status) {
    case "compliant":
      return "Compliant";
    case "waiting_on_policies":
      return "Waiting on policies";
    case "non_compliant":
      return "Non-compliant";
    default:
      return status?.replace(/_/g, " ") ?? "Vendor compliance";
  }
}

function checkStatusMeta(status?: string) {
  switch (status) {
    case "met":
      return {
        label: "Meets requirement",
        icon: Check,
        className: "border-success/20 bg-success/10 text-success/75",
      };
    case "expiring_soon":
      return {
        label: "Expiring soon",
        icon: Clock,
        className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
      };
    case "expired":
      return {
        label: "Expired",
        icon: AlertTriangle,
        className: "border-red-500/20 bg-red-500/10 text-red-400",
      };
    case "missing":
    case "needs_review":
    default:
      return {
        label: status === "needs_review" ? "Needs review" : "Not met",
        icon: X,
        className: "border-red-500/20 bg-red-500/10 text-red-400",
      };
  }
}

function formatLimitAmount(value?: number) {
  if (typeof value !== "number") return undefined;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function VendorComplianceChecklist({ rows }: { rows: VendorComplianceRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row, rowIndex) => {
        const checks = row.checks ?? [];
        const openChecks = checks.filter((check) => check.status !== "met").length;
        const metChecks = checks.filter((check) => check.status === "met").length;
        const requirementCount = row.requirementCount ?? checks.length;
        const policyText = typeof row.policyCount === "number"
          ? row.policyCount === 0
            ? "no policies"
            : `${row.policyCount} polic${row.policyCount === 1 ? "y" : "ies"}`
          : null;
        return (
          <section key={`${row.vendorOrgId ?? row.name ?? "vendor"}-${rowIndex}`} className="rounded-md border border-foreground/8 bg-card">
            <div className="border-b border-foreground/6 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 truncate text-[13px] font-medium text-foreground">
                      {row.name ?? "Vendor"}
                    </h3>
                    <Badge variant="outline" className="h-5 border-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground/60">
                      {vendorStatusLabel(row.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground/45">
                    {metChecks}/{requirementCount} met{openChecks > 0 ? ` · ${openChecks} open` : ""}
                    {policyText ? ` · ${policyText}` : ""}
                  </p>
                </div>
                {row.vendorOrgId ? (
                  <Link
                    href={`/connect/vendors/${row.vendorOrgId}/policies`}
                    className="shrink-0 rounded-full border border-foreground/8 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/14 hover:text-foreground"
                  >
                    View vendor
                  </Link>
                ) : null}
              </div>
            </div>
            {checks.length > 0 ? (
              <div className="divide-y divide-foreground/[0.05]">
                {checks.map((check, checkIndex) => {
                  const meta = checkStatusMeta(check.status);
                  const StatusIcon = meta.icon;
                  const policy = check.matchedPolicy;
                  const detectedLimit = formatLimitAmount(policy?.detectedLimitAmount);
                  return (
                    <div key={`${check.requirementId ?? check.title ?? "check"}-${checkIndex}`} className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/85">
                          {check.title ?? "Requirement"}
                        </span>
                        <Badge variant="outline" className={`h-5 gap-1 px-1.5 text-[10px] font-medium ${meta.className}`}>
                          <StatusIcon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/55">
                        {check.requiredLimit ? <span>Required: {check.requiredLimit}</span> : null}
                        {policy?.coverageLimit ? <span>Coverage: {policy.coverageLimit}</span> : null}
                        {detectedLimit ? <span>Detected: {detectedLimit}</span> : null}
                        {policy?.expirationDate ? <span>Expires: {policy.expirationDate}</span> : null}
                        {policy?.insuredName ? <span>Insured: {policy.insuredName}</span> : null}
                      </div>
                      {policy?.carrier || policy?.policyNumber || policy?.coverageName ? (
                        <p className="mt-1 truncate text-[11px] text-muted-foreground/40">
                          {[policy.carrier, policy.policyNumber, policy.coverageName].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {check.notes ? (
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground/65">
                          {check.notes}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function VendorComplianceSummaryCard({
  artifact,
  onOpen,
  isOpen,
}: {
  artifact: VendorComplianceArtifactData;
  onOpen?: () => void;
  isOpen?: boolean;
}) {
  if (artifact.type !== "vendor_compliance") return null;
  const rows = normalizeVendorComplianceRows(artifact.data);
  if (rows.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mt-4 w-full max-w-3xl overflow-hidden rounded-md border bg-card text-left transition-colors ${
        isOpen ? "border-primary/35" : "border-foreground/8 hover:border-foreground/14"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2.5">
        <span className="truncate text-[13px] font-medium text-foreground/85">
          Vendor compliance checks
        </span>
        <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground/55">
          {rows.length} vendor{rows.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="space-y-1.5 px-3 py-3">
        {rows.slice(0, 3).map((row, index) => {
          const checks = row.checks ?? [];
          const openChecks = checks.filter((check) => check.status !== "met").length;
          const metChecks = checks.filter((check) => check.status === "met").length;
          const requirementCount = row.requirementCount ?? checks.length;
          const policyText = typeof row.policyCount === "number"
            ? row.policyCount === 0
              ? "no policies"
              : `${row.policyCount} polic${row.policyCount === 1 ? "y" : "ies"}`
            : null;
          return (
            <div key={`${row.vendorOrgId ?? row.name ?? "vendor"}-${index}`} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/75">{row.name ?? "Vendor"}</span>
              <span className="shrink-0 text-muted-foreground/45">
                {metChecks}/{requirementCount} met{openChecks > 0 ? ` · ${openChecks} open` : ""}
                {policyText ? ` · ${policyText}` : ""}
              </span>
            </div>
          );
        })}
        {rows.length > 3 ? (
          <p className="text-[11px] text-muted-foreground/40">
            +{rows.length - 3} more vendor{rows.length - 3 === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function VendorComplianceSidebar({
  artifact,
  onClose,
}: {
  artifact: VendorComplianceArtifactData;
  onClose: () => void;
}) {
  const rows = normalizeVendorComplianceRows(artifact.data);
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-body-sm font-semibold text-foreground">Vendor compliance checks</h2>
          <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground/55">
            {rows.length} vendor{rows.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close vendor compliance checks">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <VendorComplianceChecklist rows={rows} />
      </div>
    </aside>
  );
}

function VendorComplianceArtifacts({
  messageId,
  artifacts,
  openArtifactRef,
  onOpenArtifact,
}: {
  messageId: Id<"threadMessages">;
  artifacts?: VendorComplianceArtifactData[];
  openArtifactRef?: VendorComplianceArtifactRef | null;
  onOpenArtifact?: (ref: VendorComplianceArtifactRef) => void;
}) {
  const vendorArtifacts = artifacts?.filter((artifact) => artifact.type === "vendor_compliance") ?? [];
  if (vendorArtifacts.length === 0) return null;
  return (
    <div className="space-y-3">
      {vendorArtifacts.map((artifact, index) => (
        <VendorComplianceSummaryCard
          key={`vendor-compliance-${index}`}
          artifact={artifact}
          isOpen={openArtifactRef?.messageId === messageId && openArtifactRef.index === index}
          onOpen={() => onOpenArtifact?.({ messageId, index })}
        />
      ))}
    </div>
  );
}

function normalizeMailboxTask(data: unknown): {
  status?: string;
  summary?: string;
  steps: string[];
  text?: string;
  toolCalls: string[];
  searches: Array<{
    accountEmail?: string;
    mailbox: string;
    query?: string;
    dateFrom?: string;
    dateTo?: string;
    resultCount: number;
    errorCount: number;
    identified: Array<{
      subject: string;
      from?: string;
      date?: string;
      attachmentCount?: number;
    }>;
  }>;
  emails: Array<{
    emailRef?: string;
    mailbox?: string;
    accountEmail?: string;
    subject: string;
    from?: string;
    date?: string;
    reason?: string;
    attachments: Array<{
      filename: string;
      contentType?: string;
      size?: number;
      reason?: string;
    }>;
  }>;
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { steps: [], toolCalls: [], searches: [], emails: [] };
  }
  const record = data as Record<string, unknown>;
  const plan =
    record.plan && typeof record.plan === "object" && !Array.isArray(record.plan)
      ? (record.plan as Record<string, unknown>)
      : undefined;
  const steps = Array.isArray(plan?.steps)
    ? plan.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
    : [];
  const toolCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls.filter((toolCall): toolCall is string => typeof toolCall === "string" && toolCall.trim().length > 0)
    : [];
  const searches = Array.isArray(record.searches)
    ? record.searches
        .filter((search): search is Record<string, unknown> => !!search && typeof search === "object" && !Array.isArray(search))
        .map((search) => ({
          accountEmail: typeof search.accountEmail === "string" ? search.accountEmail : undefined,
          mailbox: typeof search.mailbox === "string" ? search.mailbox : "INBOX",
          query: typeof search.query === "string" ? search.query : undefined,
          dateFrom: typeof search.dateFrom === "string" ? search.dateFrom : undefined,
          dateTo: typeof search.dateTo === "string" ? search.dateTo : undefined,
          resultCount: typeof search.resultCount === "number" ? search.resultCount : 0,
          errorCount: typeof search.errorCount === "number" ? search.errorCount : 0,
          identified: Array.isArray(search.identified)
            ? search.identified
                .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
                .map((item) => ({
                  subject: typeof item.subject === "string" ? item.subject : "(no subject)",
                  from: typeof item.from === "string" ? item.from : undefined,
                  date: typeof item.date === "string" ? item.date : undefined,
                  attachmentCount: typeof item.attachmentCount === "number" ? item.attachmentCount : undefined,
                }))
            : [],
        }))
    : [];
  const evidence =
    record.evidence && typeof record.evidence === "object" && !Array.isArray(record.evidence)
      ? (record.evidence as Record<string, unknown>)
      : undefined;
  const emails = Array.isArray(evidence?.emails)
    ? evidence.emails
        .filter((email): email is Record<string, unknown> => !!email && typeof email === "object" && !Array.isArray(email))
        .map((email) => ({
          emailRef: typeof email.emailRef === "string" ? email.emailRef : undefined,
          mailbox: typeof email.mailbox === "string" ? email.mailbox : undefined,
          accountEmail: typeof email.accountEmail === "string" ? email.accountEmail : undefined,
          subject: typeof email.subject === "string" ? email.subject : "(no subject)",
          from: typeof email.from === "string" ? email.from : undefined,
          date: typeof email.date === "string" ? email.date : undefined,
          reason: typeof email.reason === "string" ? email.reason : undefined,
          attachments: Array.isArray(email.attachments)
            ? email.attachments
                .filter((attachment): attachment is Record<string, unknown> => !!attachment && typeof attachment === "object" && !Array.isArray(attachment))
                .map((attachment) => ({
                  filename: typeof attachment.filename === "string" ? attachment.filename : "Attachment",
                  contentType: typeof attachment.contentType === "string" ? attachment.contentType : undefined,
                  size: typeof attachment.size === "number" ? attachment.size : undefined,
                  reason: typeof attachment.reason === "string" ? attachment.reason : undefined,
                }))
            : [],
        }))
    : [];
  return {
    status: typeof record.status === "string" ? record.status : undefined,
    summary: typeof plan?.summary === "string" ? plan.summary : undefined,
    steps,
    text: typeof record.text === "string" ? record.text : undefined,
    toolCalls,
    searches,
    emails,
  };
}

function formatAttachmentSize(size?: number) {
  if (typeof size !== "number") return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type MailboxTaskEmail = ReturnType<typeof normalizeMailboxTask>["emails"][number];

function isMailboxPdfAttachment(attachment: MailboxTaskEmail["attachments"][number]) {
  const name = attachment.filename.toLowerCase();
  const type = attachment.contentType?.toLowerCase() ?? "";
  return type.includes("pdf") || name.endsWith(".pdf");
}

function isMailboxRequirementAttachment(attachment: MailboxTaskEmail["attachments"][number]) {
  const name = attachment.filename.toLowerCase();
  const type = attachment.contentType?.toLowerCase() ?? "";
  return (
    type.includes("pdf") ||
    type.includes("wordprocessingml") ||
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("csv") ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  );
}

function totalCreatedRequirements(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return 0;
  const imports = (result as { imports?: unknown }).imports;
  if (!Array.isArray(imports)) return 0;
  return imports.reduce((total, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return total;
    const createdCount = (item as { createdCount?: unknown }).createdCount;
    return total + (typeof createdCount === "number" ? createdCount : 0);
  }, 0);
}

function MailboxSearchAudit({ searches }: { searches: ReturnType<typeof normalizeMailboxTask>["searches"] }) {
  if (searches.length === 0) return null;
  const totalMatches = searches.reduce((total, search) => total + search.resultCount, 0);
  const totalErrors = searches.reduce((total, search) => total + search.errorCount, 0);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/35">
          Search audit
        </p>
        <span className="text-[11px] text-muted-foreground/40">
          {searches.length} search{searches.length === 1 ? "" : "es"} · {totalMatches} match{totalMatches === 1 ? "" : "es"}{totalErrors ? ` · ${totalErrors} error${totalErrors === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div className="space-y-1.5">
        {searches.map((search, index) => {
          const windowText = [search.dateFrom, search.dateTo].filter(Boolean).join(" to ");
          return (
            <div key={`${search.accountEmail ?? "account"}-${search.mailbox}-${search.query ?? "all"}-${index}`} className="rounded-md border border-foreground/8 bg-foreground/[0.035] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/55">
                <Badge variant="outline" className="h-5 border-foreground/8 px-1.5 text-[10px] font-medium text-muted-foreground/55">
                  {search.accountEmail ?? "Mailbox"}
                </Badge>
                <span>{search.mailbox}</span>
                {windowText ? <span>· {windowText}</span> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-[12px] font-medium text-foreground/80">
                  {search.query ? `"${search.query}"` : "All recent mail"}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground/45">
                  {search.resultCount} match{search.resultCount === 1 ? "" : "es"}
                </span>
              </div>
              {search.identified.length > 0 ? (
                <div className="mt-1.5 space-y-1">
                  {search.identified.map((item, itemIndex) => (
                    <div key={`${item.subject}-${itemIndex}`} className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground/55">
                      <MailIcon className="h-3 w-3 shrink-0 text-muted-foreground/35" />
                      <span className="min-w-0 flex-1 truncate">{item.subject}</span>
                      {item.attachmentCount ? (
                        <span className="shrink-0 text-muted-foreground/35">{item.attachmentCount} att.</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MailboxTaskSummaryCard({
  artifact,
  orgId,
  threadId,
  displayName,
  mode = "summary",
  onOpen,
  isSelected = false,
  flat = false,
}: {
  artifact: ToolArtifactData;
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  displayName: string;
  mode?: "summary" | "detail";
  onOpen?: () => void;
  isSelected?: boolean;
  flat?: boolean;
}) {
  const importPolicyAttachments = useAction(api.actions.connectedEmail.importPolicyAttachments);
  const importRequirementAttachments = useAction(api.actions.connectedEmail.importRequirementAttachments);
  const saveAttachmentsToThread = useAction(api.actions.connectedEmail.saveAttachmentsToThread);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (artifact.type !== "mailbox_task") return null;
  const task = normalizeMailboxTask(artifact.data);
  if (!task.summary && task.steps.length === 0 && task.toolCalls.length === 0 && task.searches.length === 0) return null;
  const isRunning = task.status === "running";

  async function handlePolicyImport(email: MailboxTaskEmail, index: number) {
    if (!email.emailRef) return;
    const filenames = email.attachments.filter(isMailboxPdfAttachment).map((attachment) => attachment.filename);
    if (filenames.length === 0) {
      toast.error("No PDF attachments found");
      return;
    }
    const key = `policy-${index}`;
    setBusyKey(key);
    try {
      const result = await importPolicyAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames,
      }) as { status?: string; files?: unknown[] };
      if (result.status === "no_pdf_attachments") {
        toast.error("No PDF attachments found");
      } else {
        toast.success(`Started policy/quote import for ${result.files?.length ?? filenames.length} file${filenames.length === 1 ? "" : "s"}`);
      }
    } catch {
      toast.error("Failed to import policy/quote");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveToThread(email: MailboxTaskEmail, index: number) {
    if (!threadId || !email.emailRef) return;
    const filenames = email.attachments.map((attachment) => attachment.filename);
    if (filenames.length === 0) {
      toast.error("No attachments found");
      return;
    }
    const key = `save-${index}`;
    setBusyKey(key);
    try {
      const result = await saveAttachmentsToThread({
        orgId,
        threadId,
        emailRef: email.emailRef,
        filenames,
      }) as { status?: string; attachments?: unknown[]; skippedDuplicateFilenames?: string[] };
      if (result.status === "no_saveable_attachments") {
        toast.error("No saveable attachments found");
      } else if (result.status === "duplicate_attachments") {
        toast.info("Those documents are already saved to this thread");
      } else {
        toast.success(`Saved ${result.attachments?.length ?? filenames.length} document${filenames.length === 1 ? "" : "s"} to this thread`);
      }
    } catch {
      toast.error("Failed to save documents to thread");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRequirementImport(
    email: MailboxTaskEmail,
    index: number,
    appliesTo: "vendors" | "own_org",
  ) {
    if (!email.emailRef) return;
    const filenames = email.attachments
      .filter(isMailboxRequirementAttachment)
      .map((attachment) => attachment.filename);
    const key = `${appliesTo}-${index}`;
    setBusyKey(key);
    try {
      const result = await importRequirementAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames: filenames.length > 0 ? filenames : undefined,
        includeEmailBody: true,
        sourceType: appliesTo === "vendors" ? "vendor_requirements" : "other",
        appliesTo,
      });
      const createdCount = totalCreatedRequirements(result);
      if ((result as { status?: string })?.status === "no_requirement_sources") {
        toast.error("No requirement source text found");
      } else {
        toast.success(
          createdCount > 0
            ? `Created ${createdCount} requirement${createdCount === 1 ? "" : "s"}`
            : "Requirement import finished",
        );
      }
    } catch {
      toast.error("Failed to create requirements");
    } finally {
      setBusyKey(null);
    }
  }

  const totalMatches = task.searches.reduce((total, search) => total + search.resultCount, 0);
  const meta = [
    task.searches.length > 0 ? `${task.searches.length} searches` : undefined,
    task.searches.length > 0 ? `${totalMatches} matches` : undefined,
    task.emails.length > 0 ? `${task.emails.length} emails` : undefined,
  ].filter(Boolean).join(" · ");

  if (mode === "summary") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border bg-foreground/[0.025] px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/55 transition-colors ${
          isSelected ? "border-foreground/18 bg-foreground/[0.04]" : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.04]"
        }`}
      >
        {isRunning ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary-light/70" /> : <MailIcon className="h-3 w-3 shrink-0 text-muted-foreground/45" />}
        <span className="truncate">{displayName}</span>
      </button>
    );
  }

  return (
    <div className={flat ? "w-full" : "w-full overflow-hidden rounded-md border border-foreground/8 bg-card"}>
      <div className={flat ? "hidden" : "flex w-full items-center justify-between gap-3 border-b border-foreground/6 px-3 py-2.5 text-left"}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailIcon className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-foreground/85">
              {displayName}
            </span>
            {meta ? (
              <span className="block truncate text-[11px] text-muted-foreground/40">
                {meta}
              </span>
            ) : null}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="h-5 border-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground/55">
            {isRunning ? "Running" : "Background agent"}
          </Badge>
        </span>
      </div>
      <div className={flat ? "space-y-4" : "space-y-3 px-3 py-3"}>
        {task.summary ? (
          <p className="text-[12px] leading-5 text-muted-foreground/75">
            {task.summary}
          </p>
        ) : null}
        {task.steps.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/35">
              Plan
            </p>
            <ol className="space-y-1.5">
              {task.steps.map((step, index) => (
                <li key={`${step}-${index}`} className="flex gap-2 text-[12px] leading-5 text-muted-foreground/70">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/8 text-[10px] text-muted-foreground/50">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {task.toolCalls.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {task.toolCalls.map((toolCall, index) => (
              <Badge key={`${toolCall}-${index}`} variant="outline" className="h-5 border-foreground/8 px-1.5 text-[10px] font-medium text-muted-foreground/55">
                {scientistSurnameFor(`mailbox-tool:${toolCall}`, index)}
              </Badge>
            ))}
          </div>
        ) : null}
        <MailboxSearchAudit searches={task.searches} />
        {task.emails.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/35">
              Email context
            </p>
            <div className="space-y-2">
              {task.emails.map((email, index) => (
                <div key={`${email.emailRef ?? email.subject}-${index}`} className="rounded-md border border-foreground/6 bg-background px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/85">
                      {email.subject}
                    </span>
                    {email.accountEmail ? (
                      <Badge variant="outline" className="h-5 border-foreground/8 px-1.5 text-[10px] font-medium text-muted-foreground/50">
                        {email.accountEmail}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground/45">
                    {[email.from, email.mailbox, email.date ? dayjs(email.date).format("MMM D, YYYY h:mm A") : undefined].filter(Boolean).join(" · ")}
                  </p>
                  {email.reason ? (
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground/65">
                      {email.reason}
                    </p>
                  ) : null}
                  {email.attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {email.attachments.map((attachment, attachmentIndex) => {
                        const size = formatAttachmentSize(attachment.size);
                        return (
                          <span
                            key={`${attachment.filename}-${attachmentIndex}`}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-foreground/8 bg-foreground/[0.02] px-2 py-1 text-[11px] text-muted-foreground/65"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{attachment.filename}</span>
                            {size ? <span className="text-muted-foreground/35">{size}</span> : null}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                  {email.emailRef ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-foreground/6 pt-2">
                      {threadId && email.attachments.length > 0 ? (
                        <PillButton
                          size="compact"
                          variant="iconLabel"
                          label="Save to thread"
                          disabled={busyKey !== null}
                          onClick={() => void handleSaveToThread(email, index)}
                        >
                          {busyKey === `save-${index}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Paperclip className="h-3 w-3" />
                          )}
                        </PillButton>
                      ) : null}
                      {email.attachments.some(isMailboxPdfAttachment) ? (
                        <PillButton
                          size="compact"
                          variant="iconLabel"
                          label="Import policy/quote"
                          disabled={busyKey !== null}
                          onClick={() => void handlePolicyImport(email, index)}
                        >
                          {busyKey === `policy-${index}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                        </PillButton>
                      ) : null}
                      <PillButton
                        size="compact"
                        variant="iconLabel"
                        label="Create vendor requirements"
                        disabled={busyKey !== null}
                        onClick={() => void handleRequirementImport(email, index, "vendors")}
                      >
                        {busyKey === `vendors-${index}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ClipboardList className="h-3 w-3" />
                        )}
                      </PillButton>
                      <PillButton
                        size="compact"
                        variant="iconLabel"
                        label="Create internal requirements"
                        disabled={busyKey !== null}
                        onClick={() => void handleRequirementImport(email, index, "own_org")}
                      >
                        {busyKey === `own_org-${index}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ClipboardList className="h-3 w-3" />
                        )}
                      </PillButton>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MailboxTaskSidebar({
  artifact,
  orgId,
  threadId,
  onClose,
}: {
  artifact: ToolArtifactData;
  orgId: Id<"organizations">;
  threadId: Id<"threads">;
  onClose: () => void;
}) {
  const task = normalizeMailboxTask(artifact.data);
  const isRunning = task.status === "running";

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-foreground/8 bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-body-sm font-semibold text-foreground">Mailbox search</h2>
          <Badge variant="outline" className="h-5 shrink-0 border-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground/55">
            {isRunning ? "Running" : "Background agent"}
          </Badge>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close mailbox search">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <MailboxTaskSummaryCard
          artifact={artifact}
          orgId={orgId}
          threadId={threadId}
          displayName="Mailbox search"
          mode="detail"
          flat
        />
      </div>
    </aside>
  );
}

function SubagentActivityPanel({
  toolCalls,
}: {
  toolCalls: { name: string; input?: string; output?: string }[];
}) {
  const genericSubagentCalls = toolCalls.filter((toolCall) => toolCall.name !== "coordinate_mailbox_task");
  if (genericSubagentCalls.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-1.5">
      {genericSubagentCalls.map((toolCall, index) => {
        const displayName = scientistSurnameFor(
          `${toolCall.name}:${toolCall.input ?? ""}:${toolCall.output ?? ""}`,
          index,
        );
        return (
          <ToolCallCard
            key={`subagent-${toolCall.name}-${index}`}
            toolCall={toolCall}
            index={index}
            showOutput
            displayName={displayName}
          />
        );
      })}
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
                      <summary className="text-label-sm font-medium text-foreground transition-colors hover:text-muted-foreground">
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
      const left = Math.max(0, Math.ceil((pendingEmail!.scheduledSendTime - dayjs().valueOf()) / 1000));
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
        className="text-label-sm font-medium text-red-500 hover:text-red-600 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

function AgentProcessingActivity({
  label,
  isStale,
  backgroundProcessCount,
  onOpenBackgroundProcess,
}: {
  label?: string | null;
  isStale?: boolean;
  backgroundProcessCount: number;
  onOpenBackgroundProcess?: () => void;
}) {
  const status = label ?? (isStale ? "Taking longer than expected" : "Thinking");
  const backgroundProcessContent = (
    <>
      <Loader2 className="h-3 w-3 animate-spin text-primary-light/70" />
      {backgroundProcessCount} background agent{backgroundProcessCount === 1 ? "" : "s"} running
    </>
  );

  return (
    <div className="mt-2 flex max-w-full flex-wrap items-center gap-2">
      <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-foreground/8 bg-foreground/[0.025] px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/60">
        <LogoIcon size={12} static className="h-3 w-3 shrink-0 animate-spin text-primary-light/70 [animation-duration:1.8s]" />
        <span className="truncate">{status}</span>
      </span>
      {backgroundProcessCount > 0 && onOpenBackgroundProcess ? (
        <button
          type="button"
          onClick={onOpenBackgroundProcess}
          className="inline-flex items-center gap-1.5 rounded-full border border-foreground/8 bg-foreground/[0.025] px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/55 transition-colors hover:border-foreground/15 hover:bg-foreground/[0.04]"
        >
          {backgroundProcessContent}
        </button>
      ) : backgroundProcessCount > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/8 bg-foreground/[0.025] px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/55">
          {backgroundProcessContent}
        </span>
      ) : null}
    </div>
  );
}

/* ── Unified message bubble ── */
export function UnifiedMessageBubble({
  msg,
  relatedEmailMessage,
  viewerId,
  viewerEmail,
  isFirstUserMessage,
  threadContext,
  brokerPerspective,
  agentBranding,
  collapseEmailMessages,
  onOpenEmail,
  openEmailMessageId,
  onOpenPolicyChange,
  openPolicyChangeCaseId,
  onOpenVendorCompliance,
  openVendorComplianceArtifactRef,
  onOpenMailboxArtifact,
  openMailboxArtifactRef,
}: {
  msg: ThreadMessage;
  relatedEmailMessage?: ThreadMessage;
  viewerId?: string;
  viewerEmail?: string;
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
  onOpenVendorCompliance?: (ref: VendorComplianceArtifactRef) => void;
  openVendorComplianceArtifactRef?: VendorComplianceArtifactRef | null;
  onOpenMailboxArtifact?: (ref: MailboxArtifactRef) => void;
  openMailboxArtifactRef?: MailboxArtifactRef | null;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState(false);
  const [showSubagentActivity, setShowSubagentActivity] = useState(false);
  const [now] = useState(() => dayjs().valueOf());
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
    const mailboxArtifacts = msg.toolArtifacts?.filter((artifact) => artifact.type === "mailbox_task") ?? [];
    const runningMailboxArtifacts = mailboxArtifacts.filter((artifact) => normalizeMailboxTask(artifact.data).status === "running");
    const backgroundProcessCount = runningMailboxArtifacts.length || mailboxArtifacts.length;

    return (
      <div className="flex items-start gap-2.5 max-w-lg">
        <div className="w-7 h-7 rounded-full bg-primary-light/15 flex items-center justify-center shrink-0 overflow-hidden">
          {agentBranding?.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agentBranding.iconUrl} alt="" className="w-7 h-7 object-cover" />
          ) : (
            <LogoIcon size={14} static className="text-primary-light" />
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

          {displayContent ? (
            <div className="rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 mt-1">
              <ProseMarkdown gfm breaks className={MARKDOWN_STYLES} components={markdownComponents}>{displayContent}</ProseMarkdown>
            </div>
          ) : null}
          <AgentProcessingActivity
            label={toolLabel}
            isStale={isStale}
            backgroundProcessCount={backgroundProcessCount}
            onOpenBackgroundProcess={
              mailboxArtifacts.length > 0
                ? () => onOpenMailboxArtifact?.({ messageId: msg._id, index: 0 })
                : undefined
            }
          />
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
  if (msg.status === "error" && msg.role !== "agent") {
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
    const isError = msg.status === "error";
    const fixedContent = msg.content?.trim()
      ? msg.content
      : isError
        ? (msg.error ?? "An error occurred processing this message.")
        : msg.content;

    // Cited sections from tool results (stored on message by processThreadChat)
    const citedSections = msg.citedSections;
    const citedCoverageNames = msg.citedCoverageNames;
    const toolCalls = msg.toolCalls?.length
      ? msg.toolCalls
      : (msg.usedTools ?? []).map((name) => ({ name }));
    const subagentToolCalls = toolCalls.filter((toolCall) => SUBAGENT_TOOL_NAMES.has(toolCall.name));
    const regularToolCalls = toolCalls.filter((toolCall) => !SUBAGENT_TOOL_NAMES.has(toolCall.name));
    const mailboxArtifacts = msg.toolArtifacts?.filter((artifact) => artifact.type === "mailbox_task") ?? [];
    const genericSubagentToolCalls = subagentToolCalls.filter(
      (toolCall) => toolCall.name !== "coordinate_mailbox_task",
    );
    const subagentActivityCount = genericSubagentToolCalls.length;
    const savedAttachmentMessage = isSavedThreadAttachmentMessage(msg);

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
              <LogoIcon size={14} static className="text-primary-light" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`flex items-center gap-2 mb-1 ${brokerPerspective ? "justify-end" : ""}`}>
              <div className="flex items-center gap-2 min-w-0">
                <p className="shrink-0 text-label-sm font-medium text-muted-foreground/50">{agentBranding?.name ?? "Glass"}</p>
                {msg.channel === "email" && !collapseEmailMessages ? (
                  <EmailRecipientMeta
                    toAddresses={msg.toAddresses}
                    ccAddresses={msg.ccAddresses}
                  />
                ) : null}
                {channelIcon}
                <span className="text-muted-foreground/20">·</span>
                <span className="text-label-sm text-muted-foreground/25">{time.format("MMM D, h:mm A")}</span>
              </div>
            </div>
            {collapseEmailMessages && msg.channel === "email" ? (
              <EmailSummaryCard message={msg} onOpen={onOpenEmail} isOpen={openEmailMessageId === msg._id} />
            ) : (
              <>
                {/* Reasoning — collapsed above the response */}
                <CollapsibleReasoning
                  reasoning={msg.reasoning ?? ""}
                  isStreaming={false}
                />
                <div className={`rounded-lg border px-3.5 py-2.5 ${msg.reasoning ? "mt-1" : ""} ${
                  isError
                    ? "border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400"
                    : "border-foreground/6 bg-popover"
                }`}>
                  <ProseMarkdown gfm breaks className={MARKDOWN_STYLES} components={markdownComponents}>{fixedContent}</ProseMarkdown>
                  {savedAttachmentMessage ? (
                    <div className="mt-2 flex flex-wrap gap-2 border-t border-foreground/6 pt-2">
                      {msg.attachments?.map((att, i) => (
                        <ThreadAttachmentChip key={i} attachment={att} threadId={msg.threadId} />
                      ))}
                    </div>
                  ) : null}
                </div>
                <MessageFooterActions
                  refs={allRefs}
                  citedSections={citedSections}
                  citedCoverageNames={citedCoverageNames}
                  toolCalls={regularToolCalls}
                  subagentActivityCount={subagentActivityCount}
                  mailboxArtifacts={mailboxArtifacts}
                  messageId={msg._id}
                  onOpenMailboxArtifact={onOpenMailboxArtifact}
                  openMailboxArtifactRef={openMailboxArtifactRef}
                  copyContent={fixedContent}
                  retryMessageId={msg.channel === "chat" || msg.channel === "imessage" ? msg._id : undefined}
                  showToolCalls={showToolCalls}
                  onToggleToolCalls={() => setShowToolCalls((value) => !value)}
                  showSubagentActivity={showSubagentActivity}
                  onToggleSubagentActivity={() => setShowSubagentActivity((value) => !value)}
                  rightAligned={brokerPerspective}
                />
                <VendorComplianceArtifacts
                  messageId={msg._id}
                  artifacts={msg.toolArtifacts}
                  openArtifactRef={openVendorComplianceArtifactRef}
                  onOpenArtifact={onOpenVendorCompliance}
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
                {regularToolCalls.length > 0 && showToolCalls && <ToolCallPanel toolCalls={regularToolCalls} />}
                {subagentActivityCount > 0 && showSubagentActivity && (
                  <SubagentActivityPanel
                    toolCalls={subagentToolCalls}
                  />
                )}
              </>
            )}
            {!savedAttachmentMessage && !(collapseEmailMessages && msg.channel === "email") && msg.attachments && msg.attachments.length > 0 && (
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
          <p className="shrink-0 text-label-sm font-medium text-muted-foreground/50">{displayName}</p>
          {isEmail && !collapseEmailMessages ? (
            <EmailRecipientMeta
              toAddresses={msg.toAddresses}
              ccAddresses={msg.ccAddresses}
            />
          ) : null}
          {channelIcon}
          <span className="text-muted-foreground/20">·</span>
          <span className="text-label-sm text-muted-foreground/25">{time.format("MMM D, h:mm A")}</span>
        </div>
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
                className="mt-1.5 text-label-sm text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
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

function TryAgainMessageButton({ messageId }: { messageId: Id<"threadMessages"> }) {
  const retry = useMutation(api.threads.retryAgentResponse);
  const [retrying, setRetrying] = useState(false);

  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try {
          await retry({ messageId });
        } catch {
          toast.error("Failed to retry");
        } finally {
          setRetrying(false);
        }
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground/40 transition-colors hover:border-foreground/8 hover:bg-foreground/[0.03] hover:text-foreground/70 disabled:opacity-50"
      title="Try again"
    >
      <RotateCcw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
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
      className="inline-flex items-center gap-1.5 mt-2 ml-9.5 text-label-sm text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors disabled:opacity-50"
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

function QueuedThreadMessage({
  message,
  sending,
  onSendNow,
  onCancel,
}: {
  message: PromptInputMessage;
  sending: boolean;
  onSendNow: () => void;
  onCancel: () => void;
}) {
  const preview = message.text.trim() || (message.files.length > 0 ? `${message.files.length} attachment${message.files.length === 1 ? "" : "s"}` : "Message");
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-foreground/8 bg-card px-2.5 py-2">
      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
      <p className="min-w-0 flex-1 truncate text-label-sm text-muted-foreground/55">
        Queued: <span className="text-foreground/75">{preview}</span>
      </p>
      <PillButton
        type="button"
        size="compact"
        onClick={onSendNow}
        disabled={sending}
      >
        {sending ? "Sending" : "Send now"}
      </PillButton>
      <button
        type="button"
        onClick={onCancel}
        disabled={sending}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/35 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/65 disabled:opacity-50"
        aria-label="Remove queued message"
      >
        <X className="h-3.5 w-3.5" />
      </button>
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
  const [queuedMessage, setQueuedMessage] = useState<PromptInputMessage | null>(null);
  const [sendingQueuedNow, setSendingQueuedNow] = useState(false);
  const [openEmailMessageId, setOpenEmailMessageId] = useState<Id<"threadMessages"> | null>(null);
  const [openPolicyChangeCaseId, setOpenPolicyChangeCaseId] = useState<Id<"policyChangeCases"> | null>(null);
  const [openVendorComplianceArtifactRef, setOpenVendorComplianceArtifactRef] = useState<VendorComplianceArtifactRef | null>(null);
  const [openMailboxArtifactRef, setOpenMailboxArtifactRef] = useState<MailboxArtifactRef | null>(null);
  const openEmailMessage = useMemo(
    () => messages?.find((message) => message._id === openEmailMessageId) ?? null,
    [messages, openEmailMessageId],
  );
  const openVendorComplianceArtifact = useMemo(() => {
    if (!openVendorComplianceArtifactRef) return null;
    const message = messages?.find((candidate) => candidate._id === openVendorComplianceArtifactRef.messageId);
    const artifacts = message?.toolArtifacts?.filter((artifact) => artifact.type === "vendor_compliance") ?? [];
    return artifacts[openVendorComplianceArtifactRef.index] ?? null;
  }, [messages, openVendorComplianceArtifactRef]);
  const openMailboxArtifact = useMemo(() => {
    if (!openMailboxArtifactRef) return null;
    const message = messages?.find((candidate) => candidate._id === openMailboxArtifactRef.messageId);
    const artifacts = message?.toolArtifacts?.filter((artifact) => artifact.type === "mailbox_task") ?? [];
    const artifact = artifacts[openMailboxArtifactRef.index];
    return artifact ? { artifact, orgId: message?.orgId, threadId: message?.threadId } : null;
  }, [messages, openMailboxArtifactRef]);

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
          : openVendorComplianceArtifact
            ? (
                <VendorComplianceSidebar
                  artifact={openVendorComplianceArtifact}
                  onClose={() => setOpenVendorComplianceArtifactRef(null)}
                />
              )
            : openMailboxArtifact?.artifact && openMailboxArtifact.orgId && openMailboxArtifact.threadId
              ? (
                  <MailboxTaskSidebar
                    artifact={openMailboxArtifact.artifact}
                    orgId={openMailboxArtifact.orgId}
                    threadId={openMailboxArtifact.threadId}
                    onClose={() => setOpenMailboxArtifactRef(null)}
                  />
                )
          : null,
    );
    return () => onRightPanel(null);
  }, [onRightPanel, openEmailMessage, openPolicyChangeCaseId, openVendorComplianceArtifact, openMailboxArtifact, policyChangeAccess]);

  // Scroll to bottom when messages change or thread switches
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNew = prevThreadId.current !== threadId;
    prevThreadId.current = threadId;
    if (isNew) {
      setOpenEmailMessageId(null);
      setOpenPolicyChangeCaseId(null);
      setOpenVendorComplianceArtifactRef(null);
      setOpenMailboxArtifactRef(null);
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
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(null);
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
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(null);
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
  const isAgentActive = isAgentProcessing || isAwaitingAgent;
  const isInputBusy = isSubmitting || sendingQueuedNow;
  const inputBusyLabel = "Sending";

  const sendThreadMessage = useCallback(async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text && message.files.length === 0) return;
    const referencedPolicyIds = message.references
      ?.filter((reference) => reference.kind === "policy")
      .map((reference) => reference.id as Id<"policies">);
    const referencedQuoteIds = message.references
      ?.filter((reference) => reference.kind === "quote")
      .map((reference) => reference.id as Id<"policies">);
    const referencedRequirementIds = message.references
      ?.filter((reference) => reference.kind === "requirement")
      .map((reference) => reference.id as Id<"insuranceRequirements">);
    const referencedMailboxIds = message.references
      ?.filter((reference) => reference.kind === "mailbox")
      .map((reference) => reference.id as Id<"connectedEmailAccounts">);

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
          referencedPolicyIds,
          referencedQuoteIds,
          referencedRequirementIds,
          referencedMailboxIds,
        });
        return;
      }

      // For text-only messages, send via Convex (processThreadChat handles the response)
      setChatError(null);
      await sendMessage({
        threadId,
        content: text,
        referencedPolicyIds,
        referencedQuoteIds,
        referencedRequirementIds,
        referencedMailboxIds,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [sendMessage, threadId, generateUploadUrl, setChatError]);

  const handleSend = useCallback(async (message: PromptInputMessage) => {
    if (isInputBusy) return;
    if (isAgentActive) {
      setQueuedMessage(message);
      return;
    }
    await sendThreadMessage(message);
  }, [isAgentActive, isInputBusy, sendThreadMessage]);

  const sendQueuedNow = useCallback(async () => {
    if (!queuedMessage || sendingQueuedNow) return;
    setSendingQueuedNow(true);
    const message = queuedMessage;
    setQueuedMessage(null);
    try {
      await sendThreadMessage(message);
    } finally {
      setSendingQueuedNow(false);
    }
  }, [queuedMessage, sendThreadMessage, sendingQueuedNow]);

  useEffect(() => {
    if (!queuedMessage || isAgentActive || isSubmitting || sendingQueuedNow) return;
    const message = queuedMessage;
    const timeout = window.setTimeout(() => {
      setQueuedMessage(null);
      void sendThreadMessage(message);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isAgentActive, isSubmitting, queuedMessage, sendThreadMessage, sendingQueuedNow]);

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
            const threadMessages = messages ?? [];
            const firstUserIdx = threadMessages.findIndex((m) => m.role === "user");
            const attachedEmailMessageIds = new Set<string>();
            const hiddenStatusMessageIds = new Set<string>();
            const relatedEmailByMessageId = new Map<string, ThreadMessage>();
            threadMessages.forEach((message, idx) => {
              if (hasLaterEmailSendCompletion(threadMessages, message, idx)) {
                hiddenStatusMessageIds.add(message._id);
                return;
              }
              const relatedEmailMessage = findRelatedEmailMessage(threadMessages, message, idx, attachedEmailMessageIds);
              if (relatedEmailMessage) {
                relatedEmailByMessageId.set(message._id, relatedEmailMessage);
                attachedEmailMessageIds.add(relatedEmailMessage._id);
              }
            });
            return threadMessages.map((msg, idx) => {
              if (hiddenStatusMessageIds.has(msg._id)) return null;
              if (attachedEmailMessageIds.has(msg._id)) return null;
              const isFirstUser = idx === firstUserIdx;
              const firstUserIsOwn =
                isFirstUser &&
                ((viewerId && msg.userId === viewerId) ||
                  (viewerEmail && msg.fromEmail?.toLowerCase() === viewerEmail.toLowerCase()));
              const relatedEmailMessage = relatedEmailByMessageId.get(msg._id);

              return (
                <div key={msg._id}>
                  <UnifiedMessageBubble
                    msg={msg}
                    relatedEmailMessage={relatedEmailMessage}
                    viewerId={viewerId}
                    viewerEmail={viewerEmail}
                    isFirstUserMessage={false}
                    threadContext={undefined}
                    agentBranding={agentBranding}
                    collapseEmailMessages={collapseEmailMessages}
                    onOpenEmail={(message) => {
                      setOpenPolicyChangeCaseId(null);
                      setOpenVendorComplianceArtifactRef(null);
                      setOpenMailboxArtifactRef(null);
                      setOpenEmailMessageId(message._id);
                    }}
                    openEmailMessageId={openEmailMessageId}
                    onOpenPolicyChange={(caseId) => {
                      setOpenEmailMessageId(null);
                      setOpenVendorComplianceArtifactRef(null);
                      setOpenMailboxArtifactRef(null);
                      setOpenPolicyChangeCaseId(caseId);
                    }}
                    openPolicyChangeCaseId={openPolicyChangeCaseId}
                    onOpenVendorCompliance={(ref) => {
                      setOpenEmailMessageId(null);
                      setOpenPolicyChangeCaseId(null);
                      setOpenMailboxArtifactRef(null);
                      setOpenVendorComplianceArtifactRef(ref);
                    }}
                    openVendorComplianceArtifactRef={openVendorComplianceArtifactRef}
                    onOpenMailboxArtifact={(ref) => {
                      setOpenEmailMessageId(null);
                      setOpenPolicyChangeCaseId(null);
                      setOpenVendorComplianceArtifactRef(null);
                      setOpenMailboxArtifactRef(ref);
                    }}
                    openMailboxArtifactRef={openMailboxArtifactRef}
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
        {queuedMessage ? (
          <QueuedThreadMessage
            message={queuedMessage}
            sending={sendingQueuedNow}
            onSendNow={sendQueuedNow}
            onCancel={() => setQueuedMessage(null)}
          />
        ) : null}
        <GlassPromptInput
          ref={chatInputRef}
          onSubmit={handleSend}
          placeholder="Reply to this thread..."
          showAttach
          agentBranding={agentBranding}
          disabled={isInputBusy}
          status={isInputBusy ? "submitted" : undefined}
          submittedLabel={inputBusyLabel}
          orgId={thread.orgId}
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
