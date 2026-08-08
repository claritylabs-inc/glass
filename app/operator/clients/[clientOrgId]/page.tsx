"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  betaFeatureFlagsForOrgType,
  isFeatureEnabled,
  setFeatureFlagPatch,
  type FeatureFlagId,
} from "@/convex/lib/featureFlags";
import { AppShell } from "@/components/app-shell";
import { AgentChannelsSection } from "@/components/settings/agent-channels-section";
import { FeatureFlagToggleRow } from "@/components/settings/feature-flag-toggle-row";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { StatusTag } from "@/components/ui/status-tag";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PhoneInput } from "@/components/ui/phone-input";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  useCachedOperatorBrokers,
  useCachedOperatorClients,
  useCachedOperatorCurrent,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { OperatorSidebar } from "../../operator-sidebar";
import {
  operatorClientStatusLabel,
  type OperatorBrokerRow,
  type OperatorClientRow,
} from "../client-model";

const CLIENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "features", label: "Beta features" },
  { id: "channels", label: "Agent channels" },
] as const;

type ClientTab = (typeof CLIENT_TABS)[number]["id"];

const STANDALONE_VALUE = "__standalone__";
const AGENT_DOMAIN = getPublicAgentDomain();

function parseTab(value: string | null): ClientTab {
  return CLIENT_TABS.some((tab) => tab.id === value)
    ? (value as ClientTab)
    : "overview";
}

function normalizeIdentifierInput(value: string) {
  return (value.trim().toLowerCase().split("@")[0] ?? "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

function isValidOptionalEmail(value: string) {
  const trimmed = value.trim();
  return !trimmed || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isValidOptionalPhone(value: string) {
  const trimmed = value.trim();
  return !trimmed || isValidPhoneNumber(trimmed);
}

function slackChannelSlug(client: OperatorClientRow) {
  if (client.agentHandle) return client.agentHandle;
  return client.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function Field({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-label font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-label text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function ClientWorkspace({
  client,
  brokers,
  setShellActions,
  setRightPanel,
}: {
  client: OperatorClientRow;
  brokers: OperatorBrokerRow[];
  setShellActions: (actions: React.ReactNode) => void;
  setRightPanel: (panel: React.ReactNode) => void;
}) {
  const clientOrgId = client._id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { patchClientSettings, patchClientStatus } =
    useOperatorClientCacheActions();
  const activeTab = parseTab(searchParams.get("tab"));

  const [brokerOrgId, setBrokerOrgId] = useState(
    client.brokerOrgId ?? STANDALONE_VALUE,
  );
  const [website, setWebsite] = useState(client.website ?? "");
  const [agentHandle, setAgentHandle] = useState(client.agentHandle ?? "");
  const [contactName, setContactName] = useState(
    client.primaryContactName ?? client.adminName ?? "",
  );
  const [contactEmail, setContactEmail] = useState(
    client.primaryContactEmail ?? client.adminEmail ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    client.primaryContactPhone ?? client.adminPhone ?? "",
  );
  const [debouncedAgentHandle, setDebouncedAgentHandle] = useState("");
  const [debouncedContactPhone, setDebouncedContactPhone] = useState("");
  const [textFieldFocused, setTextFieldFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [savingFeatureFlagId, setSavingFeatureFlagId] =
    useState<FeatureFlagId | null>(null);

  const updateClientSettings = useMutation(api.operator.updateClientSettings);
  const setClientFeatureFlag = useMutation(api.operator.setClientFeatureFlag);
  const setClientStatus = useMutation(api.operator.setSoloClientStatus);
  const launchClient = useAction(api.operator.launchSoloClient);
  const startImpersonation = useMutation(api.operator.startImpersonation);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedAgentHandle(agentHandle),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [agentHandle]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedContactPhone(contactPhone.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [contactPhone]);

  const currentAgentHandle = client.agentHandle ?? "";
  const agentHandleChanged = agentHandle !== currentAgentHandle;
  const handleAvailability = useQuery(
    api.orgs.checkHandleAvailability,
    agentHandleChanged && agentHandle
      ? {
          handle: debouncedAgentHandle,
          excludeOrgId: client._id,
        }
      : "skip",
  );
  const handleChecking =
    agentHandleChanged &&
    !!agentHandle &&
    (debouncedAgentHandle !== agentHandle || handleAvailability === undefined);
  const phoneValid = isValidOptionalPhone(contactPhone);
  const phoneChanged =
    contactPhone.trim() !==
    (client.primaryContactPhone ?? client.adminPhone ?? "");
  const shouldCheckPhone = !!contactPhone.trim() && phoneValid && phoneChanged;
  const phoneAvailability = useQuery(
    api.operator.checkUserPhoneAvailability,
    shouldCheckPhone
      ? {
          phone: debouncedContactPhone,
          ownerUserId: client.adminUserId,
        }
      : "skip",
  );
  const phoneChecking =
    shouldCheckPhone &&
    (debouncedContactPhone !== contactPhone.trim() ||
      phoneAvailability === undefined);
  const phoneUnavailable =
    shouldCheckPhone && phoneAvailability?.available === false;
  const emailValid = isValidOptionalEmail(contactEmail);
  const selectedBroker =
    brokers.find((broker) => broker._id === brokerOrgId) ?? null;

  const validationError = !emailValid
    ? "Enter a valid email"
    : !phoneValid
      ? "Enter a valid phone number"
      : handleChecking
        ? "Checking agent handle"
        : agentHandleChanged &&
            agentHandle &&
            handleAvailability?.available === false
          ? (handleAvailability.reason ?? "Agent handle is not available")
          : phoneChecking
            ? "Checking phone number"
            : phoneUnavailable
              ? "This phone number is already used by another user"
              : null;

  const nextBrokerOrgId =
    brokerOrgId === STANDALONE_VALUE
      ? undefined
      : (brokerOrgId as Id<"organizations">);
  const clientSettingsArgs = {
    clientOrgId,
    brokerOrgId: nextBrokerOrgId,
    website: website.trim() || undefined,
    agentHandle: agentHandle || undefined,
    primaryContactName: contactName.trim() || undefined,
    primaryContactEmail: contactEmail.trim() || undefined,
    primaryContactPhone: contactPhone.trim() || undefined,
  };
  const clientSettingsAutoSave = useLocalFirstAutoSave({
    mutationName: "operator.updateClientSettings",
    args: clientSettingsArgs,
    valueKey: JSON.stringify(clientSettingsArgs),
    resetKey: clientOrgId,
    enabled: true,
    canSave: !validationError,
    autoSave: !textFieldFocused,
    delayMs: 700,
    flush: async (args) => {
      await updateClientSettings(args);
      const { clientOrgId: updatedClientOrgId, ...patch } = args;
      await patchClientSettings(updatedClientOrgId, {
        ...patch,
        brokerName: brokers.find((broker) => broker._id === patch.brokerOrgId)
          ?.name,
        adminName: patch.primaryContactName,
        adminPhone: patch.primaryContactPhone,
      });
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Client settings could not be saved."),
  });

  function navigate(tab: ClientTab) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.push(`/operator/clients/${clientOrgId}?${next.toString()}`);
  }

  function finishTextEdit() {
    setTextFieldFocused(false);
    void clientSettingsAutoSave.saveNow();
  }

  const saveClientSettingsNow = clientSettingsAutoSave.saveNow;

  const impersonate = useCallback(async () => {
    setBusy(true);
    try {
      if (!(await saveClientSettingsNow())) return;
      await startImpersonation({
        targetOrgId: client._id,
        targetRole: "admin",
      });
      router.push("/policies");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to impersonate client"),
      );
    } finally {
      setBusy(false);
    }
  }, [client._id, router, saveClientSettingsNow, startImpersonation]);

  async function launch() {
    setBusy(true);
    try {
      if (!(await clientSettingsAutoSave.saveNow())) return;
      await launchClient({ clientOrgId: client._id });
      await patchClientStatus(client._id, "live");
      toast.success("Client launched and login email sent");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to launch client"));
    } finally {
      setBusy(false);
    }
  }

  const disableAccount = useCallback(async () => {
    setBusy(true);
    try {
      if (!(await saveClientSettingsNow())) return;
      await setClientStatus({ clientOrgId: client._id, status: "onboarding" });
      await patchClientStatus(client._id, "onboarding");
      setDisableDialogOpen(false);
      toast.success("Client account disabled");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to update client"));
    } finally {
      setBusy(false);
    }
  }, [client._id, patchClientStatus, saveClientSettingsNow, setClientStatus]);

  async function updateFeatureFlag(flagId: FeatureFlagId, enabled: boolean) {
    const previousFlags = client.featureFlags;
    const nextFlags = setFeatureFlagPatch(previousFlags, flagId, enabled);
    setSavingFeatureFlagId(flagId);
    await patchClientSettings(client._id, { featureFlags: nextFlags });
    try {
      await setClientFeatureFlag({ clientOrgId: client._id, flagId, enabled });
      toast.success("Beta feature updated");
    } catch (error) {
      await patchClientSettings(client._id, { featureFlags: previousFlags });
      toast.error(
        getUserFacingErrorMessage(error, "Failed to update beta feature"),
      );
    } finally {
      setSavingFeatureFlagId(null);
    }
  }

  useEffect(() => {
    setShellActions(
      <>
        <AutoSaveStatus status={clientSettingsAutoSave.status} />
        <PillButton
          size="compact"
          variant="secondary"
          disabled={busy}
          onClick={() => void impersonate()}
        >
          Impersonate
        </PillButton>
      </>,
    );
  }, [busy, clientSettingsAutoSave.status, impersonate, setShellActions]);

  useEffect(
    () => () => {
      setShellActions(null);
    },
    [setShellActions],
  );

  return (
    <>
      <main className="w-full space-y-6">
        <div className="-mx-1 overflow-x-auto px-1 scrollbar-hide">
          <Tabs
            value={activeTab}
            onValueChange={(value) => navigate(value as ClientTab)}
          >
            <TabsList variant="pill" className="min-w-max">
              {CLIENT_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {activeTab === "overview" ? (
          <div className="space-y-5">
            <OperationalPanel aria-labelledby="client-identity-title">
              <OperationalPanelBody className="flex min-w-0 items-center gap-3 px-4 py-4">
                <OrgBrandIcon
                  name={client.name}
                  iconUrl={client.iconUrl}
                  website={client.website}
                  size="lg"
                />
                <h1
                  id="client-identity-title"
                  className="min-w-0 flex-1 truncate text-base font-medium text-foreground"
                >
                  {client.name}
                </h1>
                <StatusTag
                  className="ml-auto"
                  tone={
                    client.operatorStatus === "live" && !client.inviteStatus
                      ? "success"
                      : "warning"
                  }
                >
                  {operatorClientStatusLabel(client)}
                </StatusTag>
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel>
              <OperationalPanelBody>
                <FormSection title="Account" divided={false}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Broker">
                      <Select
                        value={brokerOrgId}
                        onValueChange={(value) =>
                          setBrokerOrgId(value ?? STANDALONE_VALUE)
                        }
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
                                <span className="truncate">
                                  {selectedBroker.name}
                                </span>
                              </span>
                            ) : (
                              "Standalone"
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={STANDALONE_VALUE}>
                            Standalone
                          </SelectItem>
                          {brokers.map((broker) => (
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
                      <Input
                        value={website}
                        onChange={(event) => setWebsite(event.target.value)}
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        placeholder="https://client.com"
                      />
                    </Field>
                  </div>
                </FormSection>
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel>
              <OperationalPanelBody>
                <FormSection title="Agent address" divided={false}>
                  <Field label="Email handle">
                    <div className="flex h-9 overflow-hidden rounded-lg border border-foreground/8 bg-popover focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/8">
                      <input
                        className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground/40"
                        value={agentHandle}
                        onChange={(event) =>
                          setAgentHandle(
                            normalizeIdentifierInput(event.target.value),
                          )
                        }
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        placeholder="client"
                      />
                      <span className="flex shrink-0 items-center border-l border-foreground/8 bg-muted/35 px-3 text-label text-muted-foreground">
                        @{AGENT_DOMAIN}
                      </span>
                    </div>
                    <HandleAvailability
                      saving={clientSettingsAutoSave.saving}
                      checking={handleChecking}
                      input={agentHandle}
                      current={currentAgentHandle}
                      currentLabel="Current agent handle"
                      availability={
                        agentHandle === debouncedAgentHandle
                          ? handleAvailability
                          : undefined
                      }
                      renderAvailablePreview={(value) =>
                        `${value}@${AGENT_DOMAIN} is available`
                      }
                    />
                  </Field>
                </FormSection>
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel>
              <OperationalPanelBody>
                <FormSection title="Primary contact" divided={false}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Name">
                      <Input
                        value={contactName}
                        onChange={(event) => setContactName(event.target.value)}
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        placeholder="Client contact"
                      />
                    </Field>
                    <Field
                      label="Email"
                      error={!emailValid ? "Enter a valid email" : null}
                    >
                      <Input
                        type="email"
                        value={contactEmail}
                        onChange={(event) =>
                          setContactEmail(event.target.value)
                        }
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        placeholder="client@example.com"
                      />
                    </Field>
                    <Field
                      label="Phone"
                      className="md:col-span-2"
                      error={
                        !phoneValid
                          ? "Enter a valid phone number"
                          : phoneUnavailable
                            ? "This phone number is already used by another user"
                            : null
                      }
                    >
                      <PhoneInput
                        value={contactPhone}
                        onChange={(value) => setContactPhone(value ?? "")}
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        defaultCountry="US"
                        placeholder="(555) 123-4567"
                      />
                    </Field>
                  </div>
                </FormSection>
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel>
              <OperationalPanelHeader
                className="items-center border-b-0"
                title="Account access"
                description={
                  client.operatorStatus === "onboarding"
                    ? "Send an activation email to let this client access Glass."
                    : "Disable access and return this client to onboarding."
                }
                action={
                  client.operatorStatus === "onboarding" ? (
                    <PillButton disabled={busy} onClick={() => void launch()}>
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      Send activation email
                    </PillButton>
                  ) : (
                    <PillButton
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setDisableDialogOpen(true)}
                    >
                      Disable account
                    </PillButton>
                  )
                }
              />
            </OperationalPanel>
          </div>
        ) : null}

        {activeTab === "features" ? (
          <section className="space-y-3" aria-label="Beta features">
            {betaFeatureFlagsForOrgType("client").map((flag) => (
              <FeatureFlagToggleRow
                key={flag.id}
                flag={flag}
                enabled={isFeatureEnabled(client, flag.id)}
                onChange={(enabled) => void updateFeatureFlag(flag.id, enabled)}
                loading={savingFeatureFlagId === flag.id}
                disabled={savingFeatureFlagId !== null}
              />
            ))}
          </section>
        ) : null}

        {activeTab === "channels" ? (
          <AgentChannelsSection
            clientOrgId={client._id}
            defaultClientSlug={slackChannelSlug(client)}
            defaultInviteEmail={client.primaryContactEmail ?? client.adminEmail}
            setRightPanel={setRightPanel}
          />
        ) : null}
      </main>

      <Dialog
        open={disableDialogOpen}
        onOpenChange={(open) => {
          if (!busy) setDisableDialogOpen(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Disable account</DialogTitle>
            <DialogDescription>
              Disable <strong>{client.name}</strong>? The client will lose
              access to Glass and return to onboarding. You can send a new
              activation email later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => setDisableDialogOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={busy}
              onClick={() => void disableAccount()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy ? "Disabling…" : "Disable account"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function OperatorClientPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const brokers = useCachedOperatorBrokers();
  const stopOperatorImpersonation = useStopOperatorImpersonation(
    current?.activeImpersonation,
  );
  const [workspaceActions, setWorkspaceActions] =
    useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const client = clients?.find((item) => item._id === clientOrgId) ?? null;
  const stopImpersonationAction = current?.activeImpersonation ? (
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
  ) : null;
  const actions =
    workspaceActions || stopImpersonationAction ? (
      <>
        {workspaceActions}
        {stopImpersonationAction}
      </>
    ) : null;

  return (
    <AppShell
      actions={actions}
      breadcrumbDetail={client?.name ?? "Client"}
      rightPanel={rightPanel}
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
    >
      {clients === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : !client ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Client not found" />
          <OperationalPanelBody>
            <PillButton href="/operator" variant="secondary">
              Back to clients
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <ClientWorkspace
          key={client._id}
          client={client}
          brokers={brokers ?? []}
          setShellActions={setWorkspaceActions}
          setRightPanel={setRightPanel}
        />
      )}
    </AppShell>
  );
}
