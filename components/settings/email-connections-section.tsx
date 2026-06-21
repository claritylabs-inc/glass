"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { useAction, useMutation } from "convex/react";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Loader2, Mail, Plug, Plus, Trash2 } from "lucide-react";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useCurrentOrg } from "@/hooks/use-current-org";
import {
  useCachedQuery,
  useUpdateCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

type EmailScope = "user" | "org";
type ConnectedEmailAccountRow = {
  _id: Id<"connectedEmailAccounts">;
  orgId: Id<"organizations">;
  scope: EmailScope;
  emailAddress: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
};

const EMAIL_SCOPE_LABELS: Record<EmailScope, string> = {
  user: "Only me",
  org: "Organization",
};

type EmailProviderPreset = {
  id: string;
  name: string;
  detail: string;
  host: string;
  port: string;
  secure: boolean;
  passwordLabel: string;
  note: string;
  setupHref?: string;
  setupLinkLabel?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

function GoogleLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <path
        fill="#FFC107"
        d="M43.61 20.08H42V20H24v8h11.3C33.65 32.66 29.22 36 24 36c-6.63 0-12-5.37-12-12s5.37-12 12-12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.39-3.92Z"
      />
      <path
        fill="#FF3D00"
        d="m6.31 14.69 6.57 4.82C14.66 15.11 18.96 12 24 12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 16.32 4 9.66 8.34 6.31 14.69Z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.17 0 9.86-1.98 13.41-5.19l-6.19-5.24C29.14 35.15 26.63 36 24 36c-5.2 0-9.62-3.32-11.28-7.95l-6.52 5.02C9.51 39.56 16.23 44 24 44Z"
      />
      <path
        fill="#1976D2"
        d="M43.61 20.08H42V20H24v8h11.3a12.04 12.04 0 0 1-4.09 5.57l.01-.01 6.19 5.24C36.97 39.2 44 34 44 24c0-1.34-.14-2.65-.39-3.92Z"
      />
    </svg>
  );
}

function MicrosoftLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 23 23" aria-hidden="true" {...props}>
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

const PROVIDER_PRESETS: EmailProviderPreset[] = [
  {
    id: "google",
    name: "Google Workspace",
    detail: "Gmail / Workspace",
    host: "imap.gmail.com",
    port: "993",
    secure: true,
    passwordLabel: "App password",
    note: "Use an app password when two-step verification is enabled.",
    setupHref: "https://myaccount.google.com/apppasswords",
    setupLinkLabel: "Create a Google app password",
    icon: GoogleLogo,
  },
  {
    id: "outlook",
    name: "Outlook",
    detail: "Microsoft 365 / Exchange Online",
    host: "outlook.office365.com",
    port: "993",
    secure: true,
    passwordLabel: "Password or app password",
    note: "IMAP must be enabled for the mailbox. Some tenants require OAuth instead of password login.",
    icon: MicrosoftLogo,
  },
];

const CUSTOM_PRESET: EmailProviderPreset = {
  id: "custom",
  name: "Other IMAP",
  detail: "Any IMAP server",
  host: "",
  port: "993",
  secure: true,
  passwordLabel: "Password or app password",
  note: "Use the IMAP host and port from your mail provider.",
  icon: Plug,
};

function iconForMailboxHost(host: string) {
  const normalizedHost = host.toLowerCase();
  if (normalizedHost.includes("gmail") || normalizedHost.includes("google")) {
    return GoogleLogo;
  }
  if (
    normalizedHost.includes("outlook") ||
    normalizedHost.includes("office365") ||
    normalizedHost.includes("exchange")
  ) {
    return MicrosoftLogo;
  }
  return Mail;
}

function EmailScopeSelect({
  value,
  onValueChange,
  allowOrgScope = true,
  disabled = false,
  className,
}: {
  value: EmailScope;
  onValueChange: (value: EmailScope) => void;
  allowOrgScope?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (nextValue === "org" && !allowOrgScope) return;
        onValueChange(nextValue as EmailScope);
      }}
    >
      <SelectTrigger className={className}>
        <SelectValue>{EMAIL_SCOPE_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">Only me</SelectItem>
        <SelectItem value="org" disabled={!allowOrgScope}>
          Organization
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function EmailConnectionsSection() {
  const currentOrg = useCurrentOrg();
  const canManageOrgMailboxes = currentOrg?.role === "admin";
  const connectedEmailAccounts = useCachedQuery(
    "connectedEmail.list",
    api.connectedEmail.list,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedEmailAccountRow[] | undefined;
  const upsertConnectedEmailAccounts = useUpsertCachedQuery<
    ConnectedEmailAccountRow[],
    { orgId: Id<"organizations"> }
  >("connectedEmail.list");
  const updateConnectedEmailAccounts = useUpdateCachedQuery<
    ConnectedEmailAccountRow[],
    { orgId: Id<"organizations"> }
  >("connectedEmail.list");
  const connectEmail = useAction(api.actions.connectedEmail.connect);
  const revokeConnectedEmail = useMutation(api.connectedEmail.revoke);
  const updateConnectedEmailScope = useMutation(api.connectedEmail.updateScope);

  const [selectedPresetId, setSelectedPresetId] = useState("google");
  const selectedPreset = useMemo(
    () =>
      PROVIDER_PRESETS.find((preset) => preset.id === selectedPresetId) ??
      CUSTOM_PRESET,
    [selectedPresetId],
  );
  const [form, setForm] = useState({
    emailAddress: "",
    host: selectedPreset.host,
    port: selectedPreset.port,
    secure: selectedPreset.secure,
    password: "",
    scope: "user" as EmailScope,
  });
  const [connecting, setConnecting] = useState(false);
  const [addMailboxOpen, setAddMailboxOpen] = useState(false);
  const { setActions, setRightPanel } = useSettingsActions();

  const canConnect =
    !!form.emailAddress &&
    !!form.host &&
    !!form.port &&
    !!form.password &&
    !connecting;

  useEffect(() => {
    setActions(
      <PillButton
        size="compact"
        variant="secondary"
        onClick={() => setAddMailboxOpen(true)}
      >
        <Plus className="size-3.5" />
        Add mailbox
      </PillButton>,
    );
    return () => setActions(null);
  }, [setActions]);

  function selectPreset(preset: EmailProviderPreset) {
    setSelectedPresetId(preset.id);
    setForm((current) => ({
      ...current,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
    }));
  }

  function updateEmailAddress(value: string) {
    setForm((current) => ({
      ...current,
      emailAddress: value,
    }));
  }

  async function handleConnectEmail() {
    if (!currentOrg?.orgId) return;
    const scope = canManageOrgMailboxes ? form.scope : "user";
    setConnecting(true);
    try {
      const accountId = await connectEmail({
        orgId: currentOrg.orgId,
        emailAddress: form.emailAddress,
        host: form.host,
        port: Number(form.port),
        secure: form.secure,
        username: form.emailAddress.trim(),
        password: form.password,
        scope,
      }) as Id<"connectedEmailAccounts">;
      const now = dayjs().valueOf();
      await upsertConnectedEmailAccounts(
        { orgId: currentOrg.orgId },
        (current) => [
          {
            _id: accountId,
            orgId: currentOrg.orgId,
            scope,
            emailAddress: form.emailAddress.trim().toLowerCase(),
            host: form.host.trim(),
            port: Number(form.port),
            secure: form.secure,
            username: form.emailAddress.trim(),
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
          ...(current ?? []).filter((account) => account._id !== accountId),
        ],
      );
      setForm({
        emailAddress: "",
        host: selectedPreset.host,
        port: selectedPreset.port,
        secure: selectedPreset.secure,
        password: "",
        scope: "user",
      });
      toast.success("Email connected");
      setAddMailboxOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to connect email");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    setRightPanel(
      <SettingsDrawer
        open={addMailboxOpen}
        onOpenChange={setAddMailboxOpen}
        title="Add mailbox"
        footer={
          <>
            <PillButton
              variant="secondary"
              disabled={connecting}
              onClick={() => setAddMailboxOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton onClick={handleConnectEmail} disabled={!canConnect}>
              {connecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {connecting ? "Connecting..." : "Connect"}
            </PillButton>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <p className="text-base text-muted-foreground">
            Choose a preset, then enter the mailbox credentials Glass should use for agent email access.
          </p>

          <div className="grid gap-3">
            {[...PROVIDER_PRESETS, CUSTOM_PRESET].map((preset) => {
              const Icon = preset.icon;
              const selected = selectedPreset.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className={`flex min-h-20 items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                    selected
                      ? "border-foreground/18 bg-foreground/5"
                      : "border-foreground/8 bg-transparent hover:border-foreground/14 hover:bg-foreground/3"
                  }`}
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium text-foreground">
                      {preset.name}
                    </span>
                    <span className="mt-0.5 block text-label text-muted-foreground/60">
                      {preset.detail}
                    </span>
                  </span>
                  {selected ? <Check className="mt-1 size-3.5 shrink-0 text-foreground" /> : null}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3">
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Email address
              <input
                value={form.emailAddress}
                onChange={(event) => updateEmailAddress(event.target.value)}
                placeholder="name@company.com"
                className="rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              IMAP host
              <input
                value={form.host}
                onChange={(event) =>
                  setForm((current) => ({ ...current, host: event.target.value }))
                }
                placeholder="imap.company.com"
                className="rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Port
              <input
                value={form.port}
                onChange={(event) =>
                  setForm((current) => ({ ...current, port: event.target.value }))
                }
                inputMode="numeric"
                className="rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base text-foreground focus:outline-none focus:border-foreground/20"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({ ...current, secure: !current.secure }))
              }
              className="flex items-center justify-between gap-3 rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-left transition-colors hover:border-foreground/14"
            >
              <span>
                <span className="block text-label font-medium text-muted-foreground">
                  Use TLS
                </span>
                <span className="mt-0.5 block text-label text-muted-foreground/60">
                  Recommended for IMAP on port 993
                </span>
              </span>
              <span
                className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                  form.secure
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/20"
                }`}
              >
                {form.secure ? <Check className="size-3" /> : null}
              </span>
            </button>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              {selectedPreset.passwordLabel}
              <input
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                type="password"
                className="rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base text-foreground focus:outline-none focus:border-foreground/20"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
              Agent access
              <EmailScopeSelect
                value={form.scope}
                onValueChange={(scope) =>
                  setForm((current) => ({ ...current, scope }))
                }
                allowOrgScope={canManageOrgMailboxes}
                disabled={!canManageOrgMailboxes}
                className="h-9 w-full border-foreground/8 bg-popover text-base"
              />
            </label>
          </div>

          <p className="text-label text-muted-foreground/70">
            {selectedPreset.note}
            {selectedPreset.setupHref ? (
              <>
                {" "}
                <a
                  href={selectedPreset.setupHref}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground underline-offset-3 hover:underline"
                >
                  {selectedPreset.setupLinkLabel}
                </a>
              </>
            ) : null}
          </p>
        </div>
      </SettingsDrawer>,
    );
    return () => {
      setRightPanel(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addMailboxOpen,
    canConnect,
    canManageOrgMailboxes,
    connecting,
    form,
    selectedPreset,
    setRightPanel,
  ]);

  return (
    <div className="flex w-full flex-col gap-5">
      <div>
        <h1 className="text-lg font-medium text-foreground">Email</h1>
        <p className="mt-1 text-base text-muted-foreground/70">
          Connect IMAP mailboxes for live Glass agent search, reading, and attachment imports.
        </p>
      </div>

      <OperationalPanel>
        <OperationalPanelHeader title="Connected mailboxes" className="px-5 py-3.5" />
        {connectedEmailAccounts === undefined ? (
          <div className="px-5 py-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : connectedEmailAccounts.length > 0 ? (
          <div className="divide-y divide-foreground/6">
            {connectedEmailAccounts.map((account) => (
              (() => {
                const ProviderIcon = iconForMailboxHost(account.host);
                const canDisconnectMailbox =
                  canManageOrgMailboxes || account.scope === "user";
                return (
                  <div
                    key={account._id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground">
                        <ProviderIcon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium text-foreground">
                          {account.emailAddress}
                        </p>
                        <p className="truncate text-label text-muted-foreground/60">
                          {account.host} · {account.scope === "org" ? "Organization" : "Only me"}
                        </p>
                      </div>
                    </div>
                    {canManageOrgMailboxes ? (
                      <EmailScopeSelect
                        value={account.scope}
                        onValueChange={(scope) =>
                          updateConnectedEmailScope({
                            accountId: account._id,
                            scope,
                          })
                            .then(() =>
                              currentOrg?.orgId
                                ? updateConnectedEmailAccounts(
                                    { orgId: currentOrg.orgId },
                                    (current) =>
                                      current.map((row) =>
                                        row._id === account._id
                                          ? {
                                              ...row,
                                              scope,
                                              updatedAt: dayjs().valueOf(),
                                            }
                                          : row,
                                      ),
                                  )
                                : undefined,
                            )
                            .catch(() => toast.error("Failed to update scope"))
                        }
                        className="h-8 w-32 rounded-md border-foreground/8 bg-popover text-label"
                      />
                    ) : (
                      <span className="rounded-md border border-foreground/8 bg-popover px-2.5 py-1.5 text-label text-muted-foreground">
                        {EMAIL_SCOPE_LABELS[account.scope]}
                      </span>
                    )}
                    {canDisconnectMailbox ? (
                      <PillButton
                        variant="destructive"
                        size="compact"
                        onClick={() =>
                          revokeConnectedEmail({ accountId: account._id })
                            .then(() =>
                              currentOrg?.orgId
                                ? updateConnectedEmailAccounts(
                                    { orgId: currentOrg.orgId },
                                    (current) =>
                                      current.filter(
                                        (row) => row._id !== account._id,
                                      ),
                                  )
                                : undefined,
                            )
                            .catch(() => toast.error("Failed to disconnect email"))
                        }
                      >
                        <Trash2 className="size-3.5" />
                        Disconnect
                      </PillButton>
                    ) : null}
                  </div>
                );
              })()
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
              <Mail className="size-5" />
            </span>
            <h3 className="mt-3 text-base font-medium text-foreground">
              Add your first inbox
            </h3>
            <p className="mt-1 max-w-sm text-base text-muted-foreground/70">
              Connect a shared or personal mailbox so Glass can search email, read attachments, and surface insurance follow-ups.
            </p>
            <PillButton
              size="compact"
              variant="secondary"
              className="mt-4"
              onClick={() => setAddMailboxOpen(true)}
            >
              <Plus className="size-3.5" />
              Add mailbox
            </PillButton>
          </div>
        )}
      </OperationalPanel>
    </div>
  );
}
