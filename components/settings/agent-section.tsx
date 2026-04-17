"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/fade-in";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AgentHandleForm } from "@/components/agent-handle-form";
import {
  Copy,
  Check,
  MessageSquare,
  Users,
  FileText,
  X,
  ChevronDown,
} from "lucide-react";

const AGENT_DOMAIN =
  process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

/* ── COI Request Handling settings ── */
function CoiSettingsCard({
  coiHandling,
  autoGenerateCoi,
  hasBroker,
}: {
  coiHandling: "broker" | "member" | "user" | "ignore" | undefined;
  autoGenerateCoi: boolean | undefined;
  hasBroker: boolean;
}) {
  const updateOrg = useMutation(api.orgs.updateOrg);
  const updateProfile = useMutation(api.users.updateProfile);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const current = coiHandling === "member" ? "user" : (coiHandling ?? "ignore");
  const autoGenerate = autoGenerateCoi !== false; // default on

  async function handleChange(value: "broker" | "user" | "ignore") {
    try {
      if (viewerOrg?.org) {
        const orgValue = value === "user" ? "member" : value;
        await updateOrg({
          coiHandling: orgValue as "broker" | "member" | "ignore",
        });
      } else {
        await updateProfile({ coiHandling: value });
      }
      toast.success("COI handling updated");
    } catch {
      toast.error("Failed to update COI handling");
    }
  }

  async function handleAutoGenerateToggle() {
    try {
      if (viewerOrg?.org) {
        await updateOrg({ autoGenerateCoi: !autoGenerate });
      }
      toast.success(
        "COI auto-generation " + (!autoGenerate ? "enabled" : "disabled")
      );
    } catch {
      toast.error("Failed to update COI settings");
    }
  }

  const options: {
    value: "broker" | "user" | "ignore";
    label: string;
    description: string;
    icon: typeof FileText;
    disabled?: boolean;
  }[] = [
    {
      value: "broker",
      label: "Refer to broker",
      description: hasBroker
        ? "Route COI requests to your broker"
        : "Set up your broker in Profile first",
      icon: Users,
      disabled: !hasBroker,
    },
    {
      value: "user",
      label: "Refer to PoC",
      description: "Route COI requests to your primary insurance contact",
      icon: MessageSquare,
    },
    {
      value: "ignore",
      label: "No referral",
      description: "No special routing for COI requests",
      icon: X,
    },
  ];

  return (
    <div>
      <p className="text-body-sm font-medium text-foreground mb-1">COI Settings</p>
      <p className="text-label-sm text-muted-foreground/50 mb-4">
        Configure how COI requests are handled by the agent
      </p>

      {/* Auto-generate toggle */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-foreground/6">
        <div>
          <p className="text-body-sm font-medium text-foreground">
            Auto-generate COI
          </p>
          <p className="text-label-sm text-muted-foreground/50">
            Prism generates ACORD 25-style COI PDFs when requested
          </p>
        </div>
        <button
          type="button"
          onClick={handleAutoGenerateToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            autoGenerate ? "bg-foreground" : "bg-foreground/15"
          }`}
          role="switch"
          aria-checked={autoGenerate}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              autoGenerate ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <p className="text-label-sm text-muted-foreground/60 mb-3">
        When not auto-generating, route COI requests to:
      </p>
      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled || autoGenerate}
            onClick={() => handleChange(opt.value)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left cursor-pointer ${
              current === opt.value && !autoGenerate
                ? "border-foreground/15 bg-foreground/[0.03]"
                : "border-foreground/6 hover:border-foreground/10 hover:bg-foreground/[0.01]"
            } ${opt.disabled || autoGenerate ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <div
              className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                current === opt.value && !autoGenerate
                  ? "border-foreground"
                  : "border-foreground/20"
              }`}
            >
              {current === opt.value && !autoGenerate && (
                <div className="w-2 h-2 rounded-full bg-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-foreground">
                {opt.label}
              </p>
              <p className="text-label-sm text-muted-foreground/50">
                {opt.description}
              </p>
            </div>
          </button>
        ))}
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
      toast.success(
        enabled ? "Email notifications disabled" : "Email notifications enabled"
      );
    } catch {
      toast.error("Failed to update setting");
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-body-sm font-medium text-foreground">
          Email notifications for chat responses
        </p>
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
  );
}

/* ── Auto-send emails toggle ── */
function AutoSendEmailsToggle() {
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const org = viewerOrg?.org;
  const isAdmin = viewerOrg?.membership?.role === "admin";
  const enabled = org?.autoSendEmails === true;

  async function handleToggle() {
    try {
      await updateOrg({ autoSendEmails: !enabled });
      toast.success(
        enabled ? "Email confirmation enabled" : "Auto-send enabled"
      );
    } catch {
      toast.error("Failed to update setting");
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-body-sm font-medium text-foreground">
          Auto-send emails from chat
        </p>
        <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
          When disabled, drafted emails require manual confirmation before
          sending.
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
  );
}

/* ── Email send delay setting ── */
function EmailSendDelaySetting() {
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const org = viewerOrg?.org;
  const isAdmin = viewerOrg?.membership?.role === "admin";
  const current = org?.emailSendDelay ?? 5;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = [
    { value: 0, label: "Off" },
    { value: 3, label: "3s" },
    { value: 5, label: "5s" },
    { value: 10, label: "10s" },
    { value: 15, label: "15s" },
  ];

  const selectedLabel =
    options.find((o) => o.value === current)?.label ?? `${current}s`;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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
    <div className="flex items-center justify-between">
      <div>
        <p className="text-body-sm font-medium text-foreground">
          Email send delay
        </p>
        <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
          Time window to cancel outgoing emails before they&apos;re sent.
        </p>
      </div>
      <div ref={containerRef} className="relative shrink-0 ml-4">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 rounded-lg border border-foreground/8 bg-popover px-3 py-1.5 text-body-sm text-foreground transition-colors hover:border-foreground/15 cursor-pointer"
        >
          <span>{selectedLabel}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        </button>
        {open && (
          <div className="absolute z-50 top-full right-0 mt-1 rounded-lg border border-foreground/10 bg-popover overflow-hidden min-w-[100px]">
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
  );
}

/* ── Main Agent Section ── */
export function AgentSection() {
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const [copied, setCopied] = useState(false);

  const org = viewerOrg?.org;
  const handle = org?.agentHandle ?? viewer?.agentHandle;
  const agentEmail = handle ? `${handle}@${AGENT_DOMAIN}` : null;

  return (
    <>
      {!handle ? (
        /* ── No handle: show setup form ── */
        <FadeIn when={viewer !== undefined} staggerIndex={0} duration={0.6}>
          <div className="rounded-lg border border-foreground/6 bg-card p-5">
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
              <a
                href="/settings"
                className="text-foreground/60 hover:text-foreground underline"
              >
                Organization Settings
              </a>
              .
            </p>
          </div>
        </FadeIn>
      ) : (
        /* ── Handle claimed: settings only ── */
        <div className="space-y-6">
          {/* Agent identity card */}
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-card p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="flex items-center gap-2">
                  <LogoIcon size={16} static className="text-primary-light shrink-0" />
                  <span className="text-sm font-semibold text-foreground shrink-0">
                    Prism
                  </span>
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

          {/* Settings */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-card p-5 space-y-6">
              <CoiSettingsCard
                coiHandling={
                  (org?.coiHandling ??
                    viewer?.coiHandling) as
                    | "broker"
                    | "user"
                    | "ignore"
                    | undefined
                }
                autoGenerateCoi={org?.autoGenerateCoi}
                hasBroker={!!(org?.insuranceBroker ?? viewer?.insuranceBroker)}
              />

              <div className="pt-4 border-t border-foreground/6 space-y-5">
                <ChatEmailNotificationsToggle />
                <AutoSendEmailsToggle />
                <EmailSendDelaySetting />
              </div>
            </div>
          </FadeIn>

        </div>
      )}
    </>
  );
}
