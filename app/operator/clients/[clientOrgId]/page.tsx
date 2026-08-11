"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
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
import {
  OrganizationInsuranceProfile,
  type OrganizationProfile,
} from "@/components/settings/organization-insurance-profile";
import { TeamSection } from "@/components/settings/team-section";
import {
  AutoSaveStatus,
  combineAutoSaveStatuses,
} from "@/components/ui/auto-save-status";
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
import {
  useCachedOperatorBrokers,
  useCachedOperatorClients,
  useCachedOperatorCurrent,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  ClientCompanyDetails,
  type OperatorClientRelatedLegalEntity,
} from "./client-company-details";
import { OperatorSidebar } from "../../operator-sidebar";
import {
  operatorClientStatusLabel,
  type OperatorBrokerRow,
  type OperatorClientRow,
} from "../client-model";
import { typeStyle } from "@/lib/typography";

const CLIENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "team", label: "Team" },
  { id: "features", label: "Beta features" },
  { id: "channels", label: "Agent channels" },
] as const;

type ClientTab = (typeof CLIENT_TABS)[number]["id"];
type ClientSupportDetails = NonNullable<
  FunctionReturnType<typeof api.operator.getClientSupportDetails>
>;

const STANDALONE_VALUE = "__standalone__";

function parseTab(value: string | null): ClientTab {
  if (value === "email" || value === "imessage" || value === "slack") {
    return "channels";
  }
  return CLIENT_TABS.some((tab) => tab.id === value)
    ? (value as ClientTab)
    : "overview";
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
      <span className={`mb-1.5 block text-muted-foreground ${typeStyle("caption.medium")}`}>
        {label}
      </span>
      {children}
      {error ? (
        <span className={`mt-1.5 block text-destructive ${typeStyle("caption.default")}`}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

function ClientWorkspace({
  client,
  supportDetails,
  brokers,
  setShellActions,
  setRightPanel,
}: {
  client: OperatorClientRow;
  supportDetails: ClientSupportDetails;
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
  const [organizationName, setOrganizationName] = useState(supportDetails.name);
  const [brokerOrgId, setBrokerOrgId] = useState(
    supportDetails.brokerOrgId ?? STANDALONE_VALUE,
  );
  const [website, setWebsite] = useState(supportDetails.website ?? "");
  const [industry, setIndustry] = useState(supportDetails.industry ?? "");
  const [industryVertical, setIndustryVertical] = useState(
    supportDetails.industryVertical ?? "",
  );
  const [relatedLegalEntities, setRelatedLegalEntities] = useState<
    OperatorClientRelatedLegalEntity[]
  >(supportDetails.relatedLegalEntities ?? []);
  const [textFieldFocused, setTextFieldFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [teamInviteOpen, setTeamInviteOpen] = useState(false);
  const [savingFeatureFlagId, setSavingFeatureFlagId] =
    useState<FeatureFlagId | null>(null);
  const [profileAutoSaveStatus, setProfileAutoSaveStatus] = useState<
    "saved" | "saving" | "unsaved" | "error"
  >("saved");

  const updateClientSettings = useMutation(api.operator.updateClientSettings);
  const updateOrganizationProfile = useMutation(
    api.orgs.updateOrganizationProfile,
  );
  const setClientFeatureFlag = useMutation(api.operator.setClientFeatureFlag);
  const setClientStatus = useMutation(api.operator.setSoloClientStatus);
  const startImpersonation = useMutation(api.operator.startImpersonation);

  const selectedBroker =
    brokers.find((broker) => broker._id === brokerOrgId) ?? null;

  const validationError = !organizationName.trim()
    ? "Organization name is required"
    : null;

  const nextBrokerOrgId =
    brokerOrgId === STANDALONE_VALUE
      ? undefined
      : (brokerOrgId as Id<"organizations">);
  const clientSettingsArgs = {
    clientOrgId,
    name: organizationName.trim(),
    brokerOrgId: nextBrokerOrgId,
    website: website.trim() || undefined,
    industry: industry || undefined,
    industryVertical: industryVertical || undefined,
    relatedLegalEntities: relatedLegalEntities
      .map((entity) => ({
        ...entity,
        legalName: entity.legalName.trim(),
      }))
      .filter((entity) => entity.legalName),
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
      });
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Client settings could not be saved."),
  });
  const combinedSaveStatus = combineAutoSaveStatuses(
    clientSettingsAutoSave.status,
    profileAutoSaveStatus,
  );

  function navigate(tab: ClientTab) {
    if (tab !== "team") setTeamInviteOpen(false);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.push(`/operator/clients/${clientOrgId}?${next.toString()}`);
  }

  function finishTextEdit() {
    setTextFieldFocused(false);
    void clientSettingsAutoSave.saveNow();
  }

  function requestClientSettingsSave() {
    requestAnimationFrame(() => {
      void clientSettingsAutoSave.saveNow();
    });
  }

  const saveOrganizationProfile = useCallback(
    (profile: OrganizationProfile | null) =>
      updateOrganizationProfile({
        operatorClientOrgId: clientOrgId,
        profile,
      }),
    [clientOrgId, updateOrganizationProfile],
  );

  const handleProfileAutoSaveChange = useCallback(
    (status: "saved" | "saving" | "unsaved" | "error") => {
      setProfileAutoSaveStatus(status);
    },
    [],
  );

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
    if (activeTab === "overview") {
      setShellActions(
        <>
          <AutoSaveStatus status={combinedSaveStatus} />
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
    } else if (activeTab === "team") {
      setShellActions(
        <PillButton
          size="compact"
          variant="secondary"
          onClick={() => setTeamInviteOpen(true)}
        >
          <UserPlus className="size-3.5" />
          Invite member
        </PillButton>,
      );
    } else {
      setShellActions(null);
    }

    return () => {
      setShellActions(null);
    };
  }, [activeTab, busy, combinedSaveStatus, impersonate, setShellActions]);

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
                  className={`min-w-0 flex-1 truncate text-foreground ${typeStyle("heading.micro")}`}
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
                    <Field label="Organization name">
                      <Input
                        value={organizationName}
                        onChange={(event) =>
                          setOrganizationName(event.target.value)
                        }
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        placeholder="Client organization"
                      />
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
                    <Field label="Broker" className="md:col-span-2">
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
                  </div>
                </FormSection>
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel aria-label="Company details and insurance profile">
              <OperationalPanelBody className="space-y-4">
                <ClientCompanyDetails
                  industry={industry}
                  industryVertical={industryVertical}
                  relatedLegalEntities={relatedLegalEntities}
                  setIndustry={setIndustry}
                  setIndustryVertical={setIndustryVertical}
                  setRelatedLegalEntities={setRelatedLegalEntities}
                  onSaveRequested={requestClientSettingsSave}
                  onTextFocus={() => setTextFieldFocused(true)}
                  onTextBlur={finishTextEdit}
                />
                <OrganizationInsuranceProfile
                  key={String(supportDetails._id)}
                  org={supportDetails}
                  onSaveProfile={saveOrganizationProfile}
                  onAutoSaveChange={handleProfileAutoSaveChange}
                />
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel>
              <OperationalPanelHeader
                className="items-center border-b-0"
                title="Account access"
                description={
                  client.operatorStatus === "onboarding"
                    ? "Send an activation email to an admin from Team to enable access."
                    : "Activation emails can be resent to admins who have not activated their account."
                }
                action={
                  client.operatorStatus === "onboarding" ? (
                    <PillButton
                      variant="secondary"
                      onClick={() => navigate("team")}
                    >
                      Open team
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

        {activeTab === "team" ? (
          <TeamSection
            operatorClient={supportDetails}
            inviteOpen={teamInviteOpen}
            onInviteOpenChange={setTeamInviteOpen}
            showInviteAction={false}
            setOperatorRightPanel={setRightPanel}
            onOperatorActivationSent={() =>
              patchClientStatus(client._id, "live")
            }
          />
        ) : null}

        {activeTab === "channels" ? (
          <AgentChannelsSection
            clientOrgId={client._id}
            defaultClientSlug={slackChannelSlug(client)}
            defaultInviteEmail={client.primaryContactEmail ?? client.adminEmail}
            defaultInviteUserId={supportDetails.primaryInsuranceContactId}
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
  const supportDetails = useQuery(api.operator.getClientSupportDetails, {
    clientOrgId: clientOrgId as Id<"organizations">,
  });
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
          active="clients"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
    >
      {clients === undefined || supportDetails === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : !client || !supportDetails ? (
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
          supportDetails={supportDetails}
          brokers={brokers ?? []}
          setShellActions={setWorkspaceActions}
          setRightPanel={setRightPanel}
        />
      )}
    </AppShell>
  );
}
