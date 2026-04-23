"use client";

import { use, useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { ModeBadge } from "@/components/mode-badge";
import { MessageBubble, splitQuotedReply, QuotedContent, type Conversation } from "@/components/conversation-message";
import { ChatMessageBubble, type WebChatMessage } from "@/components/chat-message-bubble";
import { toast } from "sonner";
import { Loader2, Archive, ArchiveRestore, FileText, Pencil, Check, ClipboardList, Asterisk, Mail as MailIcon, MessageSquare, Paperclip, Download, Copy, Lock, RotateCcw } from "lucide-react";
import { usePdf } from "@/components/pdf-context";
import { usePresence } from "@/hooks/use-presence";
import { ContextReferenceCard, PolicyReferenceCard, ReferenceCardStrip } from "@/components/context-reference-card";
import { ChatInput, ChatInputOverlay, type ChatInputHandle } from "@/components/chat-input";
import { GlassPromptInput, type GlassPromptInputHandle } from "@/components/glass-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { CollapsibleReasoning } from "@/components/collapsible-reasoning";
import Link from "next/link";
import { PROSE_MARKDOWN_STYLES } from "@/components/prose-markdown";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
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
  channel: "chat" | "email";
  role: "user" | "agent" | "system";
  userId?: Id<"users">;
  userName?: string;
  fromEmail?: string;
  fromName?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  subject?: string;
  content: string;
  contentHtml?: string;
  reasoning?: string;
  messageId?: string;
  responseMessageId?: string;
  attachments?: { filename: string; contentType: string; size: number; fileId?: Id<"_storage"> }[];
  referencedPolicyIds?: Id<"policies">[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  usedTools?: string[];
  toolCalls?: { name: string; input?: string }[];
  status?: "processing" | "error" | "pending_send";
  error?: string;
  pendingEmailId?: Id<"pendingEmails">;
  legacyConversationId?: Id<"agentConversations">;
};

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  lookup_policy: "Searched policies",
  lookup_policy_section: "Read policy sections",
  compare_coverages: "Compared coverages",
  check_application_status: "Checked application",
  save_note: "Saved note",
  generate_coi: "Generated COI",
  send_email: "Drafted email",
};

/* ── Unified thread actions ── */
function UnifiedThreadActions({
  threadId,
  thread,
  messages,
  onEditTitle,
}: {
  threadId: Id<"threads">;
  thread: { title: string; archivedAt?: number; legacyConversationId?: Id<"agentConversations">; threadEmail?: string };
  messages?: ThreadMessage[];
  onEditTitle: () => void;
}) {
  const archiveThread = useMutation(api.threads.archive);
  const unarchiveThread = useMutation(api.threads.unarchive);
  const isArchived = !!thread.archivedAt;
  const isEmail = !!thread.legacyConversationId;

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
      const channel = msg.channel === "email" ? " [Email]" : " [Chat]";
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
      <PillButton size="compact" variant="icon" onClick={onEditTitle} label="Edit title">
        <Pencil className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton size="compact" variant="icon" onClick={handleArchiveToggle} label={isArchived ? "Unarchive" : "Archive"}>
        {isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
      </PillButton>
    </>
  );
}

/* ── Shared markdown container styles ── */
const MARKDOWN_STYLES = PROSE_MARKDOWN_STYLES + " [&_a]:text-primary-light [&_a]:underline";

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
}: {
  attachment: { filename: string; contentType: string; size: number; fileId?: Id<"_storage"> };
}) {
  const { openWithUrl } = usePdf();
  const url = useQuery(
    api.agentConversations.getAttachmentUrl,
    attachment.fileId ? { fileId: attachment.fileId } : "skip",
  );
  const isPdf = attachment.contentType === "application/pdf";

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

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
      <span className="text-muted-foreground/40 shrink-0">{formatSize(attachment.size)}</span>
      {url && !isPdf && <Download className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
    </a>
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
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState(false);
  const [now] = useState(() => Date.now());
  const time = dayjs(msg._creationTime);
  const channelIcon = msg.channel === "email"
    ? <MailIcon className="w-3 h-3 text-muted-foreground/30" />
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
            <div className={`rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 mt-1 ${MARKDOWN_STYLES}`}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>{displayContent}</Markdown>
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
                <button
                  type="button"
                  onClick={() => setShowToolCalls((value) => !value)}
                  className="shrink-0 text-label-sm text-muted-foreground/45 hover:text-muted-foreground/65 transition-colors cursor-pointer"
                >
                  {showToolCalls ? "Hide tool calls" : `${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
            {msg.channel === "email" && msg.toAddresses && (
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
            {/* Reasoning — collapsed above the response */}
            <CollapsibleReasoning
              reasoning={msg.reasoning ?? ""}
              isStreaming={false}
            />
            {toolCalls.length > 0 && showToolCalls && (
              <div className="mb-3 ml-0.5">
                  <div className="rounded-lg border border-foreground/6 bg-white overflow-hidden">
                    <div className="px-3 py-2 space-y-1">
                      {toolCalls.map((toolCall, index) => (
                        <div key={`${toolCall.name}-${index}`} className="py-1.5 first:pt-0 last:pb-0">
                          <p className="text-label-sm text-foreground/75 font-medium">{TOOL_DISPLAY_NAMES[toolCall.name] ?? toolCall.name}</p>
                          {toolCall.input && (
                            <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-muted-foreground/70 font-mono">{toolCall.input}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
              </div>
            )}
            <div className={`group/agent-msg relative rounded-lg bg-popover border border-foreground/6 px-3.5 py-2.5 ${msg.reasoning ? "mt-1" : ""} ${MARKDOWN_STYLES}`}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>{fixedContent}</Markdown>
              <CopyMessageButton content={msg.content} />
            </div>
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

  const displayName = msg.userName ?? msg.fromName ?? msg.fromEmail ?? "User";

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
        {isEmail && msg.toAddresses && (
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
        <div className={`rounded-lg px-3.5 py-2.5 text-body-sm text-foreground ${
          isEmail
            ? `border border-foreground/6 ${isOwnMessage ? "bg-foreground/[0.04]" : "bg-foreground/[0.02]"}`
            : isOwnMessage ? "bg-foreground/[0.06]" : "bg-foreground/[0.03]"
        }`}>
        <p className="whitespace-pre-wrap">{cleanContent}</p>
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
              <ThreadAttachmentChip key={i} attachment={att} />
            ))}
          </div>
        )}
        </div>
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
  onMeta?: (meta: { detail: string; actions: React.ReactNode }) => void;
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<GlassPromptInputHandle>(null);
  const prevThreadId = useRef<string | null>(null);

  // Error state for chat — stored as { threadId, message } so switching threads auto-clears it
  const [chatErrorState, setChatErrorState] = useState<{ threadId: string; message: string } | null>(null);
  const chatError = chatErrorState?.threadId === threadId ? chatErrorState.message : null;
  const setChatError = useCallback((msg: string | null) =>
    setChatErrorState(msg ? { threadId, message: msg } : null), [threadId]);

  // Push title + actions to parent for AppShell header
  useEffect(() => {
    if (!thread || !onMeta) return;
    onMeta({
      detail: thread.title,
      actions: (
        <UnifiedThreadActions
          threadId={threadId}
          thread={thread}
          messages={messages}
          onEditTitle={() => {
            setTitleDraft(thread.title);
            setEditingTitle(true);
          }}
        />
      ),
    });
  }, [thread, threadId, onMeta, messages]);

  // Scroll to bottom when messages change or thread switches
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNew = prevThreadId.current !== threadId;
    prevThreadId.current = threadId;
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

  const handleSend = useCallback(async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text && message.files.length === 0) return;

    // Upload files first if any
    const attachments: { filename: string; contentType: string; size: number; fileId: Id<"_storage"> }[] = [];
    if (message.files.length > 0) {
      for (const file of message.files) {
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.mediaType || "application/octet-stream" },
          body: await fetch(file.url).then((r) => r.blob()),
        });
        if (res.ok) {
          const { storageId } = await res.json();
          attachments.push({
            filename: file.filename ?? "file",
            contentType: file.mediaType || "application/octet-stream",
            size: 0,
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
  }, [sendMessage, threadId, generateUploadUrl, setChatError]);

  // Detect if thread has both chat and email messages (mixed thread)
  const isMixedThread = useMemo(() => {
    if (!messages) return false;
    const hasEmail = messages.some((m) => m.channel === "email");
    return hasEmail || !!thread?.legacyConversationId;
  }, [messages, thread?.legacyConversationId]);

  async function handleTitleSave() {
    const t = titleDraft.trim();
    if (!t) return;
    try {
      await updateTitle({ id: threadId, title: t });
    } catch {
      toast.error("Failed to update title");
    }
    setEditingTitle(false);
  }

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Inline title editor */}
      {editingTitle && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-1.5 px-4 py-2 border-b border-foreground/6 bg-background shrink-0">
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTitleSave();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="text-body-sm font-semibold bg-transparent border-b border-foreground/20 outline-none py-0 px-0 flex-1"
            autoFocus
          />
          <PillButton size="compact" variant="icon" onClick={handleTitleSave}>
            <Check className="w-3.5 h-3.5" />
          </PillButton>
        </div>
      )}

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
          status={messages?.some((m) => m.role === "agent" && m.status === "processing") ? "submitted" : undefined}
        />
      </ChatInputOverlay>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Legacy Email Thread View
   ═══════════════════════════════════════════════════ */

type Thread = {
  root: Conversation;
  messages: Conversation[];
  latestTime: number;
};

/* ── Email thread actions (lifted to AppShell header) ── */
function EmailThreadActions({
  thread,
}: {
  thread: Thread;
}) {
  const archiveConv = useMutation(api.agentConversations.archive);
  const unarchiveConv = useMutation(api.agentConversations.unarchive);
  const root = thread.root;
  const isArchived = !!root.archivedAt;

  async function handleArchiveToggle() {
    for (const msg of thread.messages) {
      if (isArchived) {
        await unarchiveConv({ id: msg._id });
      } else {
        await archiveConv({ id: msg._id });
      }
    }
    toast.success(isArchived ? "Unarchived" : "Archived");
  }

  function handleCopyThread() {
    const lines: string[] = [];
    lines.push(`Thread: ${root.subject}`);
    lines.push(`Messages: ${thread.messages.length}`);
    lines.push("─".repeat(50));
    for (const msg of thread.messages) {
      const time = dayjs(msg._creationTime).format("MMM D, YYYY h:mm A");
      const sender = msg.responseBody
        ? "Glass"
        : msg.fromName ?? msg.fromEmail ?? "Unknown";
      lines.push("");
      lines.push(`${sender} — ${time}`);
      lines.push(`From: ${msg.fromEmail}`);
      if (msg.toAddresses?.length) lines.push(`To: ${msg.toAddresses.join(", ")}`);
      if (msg.ccAddresses?.length) lines.push(`CC: ${msg.ccAddresses.join(", ")}`);
      lines.push("");
      lines.push(msg.responseBody ? msg.responseBody : msg.body);
      if (msg.attachments?.length) {
        lines.push(`Attachments: ${msg.attachments.map((a: { filename: string }) => a.filename).join(", ")}`);
      }
      lines.push("─".repeat(50));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Thread copied to clipboard");
  }

  return (
    <>
      <ModeBadge mode={root.mode} />
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

/* ── Legacy email thread view ── */
function EmailThreadContent({
  threadId,
  onMeta,
  viewerEmail,
}: {
  threadId: string;
  onMeta?: (meta: { subject: string; actions: React.ReactNode }) => void;
  viewerEmail?: string;
}) {
  const { openWithUrl } = usePdf();
  const conversations = useQuery(api.agentConversations.list, { archived: false });
  const archivedConversations = useQuery(api.agentConversations.list, { archived: true });
  const retryApp = undefined;
  const messagesRef = useRef<HTMLDivElement>(null);
  const prevThreadId = useRef<string | null>(null);

  const thread = useMemo<Thread | undefined>(() => {
    const allConvs = [
      ...(conversations ?? []),
      ...(archivedConversations ?? []),
    ] as unknown as Conversation[];
    if (allConvs.length === 0) return undefined;

    const threadMap = new Map<string, Thread>();
    for (const conv of allConvs) {
      const rootId = conv.threadId ?? conv._id;
      const rootIdStr = rootId as string;
      const existing = threadMap.get(rootIdStr);
      if (existing) {
        existing.messages.push(conv);
        if (conv._creationTime > existing.latestTime) {
          existing.latestTime = conv._creationTime;
        }
      } else {
        threadMap.set(rootIdStr, {
          root: conv.threadId ? allConvs.find((c) => c._id === conv.threadId) ?? conv : conv,
          messages: [conv],
          latestTime: conv._creationTime,
        });
      }
    }

    for (const t of threadMap.values()) {
      t.messages.sort((a, b) => a._creationTime - b._creationTime);
      if (!t.messages.find((m) => m._id === t.root._id)) {
        t.messages.unshift(t.root);
      }
    }

    return threadMap.get(threadId) ??
      Array.from(threadMap.values()).find((t) =>
        t.messages.some((m) => (m._id as string) === threadId)
      );
  }, [conversations, archivedConversations, threadId]);

  // Push subject + actions to parent for AppShell header
  useEffect(() => {
    if (!thread || !onMeta) return;
    onMeta({
      subject: thread.root.subject,
      actions: <EmailThreadActions thread={thread} />,
    });
  }, [thread, onMeta]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !thread) return;
    const isNew = prevThreadId.current !== thread.root._id;
    prevThreadId.current = thread.root._id;
    el.scrollTo({ top: el.scrollHeight, behavior: isNew ? "instant" : "smooth" });
  }, [thread, thread?.root._id, thread?.messages.length]);

  if (conversations === undefined && archivedConversations === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-body-sm text-muted-foreground/40">Thread not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 pr-5">
        <div className="max-w-2xl mx-auto space-y-4">
          {thread.messages.map((msg) => (
            <MessageBubble key={msg._id} conv={msg} onOpenPdf={openWithUrl} viewerEmail={viewerEmail} />
          ))}
          {thread.messages.length > 0 && <div className="h-[50vh]" />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Legacy Web Chat View
   ═══════════════════════════════════════════════════ */

/* ── Web chat actions (lifted to AppShell header) ── */
function WebChatActions({
  chat,
  chatId,
  messages,
  onEditTitle,
}: {
  chat: { title: string; archivedAt?: number };
  chatId: Id<"webChats">;
  messages?: WebChatMessage[];
  onEditTitle: () => void;
}) {
  const archiveChat = useMutation(api.webChats.archive);
  const unarchiveChat = useMutation(api.webChats.unarchive);
  const isArchived = !!chat.archivedAt;

  async function handleArchiveToggle() {
    try {
      if (isArchived) {
        await unarchiveChat({ id: chatId });
        toast.success("Unarchived");
      } else {
        await archiveChat({ id: chatId });
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
    lines.push(`Chat: ${chat.title}`);
    lines.push(`Messages: ${messages.length}`);
    lines.push("─".repeat(50));
    for (const msg of messages) {
      if (msg.status === "processing") continue;
      const time = dayjs(msg._creationTime).format("MMM D, YYYY h:mm A");
      const sender = msg.role === "agent" ? "Glass" : (msg.userName ?? "User");
      lines.push("");
      lines.push(`${sender} — ${time}`);
      lines.push("");
      lines.push(msg.content);
      lines.push("─".repeat(50));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Chat copied to clipboard");
  }

  return (
    <>
      <ModeBadge mode="chat" />
      <div className="w-px h-4 bg-foreground/10" />
      <PillButton size="compact" variant="icon" onClick={handleCopyThread} label="Copy thread">
        <Copy className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton size="compact" variant="icon" onClick={onEditTitle} label="Edit title">
        <Pencil className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton size="compact" variant="icon" onClick={handleArchiveToggle} label={isArchived ? "Unarchive" : "Archive"}>
        {isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
      </PillButton>
    </>
  );
}

/* ── Legacy web chat view ── */
function WebChatContent({
  chatId,
  onMeta,
  viewerId,
}: {
  chatId: Id<"webChats">;
  onMeta?: (meta: { title: string; actions: React.ReactNode }) => void;
  viewerId?: string;
}) {
  const chat = useQuery(api.webChats.get, { id: chatId });
  const messages = useQuery(api.webChats.messages, { chatId }) as WebChatMessage[] | undefined;
  const sendMessage = useMutation(api.webChats.sendMessage);
  const updateTitle = useMutation(api.webChats.updateTitle);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const prevChatId = useRef<string | null>(null);

  // Push title + actions to parent for AppShell header
  useEffect(() => {
    if (!chat || !onMeta) return;
    onMeta({
      title: chat.title,
      actions: (
        <WebChatActions
          chat={chat}
          chatId={chatId}
          messages={messages}
          onEditTitle={() => {
            setTitleDraft(chat.title);
            setEditingTitle(true);
          }}
        />
      ),
    });
  }, [chat, chatId, onMeta, messages]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNew = prevChatId.current !== chatId;
    prevChatId.current = chatId;
    el.scrollTo({ top: el.scrollHeight, behavior: isNew ? "instant" : "smooth" });
  }, [chatId]);

  const handleSend = useCallback(async (text: string) => {
    await sendMessage({ chatId, content: text });
  }, [sendMessage, chatId]);

  async function handleTitleSave() {
    const t = titleDraft.trim();
    if (!t || !chat) return;
    try {
      await updateTitle({ id: chatId, title: t });
    } catch {
      toast.error("Failed to update title");
    }
    setEditingTitle(false);
  }

  if (!chat) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Inline title editor (shown when editing) */}
      {editingTitle && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-1.5 px-4 py-2 border-b border-foreground/6 bg-background shrink-0">
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTitleSave();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="text-body-sm font-semibold bg-transparent border-b border-foreground/20 outline-none py-0 px-0 flex-1"
            autoFocus
          />
          <PillButton size="compact" variant="icon" onClick={handleTitleSave}>
            <Check className="w-3.5 h-3.5" />
          </PillButton>
        </div>
      )}

      {/* Messages — full height, content scrolls under the input overlay */}
      <div ref={messagesRef} className="absolute inset-0 overflow-y-auto p-4 pr-5">
        <div className="max-w-2xl mx-auto space-y-4">
          {(!messages || messages.length === 0) && (
            <NewChatEmptyState onSelectPrompt={(prompt) => chatInputRef.current?.setValueAndFocus(prompt)} />
          )}
          {messages?.map((msg) => (
            <ChatMessageBubble key={msg._id} message={msg} viewerId={viewerId} />
          ))}
          {/* Padding so last message clears the input overlay */}
          {messages && messages.length > 0 && <div className="h-40" />}
        </div>
      </div>

      {/* Input — overlaid at bottom, content scrolls under it */}
      <ChatInputOverlay>
        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          placeholder="Ask about your policies..."
          showAttach={false}
          autoFocus
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
  const agentBranding = viewerOrg?.brokerOrg
    ? { name: `${viewerOrg.brokerOrg.name} Agent`, iconUrl: viewerOrg.brokerOrg.iconUrl }
    : undefined;

  // Thread metadata lifted from child components for AppShell header
  const [threadMeta, setThreadMeta] = useState<{ detail: string; actions: React.ReactNode }>({
    detail: "Conversation",
    actions: null,
  });

  // Try unified threads table first
  const unifiedThread = useQuery(api.threads.tryGet, { id });
  // Fall back to legacy web chat
  const legacyChat = useQuery(
    api.webChats.tryGet,
    unifiedThread === null ? { id } : "skip",
  );

  const handleUnifiedMeta = useCallback((meta: { detail: string; actions: React.ReactNode }) => {
    setThreadMeta(meta);
  }, []);

  const handleEmailMeta = useCallback((meta: { subject: string; actions: React.ReactNode }) => {
    setThreadMeta({ detail: meta.subject, actions: meta.actions });
  }, []);

  const handleChatMeta = useCallback((meta: { title: string; actions: React.ReactNode }) => {
    setThreadMeta({ detail: meta.title, actions: meta.actions });
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

  // Legacy fallback: loading legacy chat query
  if (legacyChat === undefined) {
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

  // Legacy web chat
  if (legacyChat) {
    return (
      <AppShell breadcrumbDetail={threadMeta.detail} actions={threadMeta.actions} presenceUsers={presenceUsers}>
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full flex flex-col">
            <WebChatContent chatId={id as Id<"webChats">} onMeta={handleChatMeta} viewerId={viewer?._id} />
          </div>
        </div>
      </AppShell>
    );
  }

  // Legacy email thread fallback
  return (
    <AppShell breadcrumbDetail={threadMeta.detail} actions={threadMeta.actions} presenceUsers={presenceUsers}>
      <div className="absolute inset-0 overflow-hidden">
        <div className="h-full flex flex-col">
          <EmailThreadContent threadId={id} onMeta={handleEmailMeta} viewerEmail={viewer?.email ?? undefined} />
        </div>
      </div>
    </AppShell>
  );
}
