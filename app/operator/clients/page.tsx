"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { isValidPhoneNumber } from "react-phone-number-input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { FeatureFlagToggleRow } from "@/components/settings/feature-flag-toggle-row";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { Badge } from "@/components/ui/badge";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PhoneInput } from "@/components/ui/phone-input";
import { PillButton } from "@/components/ui/pill-button";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OperatorSidebar } from "../operator-sidebar";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  betaFeatureFlagsForOrgType,
  isFeatureEnabled,
  setFeatureFlagPatch,
  type FeatureFlagId,
  type FeatureFlagMap,
} from "@/convex/lib/featureFlags";
import {
  useCachedOperatorBrokers,
  useCachedOperatorClients,
  useCachedOperatorCurrent,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

type ClientRow = {
  _id: Id<"organizations">;
  name: string;
  website?: string;
  iconUrl?: string | null;
  agentHandle?: string;
  operatorStatus: "onboarding" | "live";
  inviteStatus?: "draft" | "invited";
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  featureFlags?: FeatureFlagMap;
  adminUserId?: Id<"users">;
  adminName?: string;
  adminEmail?: string;
  adminPhone?: string;
  brokerOrgId?: Id<"organizations">;
  brokerName?: string;
  createdAt: number;
};

type BrokerOption = {
  _id: Id<"organizations">;
  name: string;
  website?: string;
  iconUrl?: string | null;
};

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";
const AFFIXED_INPUT_CLASSES =
  "min-w-0 flex-1 bg-transparent px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none";
const STANDALONE_VALUE = "__standalone__";
const AGENT_DOMAIN = getPublicAgentDomain();

function normalizeIdentifierInput(value: string) {
  const withoutDomain = value.trim().toLowerCase().split("@")[0] ?? "";
  return withoutDomain.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
}

function isValidOptionalEmail(value: string) {
  const trimmed = value.trim();
  return !trimmed || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isValidOptionalPhone(value: string) {
  const trimmed = value.trim();
  return !trimmed || isValidPhoneNumber(trimmed);
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
      <span className="text-label font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="block text-label text-destructive">{error}</span> : null}
    </label>
  );
}

export default function OperatorClientsPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<Id<"organizations"> | null>(null);
  const [panelMode, setPanelMode] = useState<"create" | "details" | null>(null);
  const [name, setName] = useState("");
  const [brokerOrgId, setBrokerOrgId] = useState<string>(STANDALONE_VALUE);
  const [website, setWebsite] = useState("");
  const [agentHandle, setAgentHandle] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [editBrokerOrgId, setEditBrokerOrgId] = useState<string>(STANDALONE_VALUE);
  const [editWebsite, setEditWebsite] = useState("");
  const [editAgentHandle, setEditAgentHandle] = useState("");
  const [editPrimaryContactName, setEditPrimaryContactName] = useState("");
  const [editPrimaryContactEmail, setEditPrimaryContactEmail] = useState("");
  const [editPrimaryContactPhone, setEditPrimaryContactPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingFeatureFlagId, setSavingFeatureFlagId] = useState<FeatureFlagId | null>(null);
  const [debouncedAgentHandle, setDebouncedAgentHandle] = useState("");
  const [debouncedEditAgentHandle, setDebouncedEditAgentHandle] = useState("");
  const [debouncedAdminPhone, setDebouncedAdminPhone] = useState("");
  const [debouncedEditPrimaryContactPhone, setDebouncedEditPrimaryContactPhone] = useState("");

  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients() as ClientRow[] | undefined;
  const brokers = useCachedOperatorBrokers() as BrokerOption[] | undefined;
  const { seedClient, patchClientStatus, patchClientSettings } = useOperatorClientCacheActions();
  const handleAvailability = useQuery(
    api.orgs.checkHandleAvailability,
    debouncedAgentHandle ? { handle: debouncedAgentHandle } : "skip",
  );
  const createPhoneValid = isValidOptionalPhone(adminPhone);
  const createShouldCheckPhone = !!adminPhone.trim() && createPhoneValid;
  const createPhoneAvailability = useQuery(
    api.operator.checkUserPhoneAvailability,
    createShouldCheckPhone ? { phone: debouncedAdminPhone } : "skip",
  );
  const createClient = useAction(api.operator.createSoloClient);
  const launchClient = useAction(api.operator.launchSoloClient);
  const setClientStatus = useMutation(api.operator.setSoloClientStatus);
  const updateClientSettings = useMutation(api.operator.updateClientSettings);
  const setClientFeatureFlag = useMutation(api.operator.setClientFeatureFlag);
  const startImpersonation = useMutation(api.operator.startImpersonation);
  const stopOperatorImpersonation = useStopOperatorImpersonation();

  const selected = useMemo(
    () => clients?.find((client) => client._id === selectedId) ?? null,
    [clients, selectedId],
  );
  const selectedBroker = useMemo(
    () => brokers?.find((broker) => broker._id === brokerOrgId) ?? null,
    [brokerOrgId, brokers],
  );
  const selectedEditBroker = useMemo(
    () => brokers?.find((broker) => broker._id === editBrokerOrgId) ?? null,
    [editBrokerOrgId, brokers],
  );
  const editPhoneValid = isValidOptionalPhone(editPrimaryContactPhone);
  const editPhoneChanged =
    editPrimaryContactPhone.trim() !== (selected?.primaryContactPhone ?? "");
  const editShouldCheckPhone = !!editPrimaryContactPhone.trim() && editPhoneValid && editPhoneChanged;
  const editPhoneAvailability = useQuery(
    api.operator.checkUserPhoneAvailability,
    editShouldCheckPhone
      ? {
          phone: debouncedEditPrimaryContactPhone,
          ownerUserId: selected?.adminUserId,
        }
      : "skip",
  );
  const currentEditAgentHandle = selected?.agentHandle ?? "";
  const editAgentHandleChanged = editAgentHandle !== currentEditAgentHandle;
  const editHandleAvailability = useQuery(
    api.orgs.checkHandleAvailability,
    editAgentHandleChanged && editAgentHandle
      ? {
          handle: debouncedEditAgentHandle,
          excludeOrgId: selected?._id,
        }
      : "skip",
  );
  const editHandleChecking =
    editAgentHandleChanged &&
    !!editAgentHandle &&
    (debouncedEditAgentHandle !== editAgentHandle ||
      editHandleAvailability === undefined);
  function clientSettingsError() {
    if (!isValidOptionalEmail(editPrimaryContactEmail)) {
      return "Enter a valid email";
    }
    if (!editPhoneValid) return "Enter a valid phone number";
    if (editHandleChecking) return "Checking agent handle";
    if (
      editAgentHandleChanged &&
      editAgentHandle &&
      editHandleAvailability?.available === false
    ) {
      return editHandleAvailability.reason ?? "Agent handle is not available";
    }
    if (
      editShouldCheckPhone &&
      (debouncedEditPrimaryContactPhone !== editPrimaryContactPhone.trim() ||
        editPhoneAvailability === undefined)
    ) {
      return "Checking phone number";
    }
    if (editShouldCheckPhone && editPhoneAvailability?.available === false) {
      return "This phone number is already used by another user";
    }
    return null;
  }

  const clientSettingsValidationError = clientSettingsError();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAgentHandle(agentHandle), 250);
    return () => window.clearTimeout(timer);
  }, [agentHandle]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedEditAgentHandle(editAgentHandle),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [editAgentHandle]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAdminPhone(adminPhone.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [adminPhone]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedEditPrimaryContactPhone(editPrimaryContactPhone.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [editPrimaryContactPhone]);

  const handleChecking =
    agentHandle.length >= 3 &&
    (agentHandle !== debouncedAgentHandle || handleAvailability === undefined);
  const handleUnavailable = !!agentHandle && handleAvailability?.available === false;
  const createPhoneChecking =
    createShouldCheckPhone &&
    (debouncedAdminPhone !== adminPhone.trim() || createPhoneAvailability === undefined);
  const createPhoneUnavailable =
    createShouldCheckPhone && createPhoneAvailability?.available === false;
  const createPhoneError = !createPhoneValid
    ? "Enter a valid phone number"
    : createPhoneChecking
      ? "Checking phone number"
      : createPhoneUnavailable
        ? "This phone number is already used by another user"
        : null;

  async function submitClient(event: React.FormEvent) {
    event.preventDefault();
    if (createPhoneError) return;
    setBusy(true);
    try {
      const result = await createClient({
        name,
        brokerOrgId: brokerOrgId === STANDALONE_VALUE
          ? undefined
          : brokerOrgId as Id<"organizations">,
        website: website || undefined,
        agentHandle: agentHandle || undefined,
        adminEmail,
        adminName: adminName || undefined,
        adminPhone: adminPhone || undefined,
      });
      toast.success("Client created for setup");
      if (result?.clientOrgId) {
        await seedClient({
          clientOrgId: result.clientOrgId,
          name,
          brokerOrgId: brokerOrgId === STANDALONE_VALUE
            ? undefined
            : brokerOrgId as Id<"organizations">,
          brokerName: selectedBroker?.name,
          website: website || undefined,
          agentHandle: agentHandle || undefined,
          adminEmail,
          adminName: adminName || undefined,
          adminPhone: adminPhone || undefined,
        });
        setSelectedId(result.clientOrgId);
      }
      setName("");
      setBrokerOrgId(STANDALONE_VALUE);
      setWebsite("");
      setAgentHandle("");
      setAdminEmail("");
      setAdminName("");
      setAdminPhone("");
      setPanelMode(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create client");
    } finally {
      setBusy(false);
    }
  }

  async function impersonate(client: ClientRow) {
    await startImpersonation({ targetOrgId: client._id, targetRole: "admin" });
    router.push("/policies");
  }

  async function launch(client: ClientRow) {
    setBusy(true);
    try {
      await launchClient({ clientOrgId: client._id });
      await patchClientStatus(client._id, "live");
      toast.success("Client launched and login email sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to launch client");
    } finally {
      setBusy(false);
    }
  }

  function contactEmail(client: ClientRow) {
    return client.adminEmail ?? client.primaryContactEmail;
  }

  function brokerLabel(client: ClientRow) {
    return client.brokerName ?? "Standalone";
  }

  function primeEditState(client: ClientRow) {
    setEditBrokerOrgId(client.brokerOrgId ?? STANDALONE_VALUE);
    setEditWebsite(client.website ?? "");
    setEditAgentHandle(client.agentHandle ?? "");
    setEditPrimaryContactName(client.primaryContactName ?? client.adminName ?? "");
    setEditPrimaryContactEmail(client.primaryContactEmail ?? client.adminEmail ?? "");
    setEditPrimaryContactPhone(client.primaryContactPhone ?? "");
    setSettingsDirty(false);
  }

  function openDetails(client: ClientRow) {
    setSelectedId(client._id);
    primeEditState(client);
    setPanelMode("details");
  }

  function markClientSettingsDirty() {
    setSettingsDirty(true);
  }

  const nextBrokerOrgId =
    editBrokerOrgId === STANDALONE_VALUE
      ? undefined
      : editBrokerOrgId as Id<"organizations">;
  const clientSettingsArgs = {
    clientOrgId: selected?._id ?? ("" as Id<"organizations">),
    brokerOrgId: nextBrokerOrgId,
    website: editWebsite || undefined,
    agentHandle: editAgentHandle || undefined,
    primaryContactName: editPrimaryContactName || undefined,
    primaryContactEmail: editPrimaryContactEmail || undefined,
    primaryContactPhone: editPrimaryContactPhone || undefined,
  };
  const clientSettingsValueKey = JSON.stringify(clientSettingsArgs);
  const clientSettingsAutoSave = useLocalFirstAutoSave({
    mutationName: "operator.updateClientSettings",
    args: clientSettingsArgs,
    valueKey: clientSettingsValueKey,
    resetKey: selected?._id ?? "none",
    enabled: panelMode === "details" && !!selected,
    canSave: !clientSettingsValidationError,
    delayMs: 800,
    flush: async (args) => {
      await updateClientSettings(args);
      const { clientOrgId, ...patch } = args;
      await patchClientSettings(clientOrgId, {
        ...patch,
        brokerName: brokers?.find((broker) => broker._id === patch.brokerOrgId)?.name,
        adminName: patch.primaryContactName,
        adminPhone: patch.primaryContactPhone,
      });
    },
    onFlushed: (_result, args) => {
      if (clientSettingsValueKey === JSON.stringify(args)) {
        setSettingsDirty(false);
      }
    },
    errorMessage: (error) =>
      error instanceof Error ? error.message : "Client settings could not be saved.",
  });

  async function moveToOnboarding(client: ClientRow) {
    setBusy(true);
    try {
      await setClientStatus({ clientOrgId: client._id, status: "onboarding" });
      await patchClientStatus(client._id, "onboarding");
      toast.success("Client account disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update client");
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
            await stopOperatorImpersonation();
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
        Create client
      </PillButton>
    </>
  );
  const clientBetaFlags = betaFeatureFlagsForOrgType("client");

  async function updateClientFeatureFlag(
    client: ClientRow,
    flagId: FeatureFlagId,
    enabled: boolean,
  ) {
    const previousFlags = client.featureFlags;
    const nextFlags = setFeatureFlagPatch(previousFlags, flagId, enabled);
    setSavingFeatureFlagId(flagId);
    await patchClientSettings(client._id, { featureFlags: nextFlags });
    try {
      await setClientFeatureFlag({ clientOrgId: client._id, flagId, enabled });
      toast.success("Beta feature updated");
    } catch (error) {
      await patchClientSettings(client._id, { featureFlags: previousFlags });
      toast.error(error instanceof Error ? error.message : "Failed to update beta feature");
    } finally {
      setSavingFeatureFlagId(null);
    }
  }

  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (panelMode !== "details" || !settingsDirty) {
          setPanelMode(null);
          return;
        }
        void clientSettingsAutoSave.saveNow().then((saved) => {
          if (saved) setPanelMode(null);
        });
      }}
      title={
        panelMode === "create" || !selected ? (
          "Create client"
        ) : (
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="min-w-0 truncate">{selected.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant={selected.operatorStatus === "live" ? "default" : "secondary"}>
                {selected.operatorStatus === "live" ? "Live" : "Onboarding"}
              </Badge>
              <AutoSaveStatus status={clientSettingsAutoSave.status} />
            </span>
          </span>
        )
      }
      footer={
        panelMode === "create" ? (
          <PillButton
            type="submit"
            form="operator-create-client-form"
            disabled={busy || !name || !adminEmail || handleUnavailable || !!createPhoneError}
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
        <form id="operator-create-client-form" onSubmit={submitClient} className="space-y-3">
          <Field label="Client name">
            <input
              className={INPUT_CLASSES}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ReLease"
              required
            />
          </Field>
          <Field label="Broker">
            <Select
              value={brokerOrgId}
              onValueChange={(value) => setBrokerOrgId(value ?? STANDALONE_VALUE)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {selectedBroker ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <OrgBrandIcon
                        name={selectedBroker.name}
                        iconUrl={selectedBroker.iconUrl}
                        website={selectedBroker.website}
                        size="sm"
                      />
                      <span className="truncate">{selectedBroker.name}</span>
                    </span>
                  ) : (
                    "Standalone"
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STANDALONE_VALUE}>Standalone</SelectItem>
                {(brokers ?? []).map((broker) => (
                  <SelectItem key={broker._id} value={broker._id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <OrgBrandIcon
                        name={broker.name}
                        iconUrl={broker.iconUrl}
                        website={broker.website}
                        size="sm"
                      />
                      <span className="truncate">{broker.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <span className="flex shrink-0 items-center border-l border-foreground/8 bg-muted/35 px-3 text-label text-muted-foreground">
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
                agentHandle === debouncedAgentHandle ? handleAvailability : undefined
              }
              renderAvailablePreview={(value) => `${value}@${AGENT_DOMAIN} is available`}
            />
          </Field>
          <Field label="Client admin email">
            <input
              className={INPUT_CLASSES}
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="terry@example.com"
              type="email"
              required
            />
          </Field>
          <Field label="Client admin name">
            <input
              className={INPUT_CLASSES}
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              placeholder="Terry Wang"
            />
          </Field>
          <Field label="Client admin phone" error={createPhoneError}>
            <PhoneInput
              value={adminPhone}
              onChange={(value) => setAdminPhone(value ?? "")}
              defaultCountry="US"
              placeholder="(555) 123-4567"
            />
          </Field>
        </form>
      ) : selected ? (
        <div className="space-y-4">
          <section className="space-y-3">
            <Field label="Broker">
              <Select
                value={editBrokerOrgId}
                onValueChange={(value) => {
                  setEditBrokerOrgId(value ?? STANDALONE_VALUE);
                  markClientSettingsDirty();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {selectedEditBroker ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <OrgBrandIcon
                          name={selectedEditBroker.name}
                          iconUrl={selectedEditBroker.iconUrl}
                          website={selectedEditBroker.website}
                          size="sm"
                        />
                        <span className="truncate">{selectedEditBroker.name}</span>
                      </span>
                    ) : (
                      "Standalone"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STANDALONE_VALUE}>Standalone</SelectItem>
                  {(brokers ?? []).map((broker) => (
                    <SelectItem key={broker._id} value={broker._id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <OrgBrandIcon
                          name={broker.name}
                          iconUrl={broker.iconUrl}
                          website={broker.website}
                          size="sm"
                        />
                        <span className="truncate">{broker.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Website">
              <input
                className={INPUT_CLASSES}
                value={editWebsite}
                onChange={(event) => {
                  setEditWebsite(event.target.value);
                  markClientSettingsDirty();
                }}
                placeholder="https://client.com"
              />
            </Field>
            <Field label="Agent handle">
              <div className="flex overflow-hidden rounded-lg border border-foreground/8 bg-popover focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/8">
                <input
                  className={AFFIXED_INPUT_CLASSES}
                  value={editAgentHandle}
                  onChange={(event) => {
                    setEditAgentHandle(normalizeIdentifierInput(event.target.value));
                    markClientSettingsDirty();
                  }}
                  placeholder="client"
                />
                <span className="flex shrink-0 items-center border-l border-foreground/8 bg-muted/35 px-3 text-label text-muted-foreground">
                  @{AGENT_DOMAIN}
                </span>
              </div>
              <HandleAvailability
                saving={clientSettingsAutoSave.saving}
                checking={editHandleChecking}
                input={editAgentHandle}
                current={currentEditAgentHandle}
                currentLabel="Current agent handle"
                availability={
                  editAgentHandle === debouncedEditAgentHandle
                    ? editHandleAvailability
                    : undefined
                }
                renderAvailablePreview={(value) =>
                  `${value}@${AGENT_DOMAIN} is available`
                }
              />
            </Field>
            <Field label="Primary contact name">
              <input
                className={INPUT_CLASSES}
                value={editPrimaryContactName}
                onChange={(event) => {
                  setEditPrimaryContactName(event.target.value);
                  markClientSettingsDirty();
                }}
                placeholder="Client contact"
              />
            </Field>
            <Field
              label="Primary contact email"
              error={!isValidOptionalEmail(editPrimaryContactEmail) ? "Enter a valid email" : null}
            >
              <input
                className={INPUT_CLASSES}
                value={editPrimaryContactEmail}
                onChange={(event) => {
                  setEditPrimaryContactEmail(event.target.value);
                  markClientSettingsDirty();
                }}
                placeholder="client@example.com"
                type="email"
              />
            </Field>
            <Field
              label="Primary contact phone"
              error={!isValidOptionalPhone(editPrimaryContactPhone) ? "Enter a valid phone number" : null}
            >
              <PhoneInput
                value={editPrimaryContactPhone}
                onChange={(value) => {
                  setEditPrimaryContactPhone(value ?? "");
                  markClientSettingsDirty();
                }}
                defaultCountry="US"
                placeholder="(555) 123-4567"
              />
            </Field>
          </section>
          <section className="space-y-3 border-t border-foreground/8 pt-4">
            <p className="text-base font-medium text-foreground">Beta Features</p>
            {clientBetaFlags.map((flag) => (
              <FeatureFlagToggleRow
                key={flag.id}
                flag={flag}
                enabled={isFeatureEnabled(selected, flag.id)}
                onChange={(enabled) =>
                  void updateClientFeatureFlag(selected, flag.id, enabled)
                }
                loading={savingFeatureFlagId === flag.id}
                disabled={savingFeatureFlagId !== null}
              />
            ))}
          </section>
        </div>
      ) : null}
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={actions}
      breadcrumbDetail="Clients"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="clients"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
      rightPanel={rightPanel}
    >
      <main className="flex w-full flex-col">
        <OperationalPanel>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[25%] px-4 text-label text-muted-foreground">Client</TableHead>
                <TableHead className="w-[20%] text-label text-muted-foreground">Broker</TableHead>
                <TableHead className="w-[22%] text-label text-muted-foreground">Admin</TableHead>
                <TableHead className="w-[18%] text-label text-muted-foreground">Website</TableHead>
                <TableHead className="w-[10%] text-label text-muted-foreground">Status</TableHead>
                <TableHead className="w-[8%] px-4 text-label text-muted-foreground">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="h-32 px-4 text-base text-muted-foreground">
                    No client accounts found.
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((client) => (
                  <TableRow
                    key={client._id}
                    tabIndex={0}
                    onClick={() => openDetails(client)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openDetails(client);
                    }}
                    className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selectedId === client._id ? "bg-muted/50" : ""
                    }`}
                  >
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <OrgBrandIcon
                          name={client.name}
                          iconUrl={client.iconUrl}
                          website={client.website}
                          size="md"
                        />
                        <p className="truncate font-medium text-foreground">{client.name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {brokerLabel(client)}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {contactEmail(client) ?? "No admin"}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">
                      {client.website ?? "Not set"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={client.operatorStatus === "live" && !client.inviteStatus ? "default" : "secondary"}>
                        {client.inviteStatus === "draft"
                          ? "Draft"
                          : client.inviteStatus === "invited"
                            ? "Invited"
                            : client.operatorStatus === "live"
                              ? "Live"
                              : "Onboarding"}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {dayjs(client.createdAt).format("MMM D")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </OperationalPanel>
      </main>
    </AppShell>
  );
}
