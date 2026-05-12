"use client";

import { use, useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModeBadge } from "@/components/mode-badge";
import { splitQuotedReply, QuotedContent } from "@/components/conversation-message";
import { toast } from "sonner";
import { Loader2, Archive, ArchiveRestore, FileText, Check, ClipboardList, Asterisk, Mail as MailIcon, MessageSquare, Apple, Paperclip, Download, Copy, Lock, RotateCcw, X } from "lucide-react";
import { EditableBreadcrumbTitle } from "@/components/editable-breadcrumb-title";
import { usePdf } from "@/components/pdf-context";
import { usePresence } from "@/hooks/use-presence";
import { ContextReferenceCard, PolicyReferenceCard, ReferenceCardStrip } from "@/components/context-reference-card";
import { ChatInputOverlay, GlassPromptInput, type GlassPromptInputHandle } from "@/components/glass-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { CollapsibleReasoning } from "@/components/collapsible-reasoning";
import Link from "next/link";
import { ProseMarkdown } from "@/components/prose-markdown";
import { PretextText } from "@/components/pretext-text";
import dayjs from "dayjs";
import { NewChatEmptyState } from "@/components/new-chat-empty-state";

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
  status?: "processing" | "error" | "pending_send";
  error?: string;
  pendingEmailId?: Id<"pendingEmails">;
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
  const [isOpen, setIsOpen] = useState(true);
  const displayName = TOOL_DISPLAY_NAMES[toolCall.name] ?? toolCall.name;

  return (
    <div className="overflow-hidden rounded-lg border border-foreground/8 bg-card shadow-sm shadow-black/[0.02]">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className="h-auto w-full justify-between rounded-none px-3 py-2 text-left hover:bg-foreground/[0.03] dark:hover:bg-foreground/[0.06]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-foreground/85">{displayName}</span>
          </span>
        </span>
        <span className="ml-3 flex shrink-0 items-center gap-2">
          <Badge className="h-5 gap-1 border-success/20 bg-success/10 px-1.5 text-[11px] font-medium text-success" variant="outline">
            Completed
          </Badge>
          <span className="text-[11px] font-medium text-muted-foreground/45">
            {isOpen ? "Hide" : "Show"}
          </span>
        </span>
      </Button>
      {isOpen && (
        <div className="border-t border-foreground/6 px-3 pb-3 pt-2">
          <p className="mb-1.5 text-label-sm font-medium text-muted-foreground/45">
            Parameters
          </p>
          <pre className="max-h-64 overflow-auto rounded-md border border-foreground/8 bg-foreground/[0.025] p-3 font-mono text-[11px] leading-5 text-foreground/75 shadow-inner shadow-black/[0.015]">
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
    <div className="mb-3 ml-0.5 space-y-2">
      {toolCalls.map((toolCall, index) => (
        <ToolCallCard key={`${toolCall.name}-${index}`} toolCall={toolCall} index={index} />
      ))}
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
  const isEmail = thread.originChannel === "email";

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
      <ModeBadge mode={isEmail ? "direct" : "chat"} />
      <div className="w-px h-4 bg-foreground/10" />
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
}: {
  message: ThreadMessage;
  onOpen?: (message: ThreadMessage) => void;
}) {
  const recipients = message.toAddresses?.length
    ? message.toAddresses.join(", ")
    : message.fromEmail ?? "Email";
  const preview = message.subject || message.content.split(/\n+/).find((line) => line.trim()) || "Email";

  return (
    <button
      type="button"
      onClick={() => onOpen?.(message)}
      className="inline-flex max-w-[320px] items-center gap-2 rounded-md border border-foreground/8 bg-card px-2.5 py-2 text-left transition-colors hover:border-foreground/15 hover:bg-foreground/[0.03]"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-foreground/[0.04]">
        <MailIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium leading-4 text-muted-foreground/45">
          Email {message.role === "agent" ? "sent" : "received"}
        </span>
        <span className="block truncate text-[12px] leading-4 text-foreground/80">{preview}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground/40">{recipients}</span>
      </span>
    </button>
  );
}

function EmailThreadSidebar({
  message,
  onClose,
}: {
  message: ThreadMessage | null;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-foreground/10 bg-background shadow-xl shadow-black/10">
      <div className="flex items-start justify-between gap-3 border-b border-foreground/8 px-4 py-3">
        <div className="min-w-0">
          <p className="text-label-sm font-medium text-muted-foreground/45">Email</p>
          <h2 className="truncate text-body-sm font-semibold text-foreground">
            {message.subject || (message.role === "agent" ? "Sent email" : "Received email")}
          </h2>
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close email">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <div className="space-y-2 border-b border-foreground/8 px-4 py-3 text-label-sm text-muted-foreground/55">
        {message.fromEmail && <p><span className="text-muted-foreground/35">From:</span> {message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}</p>}
        {message.toAddresses?.length ? <p><span className="text-muted-foreground/35">To:</span> {message.toAddresses.join(", ")}</p> : null}
        {message.ccAddresses?.length ? <p><span className="text-muted-foreground/35">CC:</span> {message.ccAddresses.join(", ")}</p> : null}
        {message.bccAddresses?.length ? <p><span className="text-muted-foreground/35">BCC:</span> {message.bccAddresses.join(", ")}</p> : null}
        <p><span className="text-muted-foreground/35">Time:</span> {dayjs(message._creationTime).format("MMM D, YYYY h:mm A")}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <PretextText as="div" text={message.content} whiteSpace="pre-wrap" className="text-body-sm leading-6 text-foreground/90" />
        {message.attachments?.length ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-foreground/8 pt-3">
            {message.attachments.map((att, index) => (
              <ThreadAttachmentChip key={index} attachment={att} threadId={message.threadId} />
            ))}
          </div>
        ) : null}
      </div>
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
  viewerId,
  viewerEmail,
  isMixedThread,
  isLastAgentMessage,
  isFirstUserMessage,
  threadContext,
  brokerPerspective,
  agentBranding,
  collapseEmailMessages,
  onOpenEmail,
}: {
  msg: ThreadMessage;
  viewerId?: string;
  viewerEmail?: string;
  isMixedThread?: boolean;
  isLastAgentMessage?: boolean;
  isFirstUserMessage?: boolean;
  threadContext?: { pageType: string; entityId?: string; summary?: string };
  /** When true, render agent messages as if sent "by the broker" — right-aligned. */
  brokerPerspective?: boolean;
  /** Optional branding — when set, replaces generic "Glass" + asterisk on agent bubble. */
  agentBranding?: { name: string; iconUrl?: string | null };
  collapseEmailMessages?: boolean;
  onOpenEmail?: (message: ThreadMessage) => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState(false);
  const [now] = useState(() => Date.now());
  const time = dayjs(msg._creationTime);
  const channelIcon = msg.channel === "email"
    ? <MailIcon className="w-3 h-3 text-muted-foreground/30" />
    : msg.channel === "imessage"
      ? <Apple className="w-3 h-3 text-muted-foreground/30" />
      : <MessageSquare className="w-3 h-3 text-muted-foreground/30" />;

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
    const toolCalls = msg.toolCalls ?? [];

    // Build reference cards — referencedPolicyIds now only contains policies actually cited via lookup_policy_section
    const allRefs: { type: "policy"; id: string; page?: number }[] = [];
    if (msg.referencedPolicyIds) {
      for (const pid of msg.referencedPolicyIds) {
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
            <div className={`flex items-center justify-between gap-3 mb-1 ${brokerPerspective ? "flex-row-reverse" : ""}`}>
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-label-sm font-medium text-muted-foreground/50">{agentBranding?.name ?? "Glass"}</p>
                {channelIcon}
                <span className="text-muted-foreground/20">·</span>
                <span className="text-label-sm text-muted-foreground/25">{time.format("MMM D, h:mm A")}</span>
              </div>
              {toolCalls.length > 0 && (
                <Button
                  type="button"
                  onClick={() => setShowToolCalls((value) => !value)}
                  variant="ghost"
                  size="xs"
                  className="h-6 shrink-0 gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground/55 hover:text-foreground/75"
                  aria-expanded={showToolCalls}
                >
                  {showToolCalls ? "Hide tool calls" : `${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}`}
                </Button>
              )}
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
              <EmailSummaryCard message={msg} onOpen={onOpenEmail} />
            ) : (
              <>
                {/* Reasoning — collapsed above the response */}
                <CollapsibleReasoning
                  reasoning={msg.reasoning ?? ""}
                  isStreaming={false}
                />
                {toolCalls.length > 0 && showToolCalls && <ToolCallPanel toolCalls={toolCalls} />}
                <div className={`group/agent-msg relative rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 ${msg.reasoning ? "mt-1" : ""}`}>
                  <ProseMarkdown gfm breaks className={MARKDOWN_STYLES} components={markdownComponents}>{fixedContent}</ProseMarkdown>
                  <CopyMessageButton content={msg.content} />
                </div>
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
            {isMixedThread && msg.channel === "chat" && (
              <div className="flex items-center gap-1 mt-1 ml-0.5">
                <Lock className="w-2.5 h-2.5 text-muted-foreground/25" />
                <span className="text-label-sm text-muted-foreground/30">Only visible to your team</span>
              </div>
            )}
          </div>
        </div>
        <ReferenceCardStrip refs={allRefs} citedSections={citedSections} citedCoverageNames={citedCoverageNames} rightAligned={brokerPerspective} />
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
          <EmailSummaryCard message={msg} onOpen={onOpenEmail} />
        ) : (
        <div className={`rounded-lg px-3.5 py-2.5 text-body-sm text-foreground ${
          isEmail
            ? `border border-foreground/6 ${isOwnMessage ? "bg-foreground/[0.04]" : "bg-foreground/[0.02]"}`
            : isOwnMessage ? "bg-foreground/[0.06]" : "bg-foreground/[0.03]"
        }`}>
          <PretextText as="p" text={cleanContent} whiteSpace="pre-wrap" />
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
        {isMixedThread && msg.channel === "chat" && (
          <div className={`flex items-center gap-1 mt-1 ${isOwnMessage ? "justify-end mr-0.5" : "ml-0.5"}`}>
            <Lock className="w-2.5 h-2.5 text-muted-foreground/25" />
            <span className="text-label-sm text-muted-foreground/30">Only visible to your team</span>
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
      className="inline-flex items-center gap-1.5 mt-1.5 text-label-sm text-muted-foreground/35 hover:text-muted-foreground/60 transition-colors cursor-pointer disabled:opacity-50"
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
      className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-foreground/[0.04] opacity-0 group-hover/agent-msg:opacity-100 transition-all cursor-pointer"
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
  viewerId,
  viewerEmail,
  agentBranding,
}: {
  threadId: Id<"threads">;
  onMeta?: (meta: { detail: React.ReactNode; actions: React.ReactNode }) => void;
  viewerId?: string;
  viewerEmail?: string;
  agentHandle?: string;
  agentBranding?: { name: string; iconUrl?: string | null };
}) {
  const thread = useQuery(api.threads.get, { id: threadId });
  const messages = useQuery(api.threads.messages, { threadId }) as ThreadMessage[] | undefined;
  const sendMessage = useMutation(api.threads.sendMessage);
  const updateTitle = useMutation(api.threads.updateTitle);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<GlassPromptInputHandle>(null);
  const prevThreadId = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openEmailMessage, setOpenEmailMessage] = useState<ThreadMessage | null>(null);

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

  // Scroll to bottom when messages change or thread switches
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNew = prevThreadId.current !== threadId;
    prevThreadId.current = threadId;
    if (isNew) setOpenEmailMessage(null);
    el.scrollTo({ top: el.scrollHeight, behavior: isNew ? "instant" : "smooth" });
  }, [threadId, messages?.length]);

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

  // Detect if thread has both chat and email messages (mixed thread)
  const isMixedThread = useMemo(() => {
    if (!messages) return false;
    const hasEmail = messages.some((m) => m.channel === "email");
    return hasEmail || thread?.originChannel === "email";
  }, [messages, thread?.originChannel]);
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
            return messages?.map((msg, idx) => {
              const isFirstUser = idx === firstUserIdx;
              const firstUserIsOwn =
                isFirstUser &&
                ((viewerId && msg.userId === viewerId) ||
                  (viewerEmail && msg.fromEmail?.toLowerCase() === viewerEmail.toLowerCase()));
              return (
                <div key={msg._id}>
                  <UnifiedMessageBubble
                    msg={msg}
                    viewerId={viewerId}
                    viewerEmail={viewerEmail}
                    isMixedThread={isMixedThread}
                    isLastAgentMessage={idx === lastAgentIdx}
                    isFirstUserMessage={false}
                    threadContext={undefined}
                    agentBranding={agentBranding}
                    collapseEmailMessages={collapseEmailMessages}
                    onOpenEmail={setOpenEmailMessage}
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
      <EmailThreadSidebar message={openEmailMessage} onClose={() => setOpenEmailMessage(null)} />

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

  // Thread metadata lifted from child components for AppShell header
  const [threadMeta, setThreadMeta] = useState<{ detail: React.ReactNode; actions: React.ReactNode }>({
    detail: "Conversation",
    actions: null,
  });

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
      <AppShell breadcrumbDetail={threadMeta.detail} actions={threadMeta.actions} presenceUsers={presenceUsers}>
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full flex flex-col">
            <UnifiedThreadContent
              threadId={unifiedThread._id}
              onMeta={handleUnifiedMeta}
              viewerId={viewer?._id}
              viewerEmail={viewer?.email ?? undefined}
              agentHandle={agentHandle ?? undefined}
              agentBranding={agentBranding}
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
