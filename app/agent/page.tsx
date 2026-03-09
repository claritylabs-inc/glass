"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { AgentHandleForm } from "@/components/agent-handle-form";
import Markdown from "react-markdown";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Mail,
  Copy,
  Check,
  MessageSquare,
  Users,
  Forward,
  Asterisk,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Loader2,
  X,
  Settings,
  HelpCircle,
  FileText,
} from "lucide-react";
import { Id } from "@/convex/_generated/dataModel";

dayjs.extend(relativeTime);

const AGENT_DOMAIN = "agent.claritylabs.inc";

type Conversation = {
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
};

type Thread = {
  root: Conversation;
  messages: Conversation[];
  latestTime: number;
};

function ModeBadge({ mode }: { mode: "direct" | "cc" | "forward" | "unknown" }) {
  const styles = {
    direct: "bg-violet-50 text-violet-600",
    cc: "bg-sky-50 text-sky-600",
    forward: "bg-teal-50 text-teal-600",
    unknown: "bg-amber-50 text-amber-600",
  };
  const labels = { direct: "Direct", cc: "CC", forward: "Forward", unknown: "Unknown" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[mode]}`}>
      {labels[mode]}
    </span>
  );
}

/* ── Thread list item ── */
function ThreadItem({
  thread,
  isSelected,
  onSelect,
}: {
  thread: Thread;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const root = thread.root;
  const [timeAgo] = useState(() => dayjs(thread.latestTime).fromNow());

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 border-b border-foreground/6 transition-colors cursor-pointer ${
        isSelected
          ? "bg-foreground/[0.04]"
          : "hover:bg-foreground/[0.02]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-body-sm font-medium text-foreground truncate flex-1">
          {root.subject}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {thread.messages.length > 1 && (
            <span className="text-[11px] text-muted-foreground/40 font-medium">
              {thread.messages.length}
            </span>
          )}
          <ModeBadge mode={root.mode} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-label-sm text-muted-foreground/50 truncate flex-1">
          {root.fromName ?? root.fromEmail}
        </span>
        <span className="text-[11px] text-muted-foreground/30 shrink-0">{timeAgo}</span>
      </div>
    </button>
  );
}

/**
 * Split email body into the new content and the quoted reply.
 * Looks for "On ... wrote:" pattern or consecutive ">" lines.
 */
function splitQuotedReply(body: string): { content: string; quoted: string | null } {
  // Match "On <date>... wrote:" and everything after (may span multiple lines)
  const onWroteMatch = body.match(/\r?\n\s*On [\s\S]+?wrote:\s*\r?\n/);
  if (onWroteMatch && onWroteMatch.index !== undefined) {
    const content = body.slice(0, onWroteMatch.index).trimEnd();
    const quoted = body.slice(onWroteMatch.index).trim();
    return { content, quoted };
  }

  // Fallback: trailing block of ">" quoted lines
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
function stripSignature(text: string): string {
  // Match standalone "—" or "-- " signature delimiter and everything after
  return text.replace(/\n\s*(?:—|-- )\s*\n[\s\S]*$/, "").trimEnd();
}

const QUOTED_MARKDOWN_STYLES = "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:my-0.5 [&_a]:text-blue-500/60 [&_a]:underline";

/**
 * Render quoted text with proper nesting.
 * Strips ">" prefixes and groups consecutive lines at the same depth,
 * rendering each depth level with a left border. Markdown is rendered.
 */
function stripAttribution(text: string): string {
  // Remove "On <date>... wrote:" header line(s), may span multiple lines
  return text.replace(/^\s*On [\s\S]+?wrote:\s*\n?/, "").trimStart();
}

function QuotedContent({ text }: { text: string }) {
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

/* ── Single message bubble ── */
function MessageBubble({ conv }: { conv: Conversation }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { content, quoted } = splitQuotedReply(conv.body || "");

  return (
    <>
      {/* Inbound message */}
      <div className="mr-8">
        <div className="mb-2">
          <div className="flex items-center justify-between">
            <span className="text-label-sm font-medium text-muted-foreground">
              {conv.fromName ?? conv.fromEmail}
            </span>
            <span className="text-[11px] text-muted-foreground/30 shrink-0">
              {dayjs(conv._creationTime).format("MMM D, h:mm A")}
            </span>
          </div>
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
        </div>
        <div className="rounded-lg bg-foreground/[0.02] border border-foreground/6 p-4">
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
                className="mt-2 px-1.5 py-0.5 rounded bg-foreground/[0.04] border border-foreground/6 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-foreground/[0.06] transition-colors cursor-pointer"
              >
                {showQuoted ? "Hide quoted text" : "Show quoted text"}
              </button>
              {showQuoted && (
                <QuotedContent text={quoted} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Agent response */}
      {conv.status === "processing" && (
        <div className="flex items-center gap-2 py-2 justify-end">
          <span className="text-label-sm text-muted-foreground">Clarity Agent is thinking...</span>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        </div>
      )}

      {conv.responseBody && (
        <div className="ml-8">
          <div className="mb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Asterisk className="w-3.5 h-3.5 text-[#A0D2FA]" />
                <span className="text-label-sm font-medium text-muted-foreground leading-none">
                  Clarity Agent
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground/30 shrink-0">
                {conv.responseSentAt
                  ? dayjs(conv.responseSentAt).format("MMM D, h:mm A")
                  : ""}
              </span>
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
          <div className="rounded-lg bg-white border border-foreground/6 p-4 text-body-sm text-foreground [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:my-0.5 [&_a]:text-blue-600 [&_a]:underline [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-body-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-body-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 leading-relaxed">
            <Markdown>{conv.responseBody}</Markdown>
          </div>
        </div>
      )}

      {conv.status === "error" && (
        <div className="rounded-lg bg-red-50/50 border border-red-100 p-3">
          <p className="text-label-sm text-red-600">
            {conv.error ?? "An error occurred processing this message."}
          </p>
        </div>
      )}
    </>
  );
}

/* ── Thread detail panel ── */
function ThreadDetail({
  thread,
  onBack,
  onClose,
}: {
  thread: Thread;
  onBack?: () => void;
  onClose?: () => void;
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground/6 shrink-0">
        {onBack && (
          <PillButton variant="icon" onClick={onBack} className="lg:hidden">
            <ArrowLeft className="w-4 h-4" />
          </PillButton>
        )}
        <div className="flex-1 min-w-0">
          <h4 className="!mb-0 text-body-sm font-semibold truncate">{root.subject}</h4>
          <p className="text-label-sm text-muted-foreground/50 truncate">
            {root.fromName ? `${root.fromName} <${root.fromEmail}>` : root.fromEmail}
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <ModeBadge mode={root.mode} />
          {thread.messages.length > 1 && (
            <span className="text-[11px] text-muted-foreground/40">
              {thread.messages.length} messages
            </span>
          )}
          <PillButton variant="icon" onClick={handleArchiveToggle} label={isArchived ? "Unarchive" : "Archive"}>
            {isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          </PillButton>
          {onClose && (
            <PillButton variant="icon" onClick={onClose} className="hidden lg:flex">
              <X className="w-4 h-4" />
            </PillButton>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 pr-5 pb-20 space-y-4">
        {thread.messages.map((msg) => (
          <MessageBubble key={msg._id} conv={msg} />
        ))}
      </div>
    </div>
  );
}

/* ── Mode explainer cards ── */
function ModeExplainerCards({ companyDomains }: { companyDomains?: string[] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-violet-600" />
            <h4 className="!mb-0 text-body-sm font-semibold">Direct Mode</h4>
          </div>
          <p className="text-label-sm text-muted-foreground/60">
            Email the agent directly for internal policy questions.
            Answers include links to policy sections in the app.
          </p>
        </div>
        <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-sky-600" />
            <h4 className="!mb-0 text-body-sm font-semibold">CC Mode</h4>
          </div>
          <p className="text-label-sm text-muted-foreground/60">
            CC the agent on a reply to a customer. The agent replies to all
            participants in a professional, customer-facing tone.
          </p>
        </div>
        <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Forward className="w-4 h-4 text-teal-600" />
            <h4 className="!mb-0 text-body-sm font-semibold">Forward Mode</h4>
          </div>
          <p className="text-label-sm text-muted-foreground/60">
            Forward a customer email to the agent. The agent replies directly
            to the original sender with you CC&#39;d.
          </p>
        </div>
        <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
          <div className="flex items-center gap-2 mb-2">
            <HelpCircle className="w-4 h-4 text-amber-600" />
            <h4 className="!mb-0 text-body-sm font-semibold">Unknown Mode</h4>
          </div>
          <p className="text-label-sm text-muted-foreground/60">
            Emails the agent can&#39;t confidently classify are forwarded to you
            for review. The agent won&#39;t reply until you respond.
          </p>
        </div>
      </div>
      {companyDomains ? (
        <p className="text-label-sm text-muted-foreground/40">
          Your company {companyDomains.length === 1 ? "domain" : "domains"}:{" "}
          {companyDomains.map((d, i) => (
            <span key={d}>
              {i > 0 && ", "}
              <span className="font-mono text-muted-foreground/60">@{d}</span>
            </span>
          ))}
          {" "}— emails from {companyDomains.length === 1 ? "this domain" : "these domains"} are treated as internal.
        </p>
      ) : (
        <p className="text-label-sm text-muted-foreground/30">
          Set your company website in your profile to enable automatic internal email detection.
        </p>
      )}
    </div>
  );
}

/* ── Detailed help section for settings ── */
function AgentHelpSection({ agentEmail }: { agentEmail: string }) {
  const faqs = [
    {
      q: "How does the agent decide which mode to use?",
      a: "The agent checks where it appears in the email. If it's in the CC field, it uses CC mode. If an internal user (same company domain) forwards an email (subject starts with \"Fwd:\"), it uses Forward mode. If the agent is the sole direct recipient, it uses Direct mode.",
    },
    {
      q: "What does the customer see when I CC the agent?",
      a: "The agent replies to all participants on the thread in a professional, customer-facing tone. It does not include any links to the app -- those are only visible to internal users in Direct mode.",
    },
    {
      q: "What happens when I forward a customer email?",
      a: "The agent extracts the original sender from the forwarded message and replies directly to them, threading the reply into their original conversation. You are automatically CC'd on the reply so you can follow along.",
    },
    {
      q: "How does threading work?",
      a: "The agent uses email headers (In-Reply-To, References) to thread replies into existing conversations. For forwards, it threads into the original sender's conversation, not the forwarded message. Subject-line matching is used as a fallback.",
    },
    {
      q: "What if the agent can't find the original sender in a forward?",
      a: "If the forwarded email body doesn't contain a recognizable \"From:\" line (Gmail, Outlook, and Apple Mail formats are supported), the agent falls back to replying to you directly -- it won't send an email to the wrong person.",
    },
    {
      q: "What happens when the agent can't classify an email?",
      a: "It forwards the email to you and asks for guidance. No reply is sent to the original sender until you respond yourself.",
    },
    {
      q: "Can external people email the agent directly?",
      a: "If someone outside your company emails the agent as the sole recipient, the agent can't confidently classify it and will forward it to you for review instead of auto-replying.",
    },
    {
      q: "How does the agent know who is internal?",
      a: "It matches the sender's email domain against your company website domain. Set your company website in your profile to enable this. Consumer domains (gmail.com, outlook.com, etc.) are never treated as company domains.",
    },
  ];

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
      <h4 className="!mb-4 text-body-sm font-semibold">How it works</h4>
      <div className="space-y-4">
        {faqs.map((faq, i) => (
          <div key={i}>
            <p className="text-body-sm font-medium text-foreground mb-1">{faq.q}</p>
            <p className="text-label-sm text-muted-foreground/60 leading-relaxed">{faq.a}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 pt-4 border-t border-foreground/6">
        <p className="text-label-sm text-muted-foreground/40">
          Your agent address: <span className="font-mono text-muted-foreground/60">{agentEmail}</span>
        </p>
      </div>
    </div>
  );
}

/* ── COI Request Handling settings ── */
function CoiSettingsCard({
  coiHandling,
  hasBroker,
}: {
  coiHandling: "broker" | "user" | "ignore" | undefined;
  hasBroker: boolean;
}) {
  const updateProfile = useMutation(api.users.updateProfile);
  const current = coiHandling ?? "ignore";

  async function handleChange(value: "broker" | "user" | "ignore") {
    try {
      await updateProfile({ coiHandling: value });
      toast.success("COI handling updated");
    } catch {
      toast.error("Failed to update COI handling");
    }
  }

  const options: { value: "broker" | "user" | "ignore"; label: string; description: string; icon: typeof FileText; disabled?: boolean }[] = [
    {
      value: "broker",
      label: "Include broker contact",
      description: hasBroker ? "Direct COI requests to your broker" : "Set up your broker in Profile first",
      icon: Users,
      disabled: !hasBroker,
    },
    {
      value: "user",
      label: "Include your contact",
      description: "Direct COI requests to you",
      icon: MessageSquare,
    },
    {
      value: "ignore",
      label: "Ignore",
      description: "No special COI handling",
      icon: X,
    },
  ];

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <h4 className="!mb-0 text-body-sm font-semibold">COI Request Handling</h4>
      </div>
      <p className="text-label-sm text-muted-foreground/60 mb-4">
        How should the agent respond when someone requests a Certificate of Insurance?
      </p>
      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            onClick={() => handleChange(opt.value)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left cursor-pointer ${
              current === opt.value
                ? "border-foreground/15 bg-foreground/[0.03]"
                : "border-foreground/6 hover:border-foreground/10 hover:bg-foreground/[0.01]"
            } ${opt.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
              current === opt.value ? "border-foreground" : "border-foreground/20"
            }`}>
              {current === opt.value && (
                <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-label-sm text-muted-foreground/50">{opt.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Conversations panel (shared between desktop and mobile) ── */
function ConversationsPanel({
  threads,
  selectedThread,
  selectedId,
  setSelectedId,
  showArchived,
  setShowArchived,
  agentEmail,
}: {
  threads: Thread[] | undefined;
  selectedThread: Thread | undefined;
  selectedId: Id<"agentConversations"> | null;
  setSelectedId: (id: Id<"agentConversations"> | null) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  agentEmail: string | null;
}) {
  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
      {/* Desktop: sidebar + detail */}
      <div className="hidden lg:flex" style={{ height: "calc(100dvh - 10rem)" }}>
        {/* Sidebar */}
        <div className="w-80 shrink-0 border-r border-foreground/6 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/6">
            <h4 className="!mb-0 text-body-sm font-semibold">Conversations</h4>
            <button
              type="button"
              onClick={() => { setShowArchived(!showArchived); setSelectedId(null); }}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
            >
              {showArchived ? "Show Active" : "Show Archived"}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads === undefined ? (
              <div className="px-4 py-8 text-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/30 mx-auto" />
              </div>
            ) : threads.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-label-sm text-muted-foreground/40">
                  {showArchived ? "No archived conversations" : "No conversations yet"}
                </p>
              </div>
            ) : (
              threads.map((thread) => (
                <ThreadItem
                  key={thread.root._id}
                  thread={thread}
                  isSelected={selectedThread?.root._id === thread.root._id}
                  onSelect={() => setSelectedId(thread.root._id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0">
          {selectedThread ? (
            <ThreadDetail
              thread={selectedThread}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Mail className="w-8 h-8 text-muted-foreground/15 mx-auto mb-2" />
                <p className="text-body-sm text-muted-foreground/40">
                  Select a conversation
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: stacked list or detail */}
      <div className="lg:hidden">
        {selectedThread ? (
          <div style={{ height: "calc(100dvh - 10rem)" }}>
            <ThreadDetail
              thread={selectedThread}
              onBack={() => setSelectedId(null)}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/6">
              <h4 className="!mb-0 text-body-sm font-semibold">Conversations</h4>
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
              >
                {showArchived ? "Show Active" : "Show Archived"}
              </button>
            </div>
            {threads === undefined ? (
              <div className="px-4 py-8 text-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/30 mx-auto" />
              </div>
            ) : threads.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Mail className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-body-sm text-muted-foreground/50">
                  {showArchived ? "No archived conversations" : "No conversations yet"}
                </p>
                {!showArchived && agentEmail && (
                  <p className="text-label-sm text-muted-foreground/30 mt-1">
                    Send an email to {agentEmail} to get started
                  </p>
                )}
              </div>
            ) : (
              threads.map((thread) => (
                <ThreadItem
                  key={thread.root._id}
                  thread={thread}
                  isSelected={false}
                  onSelect={() => setSelectedId(thread.root._id)}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Tab bar ── */
const AGENT_TABS = [
  { id: "conversations", label: "Conversations", icon: MessageSquare },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type AgentTab = typeof AGENT_TABS[number]["id"];

/* ── Main page ── */
export default function AgentPage() {
  const viewer = useQuery(api.users.viewer);
  const [showArchived, setShowArchived] = useState(false);
  const conversations = useQuery(api.agentConversations.list, { archived: showArchived });
  const [selectedId, setSelectedId] = useState<Id<"agentConversations"> | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentTab>("conversations");
  const [helpDismissed, setHelpDismissed] = useState(false);

  useEffect(() => {
    try { setHelpDismissed(localStorage.getItem("agent-help-dismissed") === "1"); } catch {}
  }, []);

  const handle = viewer?.agentHandle;
  const agentEmail = handle ? `${handle}@${AGENT_DOMAIN}` : null;

  // Derive company domains for display
  const companyDomains = useMemo(() => {
    if (!viewer) return undefined;
    const consumerDomains = new Set([
      "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
      "outlook.com", "hotmail.com", "live.com", "msn.com",
      "aol.com", "icloud.com", "me.com", "mac.com",
      "protonmail.com", "proton.me", "zoho.com", "mail.com",
      "ymail.com", "gmx.com", "gmx.net",
    ]);
    const domains: string[] = [];
    if (viewer.companyWebsite) {
      try {
        const hostname = new URL(viewer.companyWebsite).hostname.replace(/^www\./, "");
        if (!consumerDomains.has(hostname)) domains.push(hostname);
      } catch { /* ignore */ }
    }
    if (viewer.email) {
      const domain = viewer.email.split("@")[1]?.toLowerCase();
      if (domain && !consumerDomains.has(domain) && !domains.includes(domain)) {
        domains.push(domain);
      }
    }
    return domains.length > 0 ? domains : undefined;
  }, [viewer]);

  // Group conversations into threads
  const threads = useMemo(() => {
    if (!conversations) return undefined;
    const convs = conversations as unknown as Conversation[];
    const threadMap = new Map<string, Thread>();

    for (const conv of convs) {
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
          root: conv.threadId ? convs.find((c) => c._id === conv.threadId) ?? conv : conv,
          messages: [conv],
          latestTime: conv._creationTime,
        });
      }
    }

    // Sort messages within each thread chronologically
    for (const thread of threadMap.values()) {
      thread.messages.sort((a, b) => a._creationTime - b._creationTime);
      if (!thread.messages.find((m) => m._id === thread.root._id)) {
        thread.messages.unshift(thread.root);
      }
    }

    return Array.from(threadMap.values()).sort((a, b) => b.latestTime - a.latestTime);
  }, [conversations]);

  const selectedThread = threads?.find(
    (t) => t.root._id === selectedId || t.messages.some((m) => m._id === selectedId),
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <h1 className="!mb-1">Clarity Agent</h1>
              <p className="text-body-sm text-muted-foreground">
                Your personal AI assistant that answers policy questions via email
              </p>
            </div>
          </FadeIn>

          {!handle ? (
            /* ── No handle: show setup form + explainers ── */
            <>
              <FadeIn when={viewer !== undefined} staggerIndex={1} duration={0.6}>
                <div className="rounded-lg border border-foreground/6 bg-white/60 p-5 mb-6">
                  <AgentHandleForm
                    suggestedHandle={
                      viewer?.companyName
                        ? viewer.companyName
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "")
                        : undefined
                    }
                  />
                </div>
              </FadeIn>

              <FadeIn when={true} staggerIndex={2} duration={0.6}>
                <ModeExplainerCards companyDomains={companyDomains} />
              </FadeIn>
            </>
          ) : (
            /* ── Handle claimed: email card + tabs ── */
            <>
              {/* Agent email + help */}
              <FadeIn when={true} staggerIndex={1} duration={0.6}>
                <div className="rounded-lg border border-foreground/6 bg-white/60 p-5 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Your agent email
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !helpDismissed;
                        setHelpDismissed(next);
                        try { localStorage.setItem("agent-help-dismissed", next ? "1" : ""); } catch {}
                      }}
                      className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer"
                    >
                      {helpDismissed ? "Show Help" : "Hide Help"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(agentEmail!);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                      toast.success("Copied to clipboard");
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-foreground/[0.03] border border-foreground/6 hover:border-foreground/12 transition-colors cursor-pointer group"
                  >
                    <Asterisk className="w-4 h-4 text-[#A0D2FA] shrink-0" />
                    <span className="text-body-sm font-mono font-medium text-foreground flex-1 text-left truncate">{agentEmail}</span>
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 transition-colors" />
                    )}
                  </button>
                  {!helpDismissed && (
                    <div className="mt-4">
                      <ModeExplainerCards companyDomains={companyDomains} />
                    </div>
                  )}
                </div>
              </FadeIn>

              {/* Tabs */}
              <FadeIn when={true} staggerIndex={2} duration={0.6}>
                <div className="flex items-center gap-1 border-b border-foreground/6 mb-6">
                  {AGENT_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        activeTab === tab.id
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground/70"
                      }`}
                    >
                      {tab.label}
                      {activeTab === tab.id && (
                        <motion.div
                          layoutId="agent-tab-indicator"
                          className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </FadeIn>

              {/* Tab content */}
              <FadeIn when={true} staggerIndex={3} duration={0.6}>
                {activeTab === "conversations" ? (
                  <ConversationsPanel
                    threads={threads}
                    selectedThread={selectedThread}
                    selectedId={selectedId}
                    setSelectedId={setSelectedId}
                    showArchived={showArchived}
                    setShowArchived={setShowArchived}
                    agentEmail={agentEmail}
                  />
                ) : (
                  <div className="space-y-6">
                    <ModeExplainerCards companyDomains={companyDomains} />
                    <CoiSettingsCard
                      coiHandling={viewer?.coiHandling}
                      hasBroker={!!(viewer?.insuranceBroker)}
                    />
                    <AgentHelpSection agentEmail={agentEmail!} />
                  </div>
                )}
              </FadeIn>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
