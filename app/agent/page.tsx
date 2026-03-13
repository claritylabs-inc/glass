"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { AgentHandleForm } from "@/components/agent-handle-form";
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
  Paperclip,
} from "lucide-react";
import Link from "next/link";
import { Id } from "@/convex/_generated/dataModel";
import { ModeBadge } from "@/components/mode-badge";
import { MessageBubble, type Conversation } from "@/components/conversation-message";
import { PdfProvider, usePdf } from "@/components/pdf-context";
import dynamic from "next/dynamic";

const PdfPanel = dynamic(
  () => import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

function AgentLayoutContainer({
  children,
  panel,
  onPdfClosed,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
  onPdfClosed?: () => void;
}) {
  const { isPdfOpen, fileUrl } = usePdf();
  const hasPdfPanel = isPdfOpen && !!fileUrl;

  // Reset parent URL state when panel is closed so same attachment can reopen
  const prevOpen = useRef(hasPdfPanel);
  useEffect(() => {
    if (prevOpen.current && !hasPdfPanel) {
      onPdfClosed?.();
    }
    prevOpen.current = hasPdfPanel;
  }, [hasPdfPanel, onPdfClosed]);

  return (
    <div className={`mx-auto px-4 md:px-8 py-6 ${hasPdfPanel ? "max-w-[108rem] flex gap-6 items-start" : "max-w-6xl"}`}>
      <div className={hasPdfPanel ? "flex-1 min-w-0" : undefined}>
        {children}
      </div>
      {panel}
    </div>
  );
}

dayjs.extend(relativeTime);

/** Hook that returns a tick value that increments every `ms` milliseconds, forcing re-renders for live timestamps. */
function useTick(ms = 30_000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "agent.claritylabs.inc";

type Thread = {
  root: Conversation;
  messages: Conversation[];
  latestTime: number;
};

/* ── Thread list item ── */
function ThreadItem({
  thread,
  isSelected,
  onSelect,
  tick,
  isApplication,
}: {
  thread: Thread;
  isSelected: boolean;
  onSelect: () => void;
  tick: number;
  isApplication?: boolean;
}) {
  const root = thread.root;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const timeAgo = useMemo(() => dayjs(thread.latestTime).fromNow(), [thread.latestTime, tick]);
  const displayMode = isApplication ? "application" : root.mode;

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
          {thread.messages.some((m) => m.attachments && m.attachments.length > 0) && (
            <Paperclip className="w-3 h-3 text-muted-foreground/40" />
          )}
          <ModeBadge mode={displayMode} />
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

/* ── Thread detail panel ── */
function ThreadDetail({
  thread,
  onBack,
  onClose,
  onOpenPdf,
  appThreadIds,
}: {
  thread: Thread;
  onBack?: () => void;
  onClose?: () => void;
  onOpenPdf?: (url: string) => void;
  appThreadIds?: Record<string, { sessionId: string; status: string; title?: string }>;
}) {
  const archiveConv = useMutation(api.agentConversations.archive);
  const unarchiveConv = useMutation(api.agentConversations.unarchive);
  const retryApp = useAction(api.actions.processApplication.retryApplication);
  const messagesRef = useRef<HTMLDivElement>(null);
  const prevThreadId = useRef<string | null>(null);
  const root = thread.root;

  // Auto-scroll to bottom when thread opens or messages change
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNewThread = prevThreadId.current !== root._id;
    prevThreadId.current = root._id;
    el.scrollTo({ top: el.scrollHeight, behavior: isNewThread ? "instant" : "smooth" });
  }, [root._id, thread.messages.length]);
  const isArchived = !!root.archivedAt;

  const appInfo = appThreadIds?.[String(root._id)];

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

  async function handleRetry() {
    if (!appInfo?.sessionId) return;
    try {
      const result = await retryApp({ sessionId: appInfo.sessionId as any });
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("Retrying application processing...");
      }
    } catch {
      toast.error("Failed to retry");
    }
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
          {appInfo?.sessionId && (
            <Link href={`/applications/${appInfo.sessionId}`}>
              <PillButton variant="secondary" className="text-xs">
                <FileText className="w-3.5 h-3.5 mr-1" />
                View Application
              </PillButton>
            </Link>
          )}
          <ModeBadge mode={appInfo ? "application" : root.mode} />
          {(() => {
            const total = thread.messages.reduce((n, m) => n + 1 + (m.responseBody ? 1 : 0), 0);
            return total > 1 ? (
              <span className="text-[11px] text-muted-foreground/40">
                {total} messages
              </span>
            ) : null;
          })()}
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
      <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 pr-5 pb-12 space-y-4">
        {thread.messages.map((msg) => (
          <MessageBubble key={msg._id} conv={msg} onOpenPdf={onOpenPdf} onRetry={appInfo ? handleRetry : undefined} />
        ))}
      </div>
    </div>
  );
}

/* ── Mode explainer cards ── */
function ModeExplainerCards({ companyDomains }: { companyDomains?: string[] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-violet-600" />
            <h4 className="!mb-0 text-body-sm font-semibold">Direct Mode</h4>
          </div>
          <p className="text-label-sm text-muted-foreground/60">
            Email the agent directly for policy questions or to fill out
            insurance applications. Attach a PDF application form and the
            agent will walk you through it.
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
            <FileText className="w-4 h-4 text-rose-600" />
            <h4 className="!mb-0 text-body-sm font-semibold">Application Mode</h4>
          </div>
          <p className="text-label-sm text-muted-foreground/60">
            Attach an insurance application PDF and the agent extracts fields,
            auto-fills from saved context, and asks you the rest in batches.
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
    {
      q: "How do I fill out an insurance application?",
      a: "Email the agent directly with a PDF application form attached and mention that you need help filling it out. The agent will extract all fields, auto-fill what it already knows from your saved business context, and ask you the remaining questions in batches. Once complete, it generates a summary for your review.",
    },
    {
      q: "What is Business Context?",
      a: "Business Context stores reusable information about your company (name, revenue, operations, etc.) learned from past application answers. It's used to auto-fill future applications so you don't have to re-enter the same information. You can manage it from Organization Settings.",
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
  const updateOrg = useMutation(api.orgs.updateOrg);
  const updateProfile = useMutation(api.users.updateProfile);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const current = coiHandling ?? "ignore";

  async function handleChange(value: "broker" | "user" | "ignore") {
    try {
      // Save to org if available, fall back to user profile
      if (viewerOrg?.org) {
        const orgValue = value === "user" ? "member" : value;
        await updateOrg({ coiHandling: orgValue as "broker" | "member" | "ignore" });
      } else {
        await updateProfile({ coiHandling: value });
      }
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
  tick,
  onOpenPdf,
  appThreadIds,
}: {
  threads: Thread[] | undefined;
  selectedThread: Thread | undefined;
  selectedId: Id<"agentConversations"> | null;
  setSelectedId: (id: Id<"agentConversations"> | null) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  agentEmail: string | null;
  tick: number;
  onOpenPdf?: (url: string) => void;
  appThreadIds?: Record<string, { sessionId: string; status: string; title?: string }>;
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
                  tick={tick}
                  isApplication={!!appThreadIds?.[String(thread.root._id)]}
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
              onOpenPdf={onOpenPdf}
              appThreadIds={appThreadIds}
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
      <div className="lg:hidden flex flex-col" style={{ height: "calc(100dvh - 9rem)" }}>
        {selectedThread ? (
          <div className="flex-1 min-h-0">
            <ThreadDetail
              thread={selectedThread}
              onBack={() => setSelectedId(null)}
              onOpenPdf={onOpenPdf}
              appThreadIds={appThreadIds}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/6 shrink-0">
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
              <div className="flex-1 overflow-y-auto">
                {threads.map((thread) => (
                  <ThreadItem
                    key={thread.root._id}
                    thread={thread}
                    isSelected={false}
                    onSelect={() => setSelectedId(thread.root._id)}
                    tick={tick}
                    isApplication={!!appThreadIds?.[String(thread.root._id)]}
                  />
                ))}
              </div>
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
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const [showArchived, setShowArchived] = useState(false);
  const conversations = useQuery(api.agentConversations.list, { archived: showArchived });
  const appThreadIds = useQuery(api.applicationSessions.threadIds);
  const [selectedId, setSelectedId] = useState<Id<"agentConversations"> | null>(null);
  const [copied, setCopied] = useState(false);
  const [attachmentPdfUrl, setAttachmentPdfUrl] = useState<string | null>(null);
  const handlePdfClosed = useCallback(() => setAttachmentPdfUrl(null), []);
  const [activeTab, setActiveTab] = useState<AgentTab>("conversations");
  const [helpDismissed, setHelpDismissed] = useState(false);
  const tick = useTick(30_000);

  useEffect(() => {
    try { setHelpDismissed(localStorage.getItem("agent-help-dismissed") === "1"); } catch {}
  }, []);

  const org = viewerOrg?.org;
  // Prefer org-level handle, fall back to user-level for backward compat
  const handle = org?.agentHandle ?? viewer?.agentHandle;
  const agentEmail = handle ? `${handle}@${AGENT_DOMAIN}` : null;

  // Derive company domains from org website + viewer email
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
    const website = org?.website ?? viewer.companyWebsite;
    if (website) {
      try {
        const hostname = new URL(website).hostname.replace(/^www\./, "");
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
  }, [viewer, org]);

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
    <PdfProvider fileUrl={attachmentPdfUrl}>
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <AgentLayoutContainer panel={<PdfPanel />} onPdfClosed={handlePdfClosed}>
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <h1 className="!mb-1">Clarity Agent</h1>
              <p className="text-body-sm text-muted-foreground">
                Policy Q&A, application assistance, and more — all by email
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
                      (org?.name ?? viewer?.companyName)
                        ? (org?.name ?? viewer?.companyName ?? "")
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "")
                        : undefined
                    }
                  />
                  <p className="text-label-sm text-muted-foreground/40 mt-3">
                    Agent handle can also be managed in{" "}
                    <a href="/settings" className="text-foreground/60 hover:text-foreground underline">
                      Organization Settings
                    </a>.
                  </p>
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
                <div className="rounded-lg border border-foreground/6 bg-white/60 p-4 mb-6">
                  <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div className="flex items-center justify-between md:justify-start md:gap-5">
                        <div className="flex items-center gap-2">
                          <Asterisk className="w-4 h-4 text-[#A0D2FA] shrink-0" />
                          <span className="text-sm font-semibold text-foreground shrink-0">Clarity Agent</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !helpDismissed;
                            setHelpDismissed(next);
                            try { localStorage.setItem("agent-help-dismissed", next ? "1" : ""); } catch {}
                          }}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer"
                        >
                          <HelpCircle className="w-3 h-3" />
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
                        className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground/70 transition-colors cursor-pointer truncate min-w-0"
                      >
                        <span className="truncate">{agentEmail}</span>
                        {copied ? (
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                        ) : (
                          <Copy className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                        )}
                      </button>
                    </div>
                  </div>
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
                    tick={tick}
                    onOpenPdf={setAttachmentPdfUrl}
                    appThreadIds={appThreadIds}
                  />
                ) : (
                  <div className="space-y-6">
                    <ModeExplainerCards companyDomains={companyDomains} />
                    <CoiSettingsCard
                      coiHandling={(org?.coiHandling ?? viewer?.coiHandling) as "broker" | "user" | "ignore" | undefined}
                      hasBroker={!!(org?.insuranceBroker ?? viewer?.insuranceBroker)}
                    />
                    <AgentHelpSection agentEmail={agentEmail!} />
                    <p className="text-label-sm text-muted-foreground/40">
                      COI and broker settings can be managed in{" "}
                      <a href="/settings" className="text-foreground/60 hover:text-foreground underline">
                        Organization Settings
                      </a>.
                    </p>
                  </div>
                )}
              </FadeIn>
            </>
          )}
        </AgentLayoutContainer>
      </main>
    </div>
    </PdfProvider>
  );
}
