"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import dayjs from "dayjs";
import { Asterisk, Loader2, Paperclip, FileText, Download, Mail as MailIcon } from "lucide-react";
import { ContextReferenceCard } from "@/components/context-reference-card";
import { PROSE_MARKDOWN_STYLES, PROSE_MARKDOWN_COMPACT_STYLES } from "@/components/prose-markdown";
import { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";

export type ConversationAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
};

export type Conversation = {
  _id: Id<"agentConversations">;
  _creationTime: number;
  subject: string;
  fromEmail: string;
  fromName?: string;
  toAddresses: string[];
  ccAddresses?: string[];
  mode: "direct" | "cc" | "forward" | "unknown";
  status: string;
  body: string;
  responseBody?: string;
  responseTo?: string;
  responseCc?: string[];
  responseSentAt?: number;
  error?: string;
  archivedAt?: number;
  threadId?: Id<"agentConversations">;
  attachments?: ConversationAttachment[];
};

/**
 * Split email body into the new content and the quoted reply.
 * Looks for "On ... wrote:" pattern or consecutive ">" lines.
 */
export function splitQuotedReply(body: string): { content: string; quoted: string | null } {
  const onWroteMatch = body.match(/\r?\n\s*On [\s\S]+?wrote:\s*\r?\n/);
  if (onWroteMatch && onWroteMatch.index !== undefined) {
    const content = body.slice(0, onWroteMatch.index).trimEnd();
    const quoted = body.slice(onWroteMatch.index).trim();
    return { content, quoted };
  }

  const lines = body.split("\n");
  let quoteStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*>/.test(lines[i])) {
      quoteStart = i;
    } else if (quoteStart < lines.length) {
      break;
    }
  }

  if (quoteStart < lines.length) {
    const content = lines.slice(0, quoteStart).join("\n").trimEnd();
    const quoted = lines.slice(quoteStart).join("\n").trim();
    return { content, quoted };
  }

  return { content: body, quoted: null };
}

/** Strip the agent signature block from quoted text */
export function stripSignature(text: string): string {
  return text.replace(/\n\s*(?:—|-- )\s*\n[\s\S]*$/, "").trimEnd();
}

export function stripAttribution(text: string): string {
  return text.replace(/^\s*On [\s\S]+?wrote:\s*\n?/, "").trimStart();
}

const QUOTED_MARKDOWN_STYLES = PROSE_MARKDOWN_COMPACT_STYLES + " [&_a]:text-blue-500/60 [&_a]:underline";

export function QuotedContent({ text }: { text: string }) {
  const cleaned = stripAttribution(stripSignature(text));
  const lines = cleaned.split("\n");

  type Block = { depth: number; lines: string[] };
  const blocks: Block[] = [];

  for (const line of lines) {
    const match = line.match(/^(>\s*)+/);
    const depth = match ? (match[0].match(/>/g) || []).length : 0;
    const content = depth > 0 ? line.replace(/^(>\s*)+/, "") : line;

    const last = blocks[blocks.length - 1];
    if (last && last.depth === depth) {
      last.lines.push(content);
    } else {
      blocks.push({ depth, lines: [content] });
    }
  }

  return (
    <div className="text-body-sm text-muted-foreground/50 mt-3 space-y-1">
      {blocks.map((block, i) => {
        const blockText = block.lines.join("\n").trim();
        if (!blockText) return null;

        if (block.depth === 0) {
          return (
            <div key={i} className={`text-muted-foreground/40 ${QUOTED_MARKDOWN_STYLES}`}>
              <Markdown>{blockText}</Markdown>
            </div>
          );
        }

        let el = (
          <div key={i} className={QUOTED_MARKDOWN_STYLES}>
            <Markdown>{blockText}</Markdown>
          </div>
        );
        for (let d = 0; d < block.depth; d++) {
          el = (
            <div key={`${i}-${d}`} className="pl-3 ml-0.5 border-l-2 border-foreground/8">
              {el}
            </div>
          );
        }
        return el;
      })}
    </div>
  );
}

/**
 * Unwrap hard line breaks from email plain text (RFC 2822 wraps at ~76 chars).
 * Preserves intentional breaks: blank lines (paragraphs), list items, signatures, headers.
 */
function unwrapEmailText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let buffer = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Empty line = paragraph break — flush buffer and keep the blank line
    if (trimmed === "") {
      if (buffer) {
        result.push(buffer);
        buffer = "";
      }
      result.push("");
      continue;
    }

    // Lines that should start a new line (not be joined to previous):
    // - List items (1. / - / * / •)
    // - Lines starting with dashes (signature, forwarded msg separators)
    // - Lines that look like headers (From:, To:, Date:, Subject:, CC:)
    const isStructural =
      /^\s*(\d+[.)]\s|[-*•]\s|[-]{3,}|[A-Z][a-z]*:\s)/.test(trimmed);

    if (isStructural) {
      if (buffer) {
        result.push(buffer);
        buffer = "";
      }
      buffer = trimmed;
      continue;
    }

    // Join to previous line if it looks like a soft wrap
    if (buffer) {
      buffer += " " + trimmed;
    } else {
      buffer = trimmed;
    }
  }

  if (buffer) result.push(buffer);

  return result.join("\n");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentChip({
  attachment,
  onOpenPdf,
}: {
  attachment: ConversationAttachment;
  onOpenPdf?: (url: string) => void;
}) {
  const url = useQuery(
    api.agentConversations.getAttachmentUrl,
    attachment.fileId ? { fileId: attachment.fileId } : "skip",
  );
  const isPdf = attachment.contentType === "application/pdf";

  const handleClick = (e: React.MouseEvent) => {
    if (isPdf && url && onOpenPdf) {
      e.preventDefault();
      onOpenPdf(url);
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
          ? "border-foreground/10 bg-white/80 dark:bg-white/[0.04] hover:bg-foreground/[0.03] hover:border-foreground/15 cursor-pointer"
          : "border-foreground/6 bg-foreground/[0.02] text-muted-foreground/40 pointer-events-none"
      }`}
    >
      {isPdf ? (
        <FileText className="w-3.5 h-3.5 text-red-400 shrink-0" />
      ) : (
        <Paperclip className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
      )}
      <span className="truncate max-w-[180px] text-foreground/80">{attachment.filename}</span>
      <span className="text-muted-foreground/40 shrink-0">{formatFileSize(attachment.size)}</span>
      {url && !isPdf && <Download className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
    </a>
  );
}

/* ── Single message bubble ── */
export function MessageBubble({ conv, onOpenPdf, onRetry, viewerEmail }: { conv: Conversation; onOpenPdf?: (url: string) => void; onRetry?: (convId: Id<"agentConversations">) => void; viewerEmail?: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { content: rawContent, quoted } = splitQuotedReply(conv.body || "");
  const content = rawContent ? unwrapEmailText(rawContent) : rawContent;

  const isViewerMessage = viewerEmail && conv.fromEmail?.toLowerCase() === viewerEmail.toLowerCase();

  return (
    <>
      {/* Inbound message */}
      <div className={`max-w-lg ${isViewerMessage ? "ml-auto" : ""}`}>
        <div className="mb-2">
          <div className="flex items-center justify-between">
            <span className="text-label-sm font-medium text-muted-foreground">
              {conv.fromName ?? conv.fromEmail}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <MailIcon className="w-3 h-3 text-muted-foreground/30" />
              <span className="text-[11px] text-muted-foreground/30">Email</span>
              <span className="text-muted-foreground/20 mx-0.5">·</span>
              <span className="text-[11px] text-muted-foreground/30">
                {dayjs(conv._creationTime).format("MMM D, h:mm A")}
              </span>
            </div>
          </div>
          {!isViewerMessage && (
          <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground/35 mt-0.5">
            <span className="truncate">
              <span className="text-muted-foreground/25">To:</span>{" "}
              {conv.toAddresses.join(", ")}
            </span>
            {conv.ccAddresses && conv.ccAddresses.length > 0 && (
              <span className="truncate">
                <span className="text-muted-foreground/25">CC:</span>{" "}
                {conv.ccAddresses.join(", ")}
              </span>
            )}
          </div>
          )}
        </div>
        <div className={`rounded-lg border border-foreground/6 p-4 ${isViewerMessage ? "bg-foreground/[0.04]" : "bg-foreground/[0.02]"}`}>
          {content ? (
            <p className="text-body-sm text-foreground whitespace-pre-wrap">{content}</p>
          ) : (
            <p className="text-muted-foreground/40 italic text-body-sm">Unable to display message</p>
          )}
          {quoted && (
            <>
              <button
                type="button"
                onClick={() => setShowQuoted(!showQuoted)}
                className="mt-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer"
              >
                {showQuoted ? "Hide quoted text \u25B4" : "Show quoted text \u25BE"}
              </button>
              {showQuoted && (
                <QuotedContent text={quoted} />
              )}
            </>
          )}
          {conv.attachments && conv.attachments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-foreground/6 flex flex-wrap gap-2">
              {conv.attachments.map((att, i) => (
                <AttachmentChip key={i} attachment={att} onOpenPdf={onOpenPdf ? (url) => onOpenPdf(url) : undefined} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent response */}
      {conv.status === "processing" && (
        <div className="flex items-center gap-2 py-2 justify-end">
          <span className="text-label-sm text-muted-foreground">Prism is thinking...</span>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        </div>
      )}

      {conv.responseBody && (
        <div className="max-w-lg ml-auto">
          <div className="mb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Asterisk className="w-3.5 h-3.5 text-primary-light" />
                <span className="text-label-sm font-medium text-muted-foreground leading-none">
                  Prism
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <MailIcon className="w-3 h-3 text-muted-foreground/30" />
                <span className="text-[11px] text-muted-foreground/30">Email</span>
                <span className="text-muted-foreground/20 mx-0.5">·</span>
                <span className="text-[11px] text-muted-foreground/30">
                  {conv.responseSentAt
                    ? dayjs(conv.responseSentAt).format("MMM D, h:mm A")
                    : ""}
                </span>
              </div>
            </div>
            {conv.responseTo && (
              <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground/35 mt-0.5">
                <span className="truncate">
                  <span className="text-muted-foreground/25">To:</span>{" "}
                  {conv.responseTo}
                </span>
                {conv.responseCc && conv.responseCc.length > 0 && (
                  <span className="truncate">
                    <span className="text-muted-foreground/25">CC:</span>{" "}
                    {conv.responseCc.join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className={`rounded-lg bg-popover border border-foreground/6 p-4 text-foreground ${PROSE_MARKDOWN_STYLES} [&_a]:text-blue-600 [&_a]:underline`}>
              <Markdown remarkPlugins={[remarkBreaks]} components={{
                a: ({ href, children }) => {
                  if (href?.startsWith("/policies/") || href?.startsWith("/quotes/")) {
                    return <ContextReferenceCard href={href}>{children}</ContextReferenceCard>;
                  }
                  return <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">{children}</a>;
                },
              }}>{conv.responseBody}</Markdown>
          </div>
        </div>
      )}

      {conv.status === "error" && (
        <div className="rounded-lg bg-red-50/50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 p-3 flex items-start justify-between gap-3">
          <p className="text-label-sm text-red-600 dark:text-red-400">
            {conv.error ?? "An error occurred processing this message."}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(conv._id)}
              className="shrink-0 text-label-sm font-medium text-red-600 hover:text-red-800 underline underline-offset-2 cursor-pointer"
            >
              Retry
            </button>
          )}
        </div>
      )}

    </>
  );
}
