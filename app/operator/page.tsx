"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { isValidPhoneNumber } from "react-phone-number-input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { Badge } from "@/components/ui/badge";
import { PhoneInput } from "@/components/ui/phone-input";
import { PillButton } from "@/components/ui/pill-button";
import { CLIENT_PORTAL_HOST, getPublicAgentDomain } from "@/lib/domains";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { OperatorSidebar } from "./operator-sidebar";
import { toast } from "sonner";
import {
  useCachedOperatorBrokers,
  useCachedOperatorCurrent,
  useOperatorBrokerCacheActions,
} from "@/lib/sync/operator-cached-queries";

type BrokerRow = {
  _id: Id<"organizations">;
  name: string;
  slug?: string;
  website?: string;
  iconUrl?: string | null;
  agentHandle?: string;
  operatorStatus: "onboarding" | "live";
  adminName?: string;
  adminEmail?: string;
  adminPhone?: string;
  clientCount: number;
  createdAt: number;
};

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";
const AFFIXED_INPUT_CLASSES =
  "min-w-0 flex-1 bg-transparent px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none";
const AGENT_DOMAIN = getPublicAgentDomain();
const BROKER_SIGNUP_PREFIX = `${CLIENT_PORTAL_HOST}/signup/`;

function normalizeIdentifierInput(value: string) {
  const withoutDomain = value.trim().toLowerCase().split("@")[0] ?? "";
  return withoutDomain.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
}

function isValidOptionalPhone(value: string) {
  const trimmed = value.trim();
  return !trimmed || isValidPhoneNumber(trimmed);
}

function saveStatusLabel(args: {
  dirty: boolean;
  status: "idle" | "saving" | "saved" | "error";
  validationError: string | null;
}) {
  if (args.validationError) return args.validationError;
  if (args.status === "saving") return "Saving";
  if (args.status === "error") return "Not saved";
  if (args.status === "saved" && !args.dirty) return "Saved";
  if (args.dirty) return "Waiting";
  return null;
}

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-label-sm font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="block text-label-sm text-destructive">{error}</span> : null}
    </label>
  );
}

function faviconFromWebsite(website?: string | null) {
  if (!website) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    const hostname = new URL(withProtocol).hostname;
    if (!hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
  } catch {
    return null;
  }
}

function OrgMark({ name, iconUrl, website }: { name: string; iconUrl?: string | null; website?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = iconUrl ?? faviconFromWebsite(website);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-foreground/8 bg-white text-label-sm font-medium text-foreground">
      {source && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt=""
          className="h-full w-full object-contain"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            setImageFailed(true);
          }}
        />
      ) : (
        initial
      )}
    </div>
  );
}

export default function OperatorPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<Id<"organizations"> | null>(null);
  const [panelMode, setPanelMode] = useState<"create" | "details" | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [website, setWebsite] = useState("");
  const [agentHandle, setAgentHandle] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editAgentHandle, setEditAgentHandle] = useState("");
  const [editAdminName, setEditAdminName] = useState("");
  const [editAdminPhone, setEditAdminPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [debouncedSlug, setDebouncedSlug] = useState("");
  const [debouncedAgentHandle, setDebouncedAgentHandle] = useState("");

  const current = useCachedOperatorCurrent();
  const brokers = useCachedOperatorBrokers() as BrokerRow[] | undefined;
  const { seedBroker, patchBrokerStatus, patchBrokerSettings } = useOperatorBrokerCacheActions();
  const identifierCheck = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.checkBrokerSetupIdentifiers,
    slug || agentHandle
      ? {
          slug: debouncedSlug || undefined,
          agentHandle: debouncedAgentHandle || undefined,
        }
      : "skip",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createBroker = useAction((api as any).operator.createBroker);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const launchBroker = useAction((api as any).operator.launchBroker);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setBrokerStatus = useMutation((api as any).operator.setBrokerStatus);
  const updateBrokerSettings = useMutation(api.operator.updateBrokerSettings);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startImpersonation = useMutation((api as any).operator.startImpersonation);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopImpersonation = useMutation((api as any).operator.stopImpersonation);

  const selected = useMemo(
    () => brokers?.find((broker) => broker._id === selectedId) ?? null,
    [brokers, selectedId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSlug(slug), 250);
    return () => window.clearTimeout(timer);
  }, [slug]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAgentHandle(agentHandle), 250);
    return () => window.clearTimeout(timer);
  }, [agentHandle]);

  const slugChecking =
    slug.length >= 3 && (slug !== debouncedSlug || identifierCheck === undefined);
  const handleChecking =
    agentHandle.length >= 3 &&
    (agentHandle !== debouncedAgentHandle || identifierCheck === undefined);
  const slugUnavailable = !!slug && identifierCheck?.slug?.available === false;
  const handleUnavailable = !!agentHandle && identifierCheck?.agentHandle?.available === false;
  const brokerSettingsValidationError = !isValidOptionalPhone(editAdminPhone)
    ? "Enter a valid phone number"
    : null;

  function primeEditState(broker: BrokerRow) {
    setEditSlug(broker.slug ?? "");
    setEditWebsite(broker.website ?? "");
    setEditAgentHandle(broker.agentHandle ?? "");
    setEditAdminName(broker.adminName ?? "");
    setEditAdminPhone(broker.adminPhone ?? "");
    setSettingsDirty(false);
    setSettingsSaveStatus("idle");
  }

  function openDetails(broker: BrokerRow) {
    setSelectedId(broker._id);
    primeEditState(broker);
    setPanelMode("details");
  }

  function markBrokerSettingsDirty() {
    setSettingsDirty(true);
    setSettingsSaveStatus("idle");
  }

  const saveBrokerSettings = useCallback(async (broker: BrokerRow) => {
    if (brokerSettingsValidationError) return;
    setSettingsSaveStatus("saving");
    try {
      await updateBrokerSettings({
        brokerOrgId: broker._id,
        slug: editSlug || undefined,
        website: editWebsite || undefined,
        agentHandle: editAgentHandle || undefined,
        adminName: editAdminName || undefined,
        adminPhone: editAdminPhone || undefined,
      });
      await patchBrokerSettings(broker._id, {
        slug: editSlug || undefined,
        website: editWebsite || undefined,
        agentHandle: editAgentHandle || undefined,
        adminName: editAdminName || undefined,
        adminPhone: editAdminPhone || undefined,
      });
      setSettingsDirty(false);
      setSettingsSaveStatus("saved");
    } catch (error) {
      setSettingsSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Failed to save broker settings");
    }
  }, [
    brokerSettingsValidationError,
    editAdminName,
    editAdminPhone,
    editAgentHandle,
    editSlug,
    editWebsite,
    patchBrokerSettings,
    updateBrokerSettings,
  ]);

  useEffect(() => {
    if (panelMode !== "details" || !selected || !settingsDirty || brokerSettingsValidationError) return;
    const timer = window.setTimeout(() => {
      void saveBrokerSettings(selected);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    brokerSettingsValidationError,
    panelMode,
    saveBrokerSettings,
    selected,
    settingsDirty,
  ]);

  async function submitBroker(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await createBroker({
        name,
        slug: slug || undefined,
        website: website || undefined,
        agentHandle: agentHandle || undefined,
        adminEmail,
        adminName: adminName || undefined,
        adminPhone: adminPhone || undefined,
      });
      toast.success("Broker created for setup");
      if (result?.brokerOrgId) {
        await seedBroker({
          brokerOrgId: result.brokerOrgId,
          name,
          slug: slug || undefined,
          website: website || undefined,
          agentHandle: agentHandle || undefined,
          adminEmail,
          adminName: adminName || undefined,
          adminPhone: adminPhone || undefined,
        });
        setSelectedId(result.brokerOrgId);
      }
      setName("");
      setSlug("");
      setWebsite("");
      setAgentHandle("");
      setAdminEmail("");
      setAdminName("");
      setAdminPhone("");
      setPanelMode(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create broker");
    } finally {
      setBusy(false);
    }
  }

  async function impersonate(broker: BrokerRow) {
    await startImpersonation({ targetOrgId: broker._id, targetRole: "admin" });
    router.push("/clients");
  }

  async function launch(broker: BrokerRow) {
    setBusy(true);
    try {
      await launchBroker({ brokerOrgId: broker._id });
      await patchBrokerStatus(broker._id, "live");
      toast.success("Broker launched and login email sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to launch broker");
    } finally {
      setBusy(false);
    }
  }

  async function moveToOnboarding(broker: BrokerRow) {
    setBusy(true);
    try {
      await setBrokerStatus({ brokerOrgId: broker._id, status: "onboarding" });
      await patchBrokerStatus(broker._id, "onboarding");
      toast.success("Broker account disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update broker");
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <>
      {current?.activeImpersonation ? (
        <PillButton
          variant="secondary"
          size="compact"
          onClick={async () => {
            await stopImpersonation({});
            toast.success("Impersonation stopped");
          }}
        >
          Stop impersonating
        </PillButton>
      ) : null}
      <PillButton
        size="compact"
        variant="secondary"
        onClick={() => setPanelMode("create")}
      >
        Create broker
      </PillButton>
    </>
  );
  const brokerSettingsSaveLabel = saveStatusLabel({
    dirty: settingsDirty,
    status: settingsSaveStatus,
    validationError: brokerSettingsValidationError,
  });

  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={(open) => {
        if (!open) setPanelMode(null);
      }}
      title={
        panelMode === "create" || !selected ? (
          "Create broker setup"
        ) : (
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="min-w-0 truncate">{selected.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant={selected.operatorStatus === "live" ? "default" : "secondary"}>
                {selected.operatorStatus === "live" ? "Live" : "Onboarding"}
              </Badge>
              {settingsSaveStatus === "saving" ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
              {brokerSettingsSaveLabel ? (
                <span className={`max-w-28 truncate text-label-sm font-normal ${
                  brokerSettingsValidationError || settingsSaveStatus === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}>
                  {brokerSettingsSaveLabel}
                </span>
              ) : null}
            </span>
          </span>
        )
      }
      footer={
        panelMode === "create" ? (
          <PillButton
            type="submit"
            form="operator-create-broker-form"
            disabled={busy || !name || !adminEmail || slugUnavailable || handleUnavailable}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create for setup
          </PillButton>
        ) : selected ? (
          <>
            <PillButton type="button" variant="secondary" onClick={() => impersonate(selected)}>
              Impersonate
            </PillButton>
            {selected.operatorStatus === "onboarding" ? (
              <PillButton type="button" disabled={busy} onClick={() => launch(selected)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send activation email
              </PillButton>
            ) : (
              <PillButton
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => moveToOnboarding(selected)}
              >
                Disable account
              </PillButton>
            )}
          </>
        ) : null
      }
    >
      {panelMode === "create" ? (
        <form id="operator-create-broker-form" onSubmit={submitBroker} className="space-y-3">
          <Field label="Broker name">
            <input
              className={INPUT_CLASSES}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ReLease"
              required
            />
          </Field>
          <Field label="Signup link">
            <div className="flex overflow-hidden rounded-lg border border-foreground/8 bg-popover focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/8">
              <span className="flex shrink-0 items-center border-r border-foreground/8 bg-muted/35 px-3 text-label-sm text-muted-foreground">
                {BROKER_SIGNUP_PREFIX}
              </span>
              <input
                className={AFFIXED_INPUT_CLASSES}
                value={slug}
                onChange={(event) => setSlug(normalizeIdentifierInput(event.target.value))}
                placeholder="release"
              />
            </div>
            <HandleAvailability
              saving={busy}
              checking={slugChecking}
              input={slug}
              current=""
              currentLabel="Existing broker"
              availability={slug === debouncedSlug ? identifierCheck?.slug : undefined}
              renderAvailablePreview={(value) =>
                identifierCheck?.slug?.mode === "updates_existing"
                  ? `${BROKER_SIGNUP_PREFIX}${value} will update the existing broker`
                  : `${BROKER_SIGNUP_PREFIX}${value} is available`
              }
            />
          </Field>
          <Field label="Website">
            <input
              className={INPUT_CLASSES}
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://releaserent.com"
            />
          </Field>
          <Field label="Agent handle">
            <div className="flex overflow-hidden rounded-lg border border-foreground/8 bg-popover focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/8">
              <input
                className={AFFIXED_INPUT_CLASSES}
                value={agentHandle}
                onChange={(event) => setAgentHandle(normalizeIdentifierInput(event.target.value))}
                placeholder="release"
              />
              <span className="flex shrink-0 items-center border-l border-foreground/8 bg-muted/35 px-3 text-label-sm text-muted-foreground">
                @{AGENT_DOMAIN}
              </span>
            </div>
            <HandleAvailability
              saving={busy}
              checking={handleChecking}
              input={agentHandle}
              current=""
              currentLabel="Existing agent handle"
              availability={
                agentHandle === debouncedAgentHandle ? identifierCheck?.agentHandle : undefined
              }
              renderAvailablePreview={(value) =>
                identifierCheck?.agentHandle?.mode === "updates_existing"
                  ? `${value}@${AGENT_DOMAIN} will update the existing broker`
                  : `${value}@${AGENT_DOMAIN} is available`
              }
            />
          </Field>
          <Field label="Broker admin email">
            <input
              className={INPUT_CLASSES}
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="terry@example.com"
              type="email"
              required
            />
          </Field>
          <Field label="Broker admin name">
            <input
              className={INPUT_CLASSES}
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              placeholder="Terry Wang"
            />
          </Field>
          <Field label="Broker admin phone">
            <PhoneInput
              value={adminPhone}
              onChange={(value) => setAdminPhone(value ?? "")}
              defaultCountry="US"
              placeholder="(555) 123-4567"
            />
          </Field>
        </form>
      ) : selected ? (
        <section className="space-y-3">
          <Field label="Signup slug">
            <div className="flex overflow-hidden rounded-lg border border-foreground/8 bg-popover focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/8">
              <span className="flex shrink-0 items-center border-r border-foreground/8 bg-muted/35 px-3 text-label-sm text-muted-foreground">
                {BROKER_SIGNUP_PREFIX}
              </span>
              <input
                className={AFFIXED_INPUT_CLASSES}
                value={editSlug}
                onChange={(event) => {
                  setEditSlug(normalizeIdentifierInput(event.target.value));
                  markBrokerSettingsDirty();
                }}
                placeholder="release"
              />
            </div>
          </Field>
          <Field label="Website">
            <input
              className={INPUT_CLASSES}
              value={editWebsite}
              onChange={(event) => {
                setEditWebsite(event.target.value);
                markBrokerSettingsDirty();
              }}
              placeholder="https://releaserent.com"
            />
          </Field>
          <Field label="Agent handle">
            <div className="flex overflow-hidden rounded-lg border border-foreground/8 bg-popover focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/8">
              <input
                className={AFFIXED_INPUT_CLASSES}
                value={editAgentHandle}
                onChange={(event) => {
                  setEditAgentHandle(normalizeIdentifierInput(event.target.value));
                  markBrokerSettingsDirty();
                }}
                placeholder="release"
              />
              <span className="flex shrink-0 items-center border-l border-foreground/8 bg-muted/35 px-3 text-label-sm text-muted-foreground">
                @{AGENT_DOMAIN}
              </span>
            </div>
          </Field>
          <Field label="Admin name">
            <input
              className={INPUT_CLASSES}
              value={editAdminName}
              onChange={(event) => {
                setEditAdminName(event.target.value);
                markBrokerSettingsDirty();
              }}
              placeholder="Broker admin"
            />
          </Field>
          {selected.adminEmail ? (
            <Field label="Admin email">
              <input className={`${INPUT_CLASSES} text-muted-foreground`} value={selected.adminEmail} disabled />
            </Field>
          ) : null}
          <Field
            label="Admin phone"
            error={!isValidOptionalPhone(editAdminPhone) ? "Enter a valid phone number" : null}
          >
            <PhoneInput
              value={editAdminPhone}
              onChange={(value) => {
                setEditAdminPhone(value ?? "");
                markBrokerSettingsDirty();
              }}
              defaultCountry="US"
              placeholder="(555) 123-4567"
            />
          </Field>
        </section>
      ) : null}
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={actions}
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="brokers"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
      rightPanel={rightPanel}
    >
      <main className="flex w-full flex-col">
        <section className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[25%] px-4 text-label-sm text-muted-foreground">Broker</TableHead>
                <TableHead className="w-[22%] text-label-sm text-muted-foreground">Admin</TableHead>
                <TableHead className="w-[14%] text-label-sm text-muted-foreground">Slug</TableHead>
                <TableHead className="w-[14%] text-label-sm text-muted-foreground">Agent handle</TableHead>
                <TableHead className="w-[10%] text-label-sm text-muted-foreground">Clients</TableHead>
                <TableHead className="w-[10%] text-label-sm text-muted-foreground">Status</TableHead>
                <TableHead className="w-[10%] px-4 text-label-sm text-muted-foreground">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brokers === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : brokers.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="h-32 px-4 text-body-sm text-muted-foreground">
                    No broker accounts found.
                  </TableCell>
                </TableRow>
              ) : (
                brokers.map((broker) => (
                  <TableRow
                    key={broker._id}
                    tabIndex={0}
                    onClick={() => openDetails(broker)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openDetails(broker);
                    }}
                    className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selectedId === broker._id ? "bg-muted/50" : ""
                    }`}
                  >
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                      <OrgMark name={broker.name} iconUrl={broker.iconUrl} website={broker.website} />
                        <p className="truncate font-medium text-foreground">{broker.name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {broker.adminEmail ?? "No admin"}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-muted-foreground">
                      {broker.slug ? `/${broker.slug}` : "Not set"}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-muted-foreground">
                      {broker.agentHandle ?? "Not set"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{broker.clientCount}</TableCell>
                    <TableCell>
                      <Badge variant={broker.operatorStatus === "live" ? "default" : "secondary"}>
                        {broker.operatorStatus === "live" ? "Live" : "Onboarding"}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {dayjs(broker.createdAt).format("MMM D")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </main>
    </AppShell>
  );
}
