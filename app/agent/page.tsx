"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { AgentHandleForm } from "@/components/agent-handle-form";
import { motion } from "framer-motion";
import {
  Mail,
  Copy,
  Check,
  MessageSquare,
  Users,
  Forward,
  Asterisk,
  HelpCircle,
  FileText,
  X,
  Settings,
  ChevronDown,
} from "lucide-react";

const AGENT_TABS = [
  { id: "help", label: "Help", icon: HelpCircle },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type AgentTab = typeof AGENT_TABS[number]["id"];

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

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

/* ── COI Request Handling settings ── */
function CoiSettingsCard({
  coiHandling,
  hasBroker,
}: {
  coiHandling: "broker" | "member" | "user" | "ignore" | undefined;
  hasBroker: boolean;
}) {
  const updateOrg = useMutation(api.orgs.updateOrg);
  const updateProfile = useMutation(api.users.updateProfile);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const current = coiHandling === "member" ? "user" : (coiHandling ?? "ignore");

  async function handleChange(value: "broker" | "user" | "ignore") {
    try {
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
      <h4 className="!mb-4 text-body-sm font-semibold">COI Request Handling</h4>
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
            <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
              current === opt.value ? "border-foreground" : "border-foreground/20"
            }`}>
              {current === opt.value && (
                <div className="w-2 h-2 rounded-full bg-foreground" />
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

/* ── Detailed help section ── */
function AgentHelpSection({ agentEmail }: { agentEmail: string }) {
  const faqs = [
    {
      q: "How does the agent decide which mode to use?",
      a: "The agent checks where it appears in the email. If it's in the CC field, it uses CC mode. If an internal user forwards an email, it uses Forward mode. If the agent is the sole direct recipient, it uses Direct mode.",
    },
    {
      q: "What does the customer see when I CC the agent?",
      a: "The agent replies to all participants on the thread in a professional, customer-facing tone.",
    },
    {
      q: "What happens when I forward a customer email?",
      a: "The agent extracts the original sender and replies directly to them. You are automatically CC'd.",
    },
    {
      q: "How do I fill out an insurance application?",
      a: "Email the agent directly with a PDF application form attached. The agent will extract all fields, auto-fill what it knows, and ask you the remaining questions in batches.",
    },
    {
      q: "What is Business Context?",
      a: "Reusable information about your company learned from past application answers. Used to auto-fill future applications. Manage it in Organization Settings.",
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

/* ── Email notification toggle ── */
function ChatEmailNotificationsToggle() {
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const org = viewerOrg?.org;
  const isAdmin = viewerOrg?.membership?.role === "admin";
  const enabled = org?.chatEmailNotifications ?? false;

  async function handleToggle() {
    try {
      await updateOrg({ chatEmailNotifications: !enabled });
      toast.success(enabled ? "Email notifications disabled" : "Email notifications enabled");
    } catch {
      toast.error("Failed to update setting");
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-body-sm font-medium text-foreground">Email notifications for chat responses</p>
          <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
            Send agent chat replies to your email to keep your inbox in sync.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-4 ${
            enabled ? "bg-foreground" : "bg-foreground/15"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

/* ── Auto-send emails toggle ── */
function AutoSendEmailsToggle() {
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const org = viewerOrg?.org;
  const isAdmin = viewerOrg?.membership?.role === "admin";
  const enabled = org?.autoSendEmails === true; // defaults to false

  async function handleToggle() {
    try {
      await updateOrg({ autoSendEmails: !enabled });
      toast.success(enabled ? "Email confirmation enabled" : "Auto-send enabled");
    } catch {
      toast.error("Failed to update setting");
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-body-sm font-medium text-foreground">Auto-send emails from chat</p>
          <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
            When disabled, drafted emails require manual confirmation before sending.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-4 ${
            enabled ? "bg-foreground" : "bg-foreground/15"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

/* ── Email send delay setting ── */
function EmailSendDelaySetting() {
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const org = viewerOrg?.org;
  const isAdmin = viewerOrg?.membership?.role === "admin";
  const current = org?.emailSendDelay ?? 5; // default 5s
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = [
    { value: 0, label: "Off" },
    { value: 3, label: "3s" },
    { value: 5, label: "5s" },
    { value: 10, label: "10s" },
    { value: 15, label: "15s" },
  ];

  const selectedLabel = options.find((o) => o.value === current)?.label ?? `${current}s`;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleSelect(value: number) {
    setOpen(false);
    try {
      await updateOrg({ emailSendDelay: value });
      toast.success("Email send delay updated");
    } catch {
      toast.error("Failed to update setting");
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-body-sm font-medium text-foreground">Email send delay</p>
          <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
            Time window to cancel outgoing emails before they&#39;re sent.
          </p>
        </div>
        <div ref={containerRef} className="relative shrink-0 ml-4">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/8 bg-white px-3 py-1.5 text-body-sm text-foreground transition-colors hover:border-foreground/15 cursor-pointer"
          >
            <span>{selectedLabel}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
          </button>
          {open && (
            <div className="absolute z-50 top-full right-0 mt-1 rounded-lg border border-foreground/10 bg-white shadow-md overflow-hidden min-w-[100px]">
              <div className="py-1">
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-body-sm text-left hover:bg-foreground/[0.04] transition-colors cursor-pointer"
                  >
                    <span>{opt.label}</span>
                    {opt.value === current && (
                      <Check className="w-3 h-3 text-foreground shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main agent page ── */
export default function AgentPage() {
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentTab>("help");

  const org = viewerOrg?.org;
  const handle = org?.agentHandle ?? viewer?.agentHandle;
  const agentEmail = handle ? `${handle}@${AGENT_DOMAIN}` : null;

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

  return (
    <AppShell>
      {!handle ? (
        /* ── No handle: show setup form + explainers ── */
        <>
          <FadeIn when={viewer !== undefined} staggerIndex={0} duration={0.6}>
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

          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <ModeExplainerCards companyDomains={companyDomains} />
          </FadeIn>
        </>
      ) : (
        /* ── Handle claimed: help & settings ── */
        <>
          {/* Agent email card */}
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-white/60 p-4 mb-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Asterisk className="w-4 h-4 text-[#A0D2FA] shrink-0" />
                  <span className="text-sm font-semibold text-foreground shrink-0">Prism</span>
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
          </FadeIn>

          {/* Tabs */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
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
          <FadeIn when={true} staggerIndex={2} duration={0.6}>
            {activeTab === "help" ? (
              <div className="space-y-6">
                <ModeExplainerCards companyDomains={companyDomains} />
                <AgentHelpSection agentEmail={agentEmail!} />
              </div>
            ) : (
              <div className="space-y-6">
                <CoiSettingsCard
                  coiHandling={(org?.coiHandling ?? viewer?.coiHandling) as "broker" | "user" | "ignore" | undefined}
                  hasBroker={!!(org?.insuranceBroker ?? viewer?.insuranceBroker)}
                />
                <ChatEmailNotificationsToggle />
                <AutoSendEmailsToggle />
                <EmailSendDelaySetting />
                <p className="text-label-sm text-muted-foreground/40">
                  COI and broker settings can also be managed in{" "}
                  <a href="/settings" className="text-foreground/60 hover:text-foreground underline">
                    Organization Settings
                  </a>.
                </p>
              </div>
            )}
          </FadeIn>
        </>
      )}
    </AppShell>
  );
}
