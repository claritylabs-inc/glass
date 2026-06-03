"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import JSZip from "jszip";
import { toast } from "sonner";
import {
  Loader2,
  Archive,
  ArchiveRestore,
  Check,
  ClipboardList,
  Mail as MailIcon,
  MessageCircle,
  Copy,
  RotateCcw,
  X,
  Clock,
  Download,
  Paperclip,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import {
  useArchivedThreadCacheActions,
  useThreadCacheActions,
} from "@/lib/sync/glass-cached-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionSurfaceLink } from "@/components/ui/action-surface";
import { PillButton } from "@/components/ui/pill-button";
import {
  splitQuotedReply,
  QuotedContent,
} from "@/components/conversation-message";
import { EditableBreadcrumbTitle } from "@/components/editable-breadcrumb-title";
import {
  ContextReferenceCard,
  PolicyReferenceCard,
  ReferenceCardStrip,
} from "@/components/context-reference-card";
import {
  ChatInputOverlay,
  GlassPromptInput,
  type GlassPromptInputHandle,
} from "@/components/glass-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { CollapsibleReasoning } from "@/components/collapsible-reasoning";
import { ProseMarkdown } from "@/components/prose-markdown";
import { NewChatEmptyState } from "@/components/new-chat-empty-state";
import { LogoIcon } from "@/components/ui/logo-icon";
import { ThreadAttachmentChip } from "@/components/agent-thread/thread-attachment-chip";
import { scientistSurnameFor } from "@/components/agent-thread/scientist-surnames";
import type {
  MailboxArtifactRef,
  PolicyChangeAccess,
  ThreadAttachment,
  ThreadMessage,
  ToolArtifactData,
  VendorComplianceArtifactRef,
} from "@/components/agent-thread/types";
import {
  CertificateProgramSelectionArtifacts,
  CertificateHoldArtifacts,
  EmailStackCard,
  EmailSummaryCard,
  EmailThreadSidebar,
  MailboxTaskSidebar,
  PolicyChangeSummaryCard,
  PolicyChangeThreadSidebar,
  VendorComplianceArtifacts,
  VendorComplianceSidebar,
  mailboxTaskDisplayName,
  normalizeMailboxTask,
} from "@/components/agent-thread/artifacts";

/* ═══════════════════════════════════════════════════
   Unified Thread View (new threads table)
   ═══════════════════════════════════════════════════ */

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

function inferAttachmentContentType(
  filename: string | undefined,
  mediaType: string | undefined,
) {
  if (mediaType) return mediaType;
  const lowerName = filename?.toLowerCase() ?? "";
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".tsv")) return "text/tab-separated-values";
  if (lowerName.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lowerName.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lowerName.endsWith(".xlsm"))
    return "application/vnd.ms-excel.sheet.macroEnabled.12";
  if (lowerName.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lowerName.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg"))
    return "image/jpeg";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".txt")) return "text/plain";
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown"))
    return "text/markdown";
  if (lowerName.endsWith(".json")) return "application/json";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function uniqueZipFilename(filename: string, usedNames: Set<string>) {
  const trimmed = filename.trim() || "attachment";
  if (!usedNames.has(trimmed)) {
    usedNames.add(trimmed);
    return trimmed;
  }

  const dotIndex = trimmed.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const basename = hasExtension ? trimmed.slice(0, dotIndex) : trimmed;
  const extension = hasExtension ? trimmed.slice(dotIndex) : "";
  let index = 2;
  let candidate = `${basename} (${index})${extension}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${basename} (${index})${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}

const SUBAGENT_TOOL_NAMES = new Set([
  "email_expert",
  "coordinate_mailbox_task",
]);
const EMAIL_SENDING_RE = /^sending email to\s+(.+?)(?:\s*\(cc:.*\))?\s*\.{3}$/i;
const EMAIL_SENT_RE = /^email sent to\s+(.+?)(?:\s*\(cc:.*\))?\s*\.$/i;

function ThreadAttachmentList({
  attachments,
  threadId,
  rightAligned,
}: {
  attachments: ThreadAttachment[];
  threadId: Id<"threads">;
  rightAligned?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const fileIds = useMemo(
    () =>
      attachments
        .map((attachment) => attachment.fileId)
        .filter((fileId): fileId is Id<"_storage"> => Boolean(fileId)),
    [attachments],
  );
  const urls = useCachedQuery(
    "threads.getAttachmentUrls.list",
    api.threads.getAttachmentUrls,
    fileIds.length > 1 ? { threadId, fileIds } : "skip",
  );

  const handleDownloadAll = useCallback(async () => {
    if (!urls?.length) return;
    setIsDownloadingAll(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const entry of urls) {
        const attachment = attachments.find(
          (att) => att.fileId === entry.fileId,
        );
        const filename = uniqueZipFilename(
          attachment?.filename ?? "attachment",
          usedNames,
        );
        const response = await fetch(entry.url);
        if (!response.ok) {
          throw new Error(
            `Failed to download ${attachment?.filename ?? entry.fileId}`,
          );
        }
        zip.file(filename, await response.blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "thread-attachments.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast.error("Failed to download attachments");
    } finally {
      setIsDownloadingAll(false);
    }
  }, [attachments, urls]);

  if (attachments.length === 0) return null;

  if (attachments.length === 1) {
    return (
      <ThreadAttachmentChip
        attachment={attachments[0]}
        threadId={threadId}
        className="w-fit"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        className="inline-flex h-6 items-center gap-1.5 rounded-full border border-foreground/8 bg-transparent px-2 text-label font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
      >
        <Paperclip className="h-3 w-3" />
        {attachments.length} files
      </button>
      {isExpanded ? (
        <div
          className={`flex min-w-0 basis-full flex-wrap items-start gap-1.5 ${
            rightAligned ? "justify-end" : ""
          }`}
        >
          {attachments.map((att, i) => (
            <span
              key={`${att.fileId ?? att.filename}-${i}`}
              className="min-w-0 transition-[opacity,transform] duration-200 ease-out"
              style={{ transitionDelay: `${Math.min(i * 25, 100)}ms` }}
            >
              <ThreadAttachmentChip
                attachment={att}
                threadId={threadId}
                className="w-fit"
              />
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadAll}
            disabled={!urls?.length || isDownloadingAll}
            className="h-6 shrink-0 gap-1.5 rounded-full px-2 text-label font-medium text-muted-foreground/60 hover:bg-foreground/3 hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            {isDownloadingAll ? "Preparing..." : "Download all"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function normalizeStatusContent(content: string) {
  return content.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeMessageForDedupe(content: string) {
  return normalizeStatusContent(content)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<([^>\s]+@[^>\s]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getEmailStatusRecipient(message: ThreadMessage) {
  const normalized = normalizeStatusContent(message.content);
  const match =
    normalized.match(EMAIL_SENT_RE) ?? normalized.match(EMAIL_SENDING_RE);
  return match?.[1]?.trim().toLowerCase();
}

function isEmailSendStatusMessage(message: ThreadMessage) {
  if (message.role !== "agent") return false;
  if (message.channel !== "chat" && message.channel !== "imessage")
    return false;
  if (message.pendingEmailId) return true;
  return getEmailStatusRecipient(message) != null;
}

function isEmailSendingStatusMessage(message: ThreadMessage) {
  return EMAIL_SENDING_RE.test(normalizeStatusContent(message.content));
}

function isEmailSentStatusMessage(message: ThreadMessage) {
  return EMAIL_SENT_RE.test(normalizeStatusContent(message.content));
}

function emailMessageMatchesRecipient(
  message: ThreadMessage,
  recipient?: string,
) {
  if (!recipient) return true;
  return (
    message.toAddresses?.some(
      (address) => address.toLowerCase() === recipient,
    ) ?? false
  );
}

function findRelatedEmailMessages(
  messages: ThreadMessage[],
  message: ThreadMessage,
  index: number,
  attachedEmailMessageIds: Set<string>,
) {
  if (!isEmailSendStatusMessage(message)) return [];

  const related = new Map<string, ThreadMessage>();

  if (message.pendingEmailId) {
    const linked = messages.find(
      (candidate) =>
        candidate.channel === "email" &&
        candidate.role === "agent" &&
        candidate.pendingEmailId === message.pendingEmailId &&
        candidate._id !== message._id,
    );
    if (linked && !attachedEmailMessageIds.has(linked._id)) {
      related.set(linked._id, linked);
    }
  }

  const recipient = getEmailStatusRecipient(message);
  let start = index;
  while (start > 0 && messages[start - 1]?.role !== "user") start -= 1;
  let end = index;
  while (end + 1 < messages.length && messages[end + 1]?.role !== "user")
    end += 1;

  for (const candidate of messages
    .slice(start, end + 1)
    .filter(
      (candidate) =>
        candidate.channel === "email" &&
        candidate.role === "agent" &&
        candidate._id !== message._id &&
        !attachedEmailMessageIds.has(candidate._id) &&
        emailMessageMatchesRecipient(candidate, recipient),
    )
    .sort(
      (a, b) =>
        Math.abs(a._creationTime - message._creationTime) -
        Math.abs(b._creationTime - message._creationTime),
    )) {
    related.set(candidate._id, candidate);
  }

  return [...related.values()].sort(
    (a, b) => a._creationTime - b._creationTime,
  );
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
    if (
      isEmailSentStatusMessage(candidate) &&
      getEmailStatusRecipient(candidate) === recipient
    ) {
      return true;
    }
  }
  return false;
}

function hasSameEmailSentStatus(first: ThreadMessage, second: ThreadMessage) {
  if (!isEmailSentStatusMessage(first) || !isEmailSentStatusMessage(second))
    return false;
  const firstRecipient = getEmailStatusRecipient(first);
  const secondRecipient = getEmailStatusRecipient(second);
  if (!firstRecipient || !secondRecipient) return false;
  return firstRecipient === secondRecipient;
}

function hasEarlierIdenticalAgentMessage(
  messages: ThreadMessage[],
  message: ThreadMessage,
  index: number,
) {
  if (message.role !== "agent") return false;
  if (message.channel !== "chat" && message.channel !== "imessage")
    return false;
  const normalized = normalizeMessageForDedupe(message.content);
  if (!normalized) return false;

  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (!candidate || candidate.role === "user") return false;
    if (candidate.role !== "agent") continue;
    if (candidate.channel !== "chat" && candidate.channel !== "imessage")
      continue;
    if (
      normalizeMessageForDedupe(candidate.content) === normalized ||
      hasSameEmailSentStatus(candidate, message)
    ) {
      return true;
    }
  }

  return false;
}

function isImessageSyncMessage(message: ThreadMessage) {
  if (message.role !== "agent" || message.channel !== "imessage") return false;
  const normalized = normalizeMessageForDedupe(message.content);
  return (
    /^glass replied in web chat:?/.test(normalized) ||
    /\bfrom glass web chat:/.test(normalized) ||
    /\bshared attachment\(s\) from glass web chat\.?$/.test(normalized) ||
    /\bsent (?:a )?message from glass web chat\.?$/.test(normalized)
  );
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
  const displayName =
    displayNameOverride ?? TOOL_DISPLAY_NAMES[toolCall.name] ?? toolCall.name;

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
            <span className="block truncate text-label font-medium text-muted-foreground/65">
              {displayName}
            </span>
          </span>
        </span>
        <span className="ml-3 flex shrink-0 items-center gap-2">
          <Badge
            className="h-4 gap-1 border-success/20 bg-success/10 px-1.5 text-label font-medium text-success/75"
            variant="outline"
          >
            Completed
          </Badge>
          <span className="text-label font-medium text-muted-foreground/35">
            {isOpen ? "Hide" : "Show"}
          </span>
        </span>
      </Button>
      {isOpen && (
        <div className="space-y-2 border-t border-foreground/6 px-2.5 pb-2.5 pt-2">
          {showOutput && toolCall.output ? (
            <div>
              <p className="mb-1 text-label font-medium text-muted-foreground/40">
                Output
              </p>
              <pre className="max-h-64 overflow-auto rounded border border-foreground/6 bg-background p-2 font-mono text-label leading-4 text-foreground/70">
                <code className="whitespace-pre-wrap break-words">
                  {formatToolInput(toolCall.output)}
                </code>
              </pre>
            </div>
          ) : null}
          {!showOutput || !toolCall.output ? (
            <div>
              <p className="mb-1 text-label font-medium text-muted-foreground/40">
                Parameters
              </p>
              <pre className="max-h-48 overflow-auto rounded border border-foreground/6 bg-background p-2 font-mono text-label leading-4 text-foreground/70">
                <code className="whitespace-pre-wrap break-words">
                  {formatToolInput(toolCall.input)}
                </code>
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
        <ToolCallCard
          key={`${toolCall.name}-${index}`}
          toolCall={toolCall}
          index={index}
        />
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
    <span className="min-w-0 truncate text-label font-normal text-muted-foreground/30">
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
  citedSourceSpanIds,
  attachments,
  threadId,
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
  citedSourceSpanIds?: string[];
  attachments?: ThreadAttachment[];
  threadId: Id<"threads">;
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
  const [isAttachmentExpanded, setIsAttachmentExpanded] = useState(false);
  const [isDownloadingAttachments, setIsDownloadingAttachments] =
    useState(false);
  const hasSubagentActivity = (subagentActivityCount ?? 0) > 0;
  const attachmentList = useMemo(() => attachments ?? [], [attachments]);
  const hasAttachments = attachmentList.length > 0;
  const attachmentFileIds = useMemo(
    () =>
      attachmentList
        .map((attachment) => attachment.fileId)
        .filter((fileId): fileId is Id<"_storage"> => Boolean(fileId)),
    [attachmentList],
  );
  const attachmentUrls = useCachedQuery(
    "threads.getAttachmentUrls.message",
    api.threads.getAttachmentUrls,
    attachmentFileIds.length > 1
      ? { threadId, fileIds: attachmentFileIds }
      : "skip",
  );
  const mailboxTasks =
    mailboxArtifacts?.filter((artifact) => artifact.type === "mailbox_task") ??
    [];
  const hasMailboxTasks = mailboxTasks.length > 0;
  const selectedMailboxIndex =
    openMailboxArtifactRef?.messageId === messageId
      ? (openMailboxArtifactRef?.index ?? null)
      : null;
  if (
    refs.length === 0 &&
    toolCalls.length === 0 &&
    !hasSubagentActivity &&
    !hasAttachments &&
    !hasMailboxTasks &&
    !copyContent?.trim() &&
    !retryMessageId
  )
    return null;

  const handleDownloadAttachments = async () => {
    if (!attachmentUrls?.length) return;
    setIsDownloadingAttachments(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const entry of attachmentUrls) {
        const attachment = attachmentList.find(
          (att) => att.fileId === entry.fileId,
        );
        const filename = uniqueZipFilename(
          attachment?.filename ?? "attachment",
          usedNames,
        );
        const response = await fetch(entry.url);
        if (!response.ok) {
          throw new Error(
            `Failed to download ${attachment?.filename ?? entry.fileId}`,
          );
        }
        zip.file(filename, await response.blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "thread-attachments.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast.error("Failed to download attachments");
    } finally {
      setIsDownloadingAttachments(false);
    }
  };

  const renderMailboxAgentPill = (index: number) => {
    const label = mailboxTaskDisplayName(
      normalizeMailboxTask(mailboxTasks[index].data),
    );
    const isSelected = selectedMailboxIndex === index;
    return (
      <button
        type="button"
        onClick={() => {
          if (!messageId) return;
          onOpenMailboxArtifact?.({ messageId, index });
        }}
        className={`inline-flex h-6 max-w-48 items-center gap-1.5 rounded-full border bg-transparent px-2 text-label font-medium transition-colors ${
          isSelected
            ? "border-foreground/18 bg-foreground/[0.04] text-foreground/75"
            : "border-foreground/8 text-muted-foreground/60 hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
        }`}
      >
        <span className="text-muted-foreground/35">{index + 1}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  return (
    <div className="mt-1.5 min-w-0">
      <div className="flex items-start gap-2">
        <div
          className={`flex min-w-0 flex-1 flex-wrap items-start gap-1.5 ${rightAligned ? "justify-end" : ""}`}
        >
          {refs.length > 0 && (
            <ReferenceCardStrip
              refs={refs}
              citedSections={citedSections}
              citedCoverageNames={citedCoverageNames}
              citedSourceSpanIds={citedSourceSpanIds}
              rightAligned={rightAligned}
            />
          )}
          {toolCalls.length > 0 && (
            <button
              type="button"
              onClick={onToggleToolCalls}
              aria-expanded={showToolCalls}
              className="inline-flex h-6 items-center gap-1.5 rounded-full border border-foreground/8 bg-transparent px-2 text-label font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/[0.03] hover:text-foreground/75"
            >
              <ClipboardList className="h-3 w-3" />
              {toolCalls.length} tool{toolCalls.length === 1 ? "" : "s"}
            </button>
          )}
          {attachmentList.length === 1 ? (
            <ThreadAttachmentChip
              attachment={attachmentList[0]}
              threadId={threadId}
              className="w-fit"
            />
          ) : attachmentList.length > 1 ? (
            <button
              type="button"
              onClick={() => setIsAttachmentExpanded((value) => !value)}
              aria-expanded={isAttachmentExpanded}
              className="inline-flex h-6 items-center gap-1.5 rounded-full border border-foreground/8 bg-transparent px-2 text-label font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
            >
              <Paperclip className="h-3 w-3" />
              {attachmentList.length} files
            </button>
          ) : null}
          {hasSubagentActivity && (
            <button
              type="button"
              onClick={onToggleSubagentActivity}
              aria-expanded={showSubagentActivity}
              className="inline-flex h-6 items-center gap-1.5 rounded-full border border-foreground/8 bg-transparent px-2 text-label font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/[0.03] hover:text-foreground/75"
            >
              <LogoIcon size={12} static className="h-3 w-3" />
              {subagentActivityCount} subagent
              {subagentActivityCount === 1 ? "" : "s"}
            </button>
          )}
          {mailboxTasks.length === 1 ? (
            renderMailboxAgentPill(0)
          ) : mailboxTasks.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setIsMailboxExpanded((value) => !value)}
                aria-expanded={isMailboxExpanded}
                className="inline-flex h-6 items-center rounded-full border border-foreground/8 bg-transparent px-2 text-label font-medium text-muted-foreground/55 transition-colors hover:border-foreground/12 hover:bg-foreground/3 hover:text-foreground/75"
              >
                {mailboxTasks.length} background agents
              </button>
              {isMailboxExpanded ? (
                <div className="flex flex-wrap items-start gap-1.5">
                  {mailboxTasks.map((_, index) => {
                    return (
                      <span
                        key={`mailbox-footer-${index}`}
                        className="transition-[opacity,transform] duration-200 ease-out"
                        style={{
                          transitionDelay: `${Math.min(index * 25, 100)}ms`,
                        }}
                      >
                        {renderMailboxAgentPill(index)}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {retryMessageId ? (
            <TryAgainMessageButton messageId={retryMessageId} />
          ) : null}
          {copyContent?.trim() ? (
            <CopyMessageButton content={copyContent} />
          ) : null}
        </div>
      </div>
      {attachmentList.length > 1 && isAttachmentExpanded ? (
        <div
          className={`mt-1.5 flex w-full min-w-0 flex-wrap items-start gap-1.5 ${
            rightAligned ? "justify-end" : ""
          }`}
        >
          {attachmentList.map((att, i) => (
            <span
              key={`${att.fileId ?? att.filename}-${i}`}
              className="min-w-0 transition-[opacity,transform] duration-200 ease-out"
              style={{ transitionDelay: `${Math.min(i * 25, 100)}ms` }}
            >
              <ThreadAttachmentChip
                attachment={att}
                threadId={threadId}
                className="w-fit"
              />
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadAttachments}
            disabled={!attachmentUrls?.length || isDownloadingAttachments}
            className="h-6 shrink-0 gap-1.5 rounded-full px-2 text-label font-medium text-muted-foreground/60 hover:bg-foreground/3 hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            {isDownloadingAttachments ? "Preparing..." : "Download all"}
          </Button>
        </div>
      ) : null}
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
  thread: {
    title: string;
    archivedAt?: number;
    originChannel?: "chat" | "email" | "imessage";
    threadEmail?: string;
  };
  messages?: ThreadMessage[];
}) {
  const archiveThread = useMutation(api.threads.archive);
  const unarchiveThread = useMutation(api.threads.unarchive);
  const { archiveThreadLocally, unarchiveThreadLocally } =
    useArchivedThreadCacheActions();
  const isArchived = !!thread.archivedAt;
  async function handleArchiveToggle() {
    try {
      if (isArchived) {
        await unarchiveThreadLocally(threadId);
        await unarchiveThread({ id: threadId });
        toast.success("Unarchived");
      } else {
        await archiveThreadLocally(threadId);
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
    lines.push(`Messages: ${messages.length}`);
    lines.push("─".repeat(50));
    for (const msg of messages) {
      if (msg.status === "processing") continue;
      const time = dayjs(msg._creationTime).format("MMM D, YYYY h:mm A");
      const sender =
        msg.role === "agent"
          ? "Glass"
          : (msg.userName ?? msg.fromName ?? msg.fromEmail ?? "User");
      const channel =
        msg.channel === "email"
          ? " [Email]"
          : msg.channel === "imessage"
            ? " [iMessage]"
            : " [Chat]";
      lines.push("");
      lines.push(`${sender}${channel} — ${time}`);
      if (msg.fromEmail) lines.push(`From: ${msg.fromEmail}`);
      if (msg.toAddresses?.length)
        lines.push(`To: ${msg.toAddresses.join(", ")}`);
      if (msg.ccAddresses?.length)
        lines.push(`CC: ${msg.ccAddresses.join(", ")}`);
      lines.push("");
      lines.push(msg.content);
      if (msg.attachments?.length) {
        lines.push(
          `Attachments: ${msg.attachments.map((a) => a.filename).join(", ")}`,
        );
      }
      lines.push("─".repeat(50));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Thread copied to clipboard");
  }

  return (
    <>
      <PillButton
        size="compact"
        variant="iconLabel"
        onClick={handleCopyThread}
        label="Copy thread"
      >
        <Copy className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton
        size="compact"
        variant="iconLabel"
        onClick={handleArchiveToggle}
        label={isArchived ? "Unarchive" : "Archive"}
      >
        {isArchived ? (
          <ArchiveRestore className="w-4 h-4" />
        ) : (
          <Archive className="w-4 h-4" />
        )}
      </PillButton>
    </>
  );
}

/* ── Shared markdown container styles ── */
const MARKDOWN_STYLES = "[&_a]:text-primary-light [&_a]:underline";

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href?.startsWith("/policies/")) {
      return (
        <ContextReferenceCard href={href}>{children}</ContextReferenceCard>
      );
    }
    return (
      <a
        href={href}
        className="text-primary-light underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
};

function SubagentActivityPanel({
  toolCalls,
}: {
  toolCalls: { name: string; input?: string; output?: string }[];
}) {
  const genericSubagentCalls = toolCalls.filter(
    (toolCall) => toolCall.name !== "coordinate_mailbox_task",
  );
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

/* ── Pending email countdown + cancel ── */
function PendingSendCountdown({
  pendingEmailId,
}: {
  pendingEmailId: Id<"pendingEmails">;
}) {
  const pendingEmail = useCachedQuery(
    "pendingEmails.get.countdown",
    api.pendingEmails.get,
    { id: pendingEmailId },
  );
  const updatePendingEmail = useUpdateCachedQuery<
    typeof pendingEmail,
    { id: Id<"pendingEmails"> }
  >("pendingEmails.get.countdown");
  const cancelMutation = useMutation(api.pendingEmails.cancel);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!pendingEmail || pendingEmail.status !== "pending") {
      return;
    }
    function tick() {
      const left = Math.max(
        0,
        Math.ceil((pendingEmail!.scheduledSendTime - dayjs().valueOf()) / 1000),
      );
      setRemaining(left);
    }
    tick();
    const interval = setInterval(tick, 200);
    return () => {
      clearInterval(interval);
      setRemaining(null);
    };
  }, [pendingEmail]);

  if (
    !pendingEmail ||
    pendingEmail.status !== "pending" ||
    remaining === null
  ) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-label text-muted-foreground/50">
        Sending in {remaining}s...
      </span>
      <button
        type="button"
        onClick={async () => {
          try {
            await cancelMutation({ id: pendingEmailId });
            await updatePendingEmail({ id: pendingEmailId }, (current) =>
              current ? { ...current, status: "cancelled" } : current,
            );
            toast.success("Email cancelled");
          } catch {
            toast.error("Failed to cancel");
          }
        }}
        className="text-label font-medium text-red-500 hover:text-red-600 transition-colors"
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
  const status =
    label ?? (isStale ? "Taking longer than expected" : "Thinking");
  const backgroundProcessContent = (
    <>
      <Loader2 className="h-3 w-3 animate-spin text-primary-light/70" />
      {backgroundProcessCount} background agent
      {backgroundProcessCount === 1 ? "" : "s"} running
    </>
  );

  return (
    <div className="mt-2 flex max-w-full flex-wrap items-center gap-2">
      <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-foreground/8 bg-foreground/[0.025] px-2.5 py-1.5 text-label font-medium text-muted-foreground/60">
        <LogoIcon
          size={12}
          static
          className="h-3 w-3 shrink-0 animate-spin text-primary-light/70 [animation-duration:1.8s]"
        />
        <span className="truncate">{status}</span>
      </span>
      {backgroundProcessCount > 0 && onOpenBackgroundProcess ? (
        <button
          type="button"
          onClick={onOpenBackgroundProcess}
          className="inline-flex items-center gap-1.5 rounded-full border border-foreground/8 bg-foreground/[0.025] px-2.5 py-1.5 text-label font-medium text-muted-foreground/55 transition-colors hover:border-foreground/15 hover:bg-foreground/[0.04]"
        >
          {backgroundProcessContent}
        </button>
      ) : backgroundProcessCount > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/8 bg-foreground/[0.025] px-2.5 py-1.5 text-label font-medium text-muted-foreground/55">
          {backgroundProcessContent}
        </span>
      ) : null}
    </div>
  );
}

/* ── Unified message bubble ── */
export function UnifiedMessageBubble({
  msg,
  relatedEmailMessages = [],
  viewerId,
  viewerEmail,
  isFirstUserMessage,
  mirroredToImessage,
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
  relatedEmailMessages?: ThreadMessage[];
  viewerId?: string;
  viewerEmail?: string;
  isFirstUserMessage?: boolean;
  mirroredToImessage?: boolean;
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
  const channelIcon =
    msg.channel === "email" ? (
      <MailIcon className="w-3 h-3 text-muted-foreground/30" />
    ) : msg.channel === "imessage" || mirroredToImessage ? (
      <MessageCircle className="w-3 h-3 text-muted-foreground/30" />
    ) : null;

  // Processing state — unified bubble with thinking, tool status, and streaming content
  if (msg.role === "agent" && msg.status === "processing") {
    const hasContent = msg.content && msg.content.length > 0;
    const hasReasoning = msg.reasoning && msg.reasoning.length > 0;
    const ageMs = now - msg._creationTime;
    const isStale = ageMs > 60_000;
    // Tool status messages are like "*Searching policies...*"
    const isToolStatus =
      hasContent && /^\*[^*]+\.\.\.\*$/.test(msg.content.trim());
    const toolLabel = isToolStatus
      ? msg.content.trim().replace(/^\*|\*$/g, "")
      : null;
    // Clean content strips tool labels — only show real generated text
    const displayContent = isToolStatus ? "" : msg.content;
    const mailboxArtifacts =
      msg.toolArtifacts?.filter(
        (artifact) => artifact.type === "mailbox_task",
      ) ?? [];
    const runningMailboxArtifacts = mailboxArtifacts.filter(
      (artifact) => normalizeMailboxTask(artifact.data).status === "running",
    );
    const backgroundProcessCount =
      runningMailboxArtifacts.length || mailboxArtifacts.length;

    return (
      <div className="flex items-start gap-2.5 max-w-lg">
        <div className="w-7 h-7 rounded-full bg-primary-light/15 flex items-center justify-center shrink-0 overflow-hidden">
          {agentBranding?.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agentBranding.iconUrl}
              alt=""
              className="w-7 h-7 object-cover"
            />
          ) : (
            <LogoIcon size={14} static className="text-primary-light" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-label font-medium text-muted-foreground/50">
              {agentBranding?.name ?? "Glass"}
            </p>
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
              <ProseMarkdown
                gfm
                breaks
                className={MARKDOWN_STYLES}
                components={markdownComponents}
              >
                {displayContent}
              </ProseMarkdown>
            </div>
          ) : null}
          <AgentProcessingActivity
            label={toolLabel}
            isStale={isStale}
            backgroundProcessCount={backgroundProcessCount}
            onOpenBackgroundProcess={
              mailboxArtifacts.length > 0
                ? () =>
                    onOpenMailboxArtifact?.({ messageId: msg._id, index: 0 })
                : undefined
            }
          />
          {relatedEmailMessages.length > 0 ? (
            <div className="mt-3">
              <EmailStackCard
                messages={relatedEmailMessages}
                onOpen={onOpenEmail}
                isOpenMessageId={openEmailMessageId}
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
        <p className="text-label text-red-600 dark:text-red-400">
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
    const citedSourceSpanIds = msg.citedSourceSpanIds;
    const toolCalls = msg.toolCalls?.length
      ? msg.toolCalls
      : (msg.usedTools ?? []).map((name) => ({ name }));
    const subagentToolCalls = toolCalls.filter((toolCall) =>
      SUBAGENT_TOOL_NAMES.has(toolCall.name),
    );
    const regularToolCalls = toolCalls.filter(
      (toolCall) => !SUBAGENT_TOOL_NAMES.has(toolCall.name),
    );
    const mailboxArtifacts =
      msg.toolArtifacts?.filter(
        (artifact) => artifact.type === "mailbox_task",
      ) ?? [];
    const genericSubagentToolCalls = subagentToolCalls.filter(
      (toolCall) => toolCall.name !== "coordinate_mailbox_task",
    );
    const subagentActivityCount = genericSubagentToolCalls.length;

    // Build reference cards — referencedPolicyIds now only contains policies actually cited via lookup_policy_section
    const allRefs: { type: "policy"; id: string; page?: number }[] = [];
    const referencedPolicyIds = [
      ...(msg.referencedPolicyIds ?? []),
      ...relatedEmailMessages.flatMap(
        (emailMessage) => emailMessage.referencedPolicyIds ?? [],
      ),
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
        <div
          className={`flex items-start gap-2.5 max-w-lg w-fit ${brokerPerspective ? "ml-auto flex-row-reverse" : ""}`}
        >
          <div className="w-7 h-7 rounded-full bg-primary-light/15 flex items-center justify-center shrink-0 overflow-hidden">
            {agentBranding?.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agentBranding.iconUrl}
                alt=""
                className="w-7 h-7 object-cover"
              />
            ) : (
              <LogoIcon size={14} static className="text-primary-light" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={`flex items-center gap-2 mb-1 ${brokerPerspective ? "justify-end" : ""}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <p className="shrink-0 text-label font-medium text-muted-foreground/50">
                  {agentBranding?.name ?? "Glass"}
                </p>
                {msg.channel === "email" && !collapseEmailMessages ? (
                  <EmailRecipientMeta
                    toAddresses={msg.toAddresses}
                    ccAddresses={msg.ccAddresses}
                  />
                ) : null}
                {channelIcon}
                <span className="text-muted-foreground/20">·</span>
                <span className="text-label text-muted-foreground/25">
                  {time.format("MMM D, h:mm A")}
                </span>
              </div>
            </div>
            {collapseEmailMessages && msg.channel === "email" ? (
              <EmailSummaryCard
                message={msg}
                onOpen={onOpenEmail}
                isOpen={openEmailMessageId === msg._id}
              />
            ) : (
              <>
                {/* Reasoning — collapsed above the response */}
                <CollapsibleReasoning
                  reasoning={msg.reasoning ?? ""}
                  isStreaming={false}
                />
                <div
                  className={`rounded-lg border px-3.5 py-2.5 ${msg.reasoning ? "mt-1" : ""} ${
                    isError
                      ? "border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400"
                      : "border-foreground/6 bg-popover"
                  }`}
                >
                  <ProseMarkdown
                    gfm
                    breaks
                    className={MARKDOWN_STYLES}
                    components={markdownComponents}
                  >
                    {fixedContent}
                  </ProseMarkdown>
                </div>
                <MessageFooterActions
                  refs={allRefs}
                  citedSections={citedSections}
                  citedCoverageNames={citedCoverageNames}
                  citedSourceSpanIds={citedSourceSpanIds}
                  attachments={msg.attachments}
                  threadId={msg.threadId}
                  toolCalls={regularToolCalls}
                  subagentActivityCount={subagentActivityCount}
                  mailboxArtifacts={mailboxArtifacts}
                  messageId={msg._id}
                  onOpenMailboxArtifact={onOpenMailboxArtifact}
                  openMailboxArtifactRef={openMailboxArtifactRef}
                  copyContent={fixedContent}
                  retryMessageId={
                    msg.channel === "chat" || msg.channel === "imessage"
                      ? msg._id
                      : undefined
                  }
                  showToolCalls={showToolCalls}
                  onToggleToolCalls={() => setShowToolCalls((value) => !value)}
                  showSubagentActivity={showSubagentActivity}
                  onToggleSubagentActivity={() =>
                    setShowSubagentActivity((value) => !value)
                  }
                  rightAligned={brokerPerspective}
                />
                <VendorComplianceArtifacts
                  messageId={msg._id}
                  artifacts={msg.toolArtifacts}
                  openArtifactRef={openVendorComplianceArtifactRef}
                  onOpenArtifact={onOpenVendorCompliance}
                />
                <CertificateProgramSelectionArtifacts
                  artifacts={msg.toolArtifacts}
                />
                <CertificateHoldArtifacts
                  artifacts={msg.toolArtifacts}
                  onOpenPolicyChange={
                    onOpenPolicyChange
                      ? (caseId) =>
                          onOpenPolicyChange(caseId as Id<"policyChangeCases">)
                      : undefined
                  }
                />
                {relatedEmailMessages.length > 0 ? (
                  <div className="mt-4">
                    <EmailStackCard
                      messages={relatedEmailMessages}
                      onOpen={onOpenEmail}
                      isOpenMessageId={openEmailMessageId}
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
                {regularToolCalls.length > 0 && showToolCalls && (
                  <ToolCallPanel toolCalls={regularToolCalls} />
                )}
                {subagentActivityCount > 0 && showSubagentActivity && (
                  <SubagentActivityPanel toolCalls={subagentToolCalls} />
                )}
              </>
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
      ? (msg.imessageParticipantLabel ??
        msg.userName ??
        msg.imessageSenderAddress ??
        "iMessage participant")
      : (msg.userName ?? msg.fromName ?? msg.fromEmail ?? "User");

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
    <div
      className={`flex items-start gap-2.5 max-w-lg w-fit ${isOwnMessage ? "ml-auto flex-row-reverse" : ""}`}
    >
      <div className="w-7 h-7 rounded-full bg-foreground/8 flex items-center justify-center shrink-0">
        <span className="text-label font-semibold text-foreground/60">
          {initials}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`flex items-center gap-2 mb-1 ${isOwnMessage ? "justify-end" : ""}`}
        >
          <p className="shrink-0 text-label font-medium text-muted-foreground/50">
            {displayName}
          </p>
          {isEmail && !collapseEmailMessages ? (
            <EmailRecipientMeta
              toAddresses={msg.toAddresses}
              ccAddresses={msg.ccAddresses}
            />
          ) : null}
          {channelIcon}
          <span className="text-muted-foreground/20">·</span>
          <span className="text-label text-muted-foreground/25">
            {time.format("MMM D, h:mm A")}
          </span>
        </div>
        {collapseEmailMessages && isEmail ? (
          <EmailSummaryCard
            message={msg}
            onOpen={onOpenEmail}
            isOpen={openEmailMessageId === msg._id}
          />
        ) : (
          <div
            className={`rounded-lg px-3.5 py-2.5 text-base text-foreground ${
              isEmail
                ? `border border-foreground/6 ${isOwnMessage ? "bg-foreground/[0.04]" : "bg-foreground/[0.02]"}`
                : isOwnMessage
                  ? "bg-foreground/[0.06]"
                  : "bg-foreground/[0.03]"
            }`}
          >
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {cleanContent}
            </p>
            {quoted && (
              <>
                <button
                  type="button"
                  onClick={() => setShowQuoted(!showQuoted)}
                  className="mt-1.5 text-label text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                >
                  {showQuoted ? "Hide quoted text ▴" : "Show quoted text ▾"}
                </button>
                {showQuoted && <QuotedContent text={quoted} />}
              </>
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-2">
                <ThreadAttachmentList
                  attachments={msg.attachments}
                  threadId={msg.threadId}
                />
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
function CancelButton({
  messageId,
  show,
}: {
  messageId: string;
  show: boolean;
}) {
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
      className="inline-flex h-5 items-center gap-1.5 text-label leading-5 text-muted-foreground/35 transition-colors hover:text-muted-foreground/60 disabled:opacity-50"
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
      {copied ? (
        <Check className="w-3 h-3 text-emerald-500" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  );
}

function TryAgainMessageButton({
  messageId,
}: {
  messageId: Id<"threadMessages">;
}) {
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
      className="inline-flex items-center gap-1.5 mt-2 ml-9.5 text-label text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors disabled:opacity-50"
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
      <ActionSurfaceLink
        href={href}
        className="inline-flex items-center gap-2 px-3 py-2 hover:border-foreground/10 max-w-sm"
      >
        <div className="w-6 h-6 rounded-md bg-foreground/[0.04] flex items-center justify-center shrink-0">
          <ClipboardList className="w-3.5 h-3.5 text-muted-foreground/50" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-label text-muted-foreground/40 font-medium leading-none mb-0.5">
            Quote
          </p>
          <p className="text-label text-foreground truncate">
            {context.summary}
          </p>
        </div>
      </ActionSurfaceLink>
    );
  }

  return null;
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
  const preview =
    message.text.trim() ||
    (message.files.length > 0
      ? `${message.files.length} attachment${message.files.length === 1 ? "" : "s"}`
      : "Message");
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-foreground/8 bg-card px-2.5 py-2">
      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
      <p className="min-w-0 flex-1 truncate text-label text-muted-foreground/55">
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
export function UnifiedThreadContent({
  threadId,
  onMeta,
  onRightPanel,
  viewerId,
  viewerEmail,
  agentBranding,
  policyChangeAccess,
}: {
  threadId: Id<"threads">;
  onMeta?: (meta: {
    detail: React.ReactNode;
    actions: React.ReactNode;
  }) => void;
  onRightPanel?: (panel: React.ReactNode | null) => void;
  viewerId?: string;
  viewerEmail?: string;
  agentHandle?: string;
  agentBranding?: { name: string; iconUrl?: string | null };
  policyChangeAccess: PolicyChangeAccess;
}) {
  const thread = useCachedQuery("threads.get.current", api.threads.get, {
    id: threadId,
  });
  const messages = useCachedQuery(
    "threads.messages.current",
    api.threads.messages,
    { threadId },
  ) as ThreadMessage[] | undefined;
  const sendMessage = useMutation(api.threads.sendMessage);
  const { appendOptimisticSend, markOptimisticSendFailed } =
    useThreadCacheActions();
  const updateTitle = useMutation(api.threads.updateTitle);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<GlassPromptInputHandle>(null);
  const prevThreadId = useRef<string | null>(null);
  const lastAutoOpenedEmailId = useRef<string | null>(null);
  const lastAutoOpenedPolicyChangeCaseId = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<PromptInputMessage | null>(
    null,
  );
  const [sendingQueuedNow, setSendingQueuedNow] = useState(false);
  const [openEmailMessageId, setOpenEmailMessageId] =
    useState<Id<"threadMessages"> | null>(null);
  const [openPolicyChangeCaseId, setOpenPolicyChangeCaseId] =
    useState<Id<"policyChangeCases"> | null>(null);
  const [openVendorComplianceArtifactRef, setOpenVendorComplianceArtifactRef] =
    useState<VendorComplianceArtifactRef | null>(null);
  const [openMailboxArtifactRef, setOpenMailboxArtifactRef] =
    useState<MailboxArtifactRef | null>(null);
  const openEmailMessage = useMemo(
    () =>
      messages?.find((message) => message._id === openEmailMessageId) ?? null,
    [messages, openEmailMessageId],
  );
  const openVendorComplianceArtifact = useMemo(() => {
    if (!openVendorComplianceArtifactRef) return null;
    const message = messages?.find(
      (candidate) =>
        candidate._id === openVendorComplianceArtifactRef.messageId,
    );
    const artifacts =
      message?.toolArtifacts?.filter(
        (artifact) => artifact.type === "vendor_compliance",
      ) ?? [];
    return artifacts[openVendorComplianceArtifactRef.index] ?? null;
  }, [messages, openVendorComplianceArtifactRef]);
  const openMailboxArtifact = useMemo(() => {
    if (!openMailboxArtifactRef) return null;
    const message = messages?.find(
      (candidate) => candidate._id === openMailboxArtifactRef.messageId,
    );
    const artifacts =
      message?.toolArtifacts?.filter(
        (artifact) => artifact.type === "mailbox_task",
      ) ?? [];
    const artifact = artifacts[openMailboxArtifactRef.index];
    return artifact
      ? { artifact, orgId: message?.orgId, threadId: message?.threadId }
      : null;
  }, [messages, openMailboxArtifactRef]);

  // Error state for chat — stored as { threadId, message } so switching threads auto-clears it
  const [chatErrorState, setChatErrorState] = useState<{
    threadId: string;
    message: string;
  } | null>(null);
  const chatError =
    chatErrorState?.threadId === threadId ? chatErrorState.message : null;
  const setChatError = useCallback(
    (msg: string | null) =>
      setChatErrorState(msg ? { threadId, message: msg } : null),
    [threadId],
  );

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
      openEmailMessage ? (
        <EmailThreadSidebar
          message={openEmailMessage}
          onClose={() => setOpenEmailMessageId(null)}
        />
      ) : openPolicyChangeCaseId ? (
        <PolicyChangeThreadSidebar
          caseId={openPolicyChangeCaseId}
          access={policyChangeAccess}
          onClose={() => setOpenPolicyChangeCaseId(null)}
        />
      ) : openVendorComplianceArtifact ? (
        <VendorComplianceSidebar
          artifact={openVendorComplianceArtifact}
          onClose={() => setOpenVendorComplianceArtifactRef(null)}
        />
      ) : openMailboxArtifact?.artifact &&
        openMailboxArtifact.orgId &&
        openMailboxArtifact.threadId ? (
        <MailboxTaskSidebar
          artifact={openMailboxArtifact.artifact}
          orgId={openMailboxArtifact.orgId}
          threadId={openMailboxArtifact.threadId}
          onClose={() => setOpenMailboxArtifactRef(null)}
        />
      ) : null,
    );
    return () => onRightPanel(null);
  }, [
    onRightPanel,
    openEmailMessage,
    openPolicyChangeCaseId,
    openVendorComplianceArtifact,
    openMailboxArtifact,
    policyChangeAccess,
  ]);

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
    el.scrollTo({
      top: el.scrollHeight,
      behavior: isNew ? "instant" : "smooth",
    });
  }, [threadId, messages?.length]);

  useEffect(() => {
    const latestDraftEmail = messages
      ?.filter(
        (message) =>
          message.channel === "email" &&
          message.role === "agent" &&
          message.status === "draft_email",
      )
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
      ?.filter(
        (message) => message.role === "agent" && message.policyChangeCaseId,
      )
      .at(-1);
    if (!latestPolicyChange?.policyChangeCaseId) return;
    if (
      lastAutoOpenedPolicyChangeCaseId.current ===
      latestPolicyChange.policyChangeCaseId
    )
      return;
    lastAutoOpenedPolicyChangeCaseId.current =
      latestPolicyChange.policyChangeCaseId;
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
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    }
  }, [messages]);

  const isAgentProcessing = useMemo(
    () =>
      messages?.some((m) => m.role === "agent" && m.status === "processing") ??
      false,
    [messages],
  );
  const isAwaitingAgent = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    const lastUserIndex = messages.reduce(
      (acc, m, i) => (m.role === "user" ? i : acc),
      -1,
    );
    const lastAgentIndex = messages.reduce(
      (acc, m, i) => (m.role === "agent" ? i : acc),
      -1,
    );
    return lastUserIndex > lastAgentIndex;
  }, [messages]);
  const isAgentActive = isAgentProcessing || isAwaitingAgent;
  const isInputBusy = isSubmitting || sendingQueuedNow;
  const inputBusyLabel = "Sending";

  const sendThreadMessage = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text && message.files.length === 0) return;
      if (!thread) return;
      setIsSubmitting(true);
      const content = text || "(attached files)";
      const clientMutationId = createClientMutationId("message");
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
      const optimisticAttachments =
        message.files.length > 0
          ? message.files.map((file) => ({
              filename: file.filename ?? "file",
              contentType: inferAttachmentContentType(
                file.filename,
                file.mediaType,
              ),
              size: 0,
            }))
          : undefined;

      try {
        await appendOptimisticSend({
          threadId,
          orgId: thread.orgId,
          content,
          clientMutationId,
          userId: viewerId as Id<"users"> | undefined,
          userName: viewerEmail ?? "You",
          attachments: optimisticAttachments,
          referencedPolicyIds,
          referencedQuoteIds,
          referencedRequirementIds,
          referencedMailboxIds,
        });
        setChatError(null);

        // Upload files first if any
        const attachments: {
          filename: string;
          contentType: string;
          size: number;
          fileId: Id<"_storage">;
        }[] = [];
        if (message.files.length > 0) {
          for (const file of message.files) {
            const url = await generateUploadUrl();
            const blob = await fetch(file.url).then((r) => r.blob());
            const contentType = inferAttachmentContentType(
              file.filename,
              file.mediaType,
            );
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": contentType },
              body: blob,
            });
            if (res.ok) {
              const { storageId } = await res.json();
              attachments.push({
                filename: file.filename ?? "file",
                contentType,
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
            content,
            attachments,
            referencedPolicyIds,
            referencedQuoteIds,
            referencedRequirementIds,
            referencedMailboxIds,
            clientMutationId,
          });
          return;
        }

        // For text-only messages, send via Convex (processThreadChat handles the response)
        await sendMessage({
          threadId,
          content,
          referencedPolicyIds,
          referencedQuoteIds,
          referencedRequirementIds,
          referencedMailboxIds,
          clientMutationId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to send message";
        await markOptimisticSendFailed({
          threadId,
          clientMutationId,
          error: message,
        });
        setChatError(message);
        toast.error("Failed to send message");
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      appendOptimisticSend,
      generateUploadUrl,
      markOptimisticSendFailed,
      sendMessage,
      setChatError,
      thread,
      threadId,
      viewerEmail,
      viewerId,
    ],
  );

  const handleSend = useCallback(
    (message: PromptInputMessage) => {
      if (isAgentActive) {
        setQueuedMessage(message);
        return;
      }
      if (isInputBusy) return;
      void sendThreadMessage(message);
    },
    [isAgentActive, isInputBusy, sendThreadMessage],
  );

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
    if (!queuedMessage || isAgentActive || isSubmitting || sendingQueuedNow)
      return;
    const message = queuedMessage;
    const timeout = window.setTimeout(() => {
      setQueuedMessage(null);
      void sendThreadMessage(message);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    isAgentActive,
    isSubmitting,
    queuedMessage,
    sendThreadMessage,
    sendingQueuedNow,
  ]);

  const collapseEmailMessages = thread?.originChannel !== "email";

  if (!thread) {
    return <div className="h-full" />;
  }

  return (
    <div className="relative h-full">
      {/* Messages — full height, content scrolls under the input overlay */}
      <div
        ref={messagesRef}
        className="absolute inset-0 overflow-y-auto scrollbar-hide p-4 pr-5"
      >
        <div className="max-w-2xl mx-auto space-y-4">
          {messages && messages.length === 0 && (
            <NewChatEmptyState
              orgId={thread.orgId}
              onSelectPrompt={(prompt) =>
                chatInputRef.current?.setValueAndFocus(prompt)
              }
            />
          )}
          {(() => {
            const threadMessages = messages ?? [];
            const firstUserIdx = threadMessages.findIndex(
              (m) => m.role === "user",
            );
            const attachedEmailMessageIds = new Set<string>();
            const hiddenStatusMessageIds = new Set<string>();
            const relatedEmailsByMessageId = new Map<string, ThreadMessage[]>();
            threadMessages.forEach((message, idx) => {
              if (isImessageSyncMessage(message)) {
                hiddenStatusMessageIds.add(message._id);
                return;
              }
              if (
                hasEarlierIdenticalAgentMessage(threadMessages, message, idx)
              ) {
                hiddenStatusMessageIds.add(message._id);
                return;
              }
              if (hasLaterEmailSendCompletion(threadMessages, message, idx)) {
                hiddenStatusMessageIds.add(message._id);
                return;
              }
              const relatedEmailMessages = findRelatedEmailMessages(
                threadMessages,
                message,
                idx,
                attachedEmailMessageIds,
              );
              if (relatedEmailMessages.length > 0) {
                relatedEmailsByMessageId.set(message._id, relatedEmailMessages);
                relatedEmailMessages.forEach((emailMessage) =>
                  attachedEmailMessageIds.add(emailMessage._id),
                );
              }
            });
            return threadMessages.map((msg, idx) => {
              if (hiddenStatusMessageIds.has(msg._id)) return null;
              if (attachedEmailMessageIds.has(msg._id)) return null;
              const isFirstUser = idx === firstUserIdx;
              const firstUserIsOwn =
                isFirstUser &&
                ((viewerId && msg.userId === viewerId) ||
                  (viewerEmail &&
                    msg.fromEmail?.toLowerCase() ===
                      viewerEmail.toLowerCase()));
              const relatedEmailMessages = relatedEmailsByMessageId.get(
                msg._id,
              );

              return (
                <div key={msg._id}>
                  <UnifiedMessageBubble
                    msg={msg}
                    relatedEmailMessages={relatedEmailMessages}
                    viewerId={viewerId}
                    viewerEmail={viewerEmail}
                    mirroredToImessage={
                      thread.originChannel === "imessage" &&
                      msg.channel === "chat"
                    }
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
                    openVendorComplianceArtifactRef={
                      openVendorComplianceArtifactRef
                    }
                    onOpenMailboxArtifact={(ref) => {
                      setOpenEmailMessageId(null);
                      setOpenPolicyChangeCaseId(null);
                      setOpenVendorComplianceArtifactRef(null);
                      setOpenMailboxArtifactRef(ref);
                    }}
                    openMailboxArtifactRef={openMailboxArtifactRef}
                  />
                  {isFirstUser && thread?.initialContext && (
                    <div
                      className={`mt-2 flex ${firstUserIsOwn ? "justify-end mr-9.5" : "ml-9.5"}`}
                    >
                      <ThreadContextLink context={thread.initialContext} />
                    </div>
                  )}
                </div>
              );
            });
          })()}
          {chatError && (
            <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">
              {chatError}
            </div>
          )}
          {/* Padding so last message clears the input overlay */}
          {messages && messages.length > 0 && <div className="h-40" />}
        </div>
      </div>
      {/* Input — overlaid at bottom, content scrolls under it */}
      <ChatInputOverlay>
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
