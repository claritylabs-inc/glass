"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { isValidPhoneNumber } from "react-phone-number-input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { StatusTag } from "@/components/ui/status-tag";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { PhoneInput } from "@/components/ui/phone-input";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@/components/ui/input";
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
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { OperatorSidebar } from "../operator-sidebar";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  useCachedOperatorBrokers,
  useCachedOperatorClients,
  useCachedOperatorCurrent,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import { formatDisplayDate } from "@/lib/date-format";
import {
  operatorClientStatusLabel,
  type OperatorClientRow,
} from "./client-model";

const STANDALONE_VALUE = "__standalone__";
const AGENT_DOMAIN = getPublicAgentDomain();

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
      <span className="text-label font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {error ? (
        <span className="block text-label text-destructive">{error}</span>
      ) : null}
    </label>
  );
}

export default function OperatorClientsScreen() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<Id<"organizations"> | null>(
    null,
  );
  const [panelMode, setPanelMode] = useState<"create" | "details" | null>(null);
  const [name, setName] = useState("");
  const [brokerOrgId, setBrokerOrgId] = useState<string>(STANDALONE_VALUE);
  const [website, setWebsite] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [debouncedAdminPhone, setDebouncedAdminPhone] = useState("");

  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const brokers = useCachedOperatorBrokers();
  const { seedClient } = useOperatorClientCacheActions();
  const createPhoneValid = isValidOptionalPhone(adminPhone);
  const createShouldCheckPhone = !!adminPhone.trim() && createPhoneValid;
  const createPhoneAvailability = useQuery(
    api.operator.checkUserPhoneAvailability,
    createShouldCheckPhone ? { phone: debouncedAdminPhone } : "skip",
  );
  const createClient = useAction(api.operator.createSoloClient);
  const startImpersonation = useMutation(api.operator.startImpersonation);
  const stopOperatorImpersonation = useStopOperatorImpersonation(
    current?.activeImpersonation,
  );

  const selected = useMemo(
    () => clients?.find((client) => client._id === selectedId) ?? null,
    [clients, selectedId],
  );
  const selectedBroker = useMemo(
    () => brokers?.find((broker) => broker._id === brokerOrgId) ?? null,
    [brokerOrgId, brokers],
  );
  const channelOverview = useQuery(
    api.agentChannels.getForOperator,
    selected && panelMode === "details"
      ? { clientOrgId: selected._id }
      : "skip",
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedAdminPhone(adminPhone.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [adminPhone]);

  const createPhoneChecking =
    createShouldCheckPhone &&
    (debouncedAdminPhone !== adminPhone.trim() ||
      createPhoneAvailability === undefined);
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
        brokerOrgId:
          brokerOrgId === STANDALONE_VALUE
            ? undefined
            : (brokerOrgId as Id<"organizations">),
        website: website || undefined,
        adminEmail,
        adminName: adminName || undefined,
        adminPhone: adminPhone || undefined,
      });
      toast.success("Client created for setup");
      if (result?.clientOrgId) {
        await seedClient({
          clientOrgId: result.clientOrgId,
          name,
          brokerOrgId:
            brokerOrgId === STANDALONE_VALUE
              ? undefined
              : (brokerOrgId as Id<"organizations">),
          brokerName: selectedBroker?.name,
          website: website || undefined,
          adminEmail,
          adminName: adminName || undefined,
          adminPhone: adminPhone || undefined,
        });
        router.push(`/operator/clients/${result.clientOrgId}`);
      }
      setName("");
      setBrokerOrgId(STANDALONE_VALUE);
      setWebsite("");
      setAdminEmail("");
      setAdminName("");
      setAdminPhone("");
      setPanelMode(null);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to create client"));
    } finally {
      setBusy(false);
    }
  }

  async function impersonate(client: OperatorClientRow) {
    setBusy(true);
    try {
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
  }

  function contactEmail(client: OperatorClientRow) {
    return client.primaryContactEmail ?? client.adminEmail;
  }

  function brokerLabel(client: OperatorClientRow) {
    return client.brokerName ?? "Standalone";
  }

  function openDetails(client: OperatorClientRow) {
    setSelectedId(client._id);
    setPanelMode("details");
  }

  function openCreate() {
    setPanelMode("create");
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
      <PillButton size="compact" variant="secondary" onClick={openCreate}>
        Create client
      </PillButton>
    </>
  );
  const enabledChannels = channelOverview
    ? [
        channelOverview.settings.emailEnabled ? "Email" : null,
        channelOverview.settings.imessageEnabled ? "iMessage" : null,
        channelOverview.settings.slackEnabled ? "Slack" : null,
      ]
        .filter(Boolean)
        .join(", ") || "None"
    : null;

  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPanelMode(null);
          setSelectedId(null);
        }
      }}
      title={
        panelMode === "create" || !selected ? (
          "Create client"
        ) : (
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="min-w-0 truncate">{selected.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <StatusTag
                tone={
                  selected.operatorStatus === "live" && !selected.inviteStatus
                    ? "success"
                    : "warning"
                }
              >
                {operatorClientStatusLabel(selected)}
              </StatusTag>
            </span>
          </span>
        )
      }
      footer={
        panelMode === "create" ? (
          <PillButton
            type="submit"
            form="operator-create-client-form"
            disabled={
              busy ||
              !name ||
              !adminEmail ||
              !!createPhoneError
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create for setup
          </PillButton>
        ) : selected ? (
          <>
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => void impersonate(selected)}
            >
              Impersonate
            </PillButton>
            <PillButton href={`/operator/clients/${selected._id}`}>
              Manage client
            </PillButton>
          </>
        ) : null
      }
    >
      {panelMode === "create" ? (
        <form
          id="operator-create-client-form"
          onSubmit={submitClient}
          className="space-y-3"
        >
          <Field label="Client name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ReLease"
              required
            />
          </Field>
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
            <Input
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://releaserent.com"
            />
          </Field>
          <Field label="Client admin email">
            <Input
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="terry@example.com"
              type="email"
              required
            />
          </Field>
          <Field label="Client admin name">
            <Input
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
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <OrgBrandIcon
              name={selected.name}
              iconUrl={selected.iconUrl}
              website={selected.website}
              size="lg"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-foreground">
                {selected.primaryContactName ??
                  selected.adminName ??
                  "No primary contact"}
              </p>
              <p className="truncate text-base text-muted-foreground">
                {contactEmail(selected) ?? "No contact email"}
              </p>
            </div>
          </div>

          <OperationalLabelValueList title="Client details">
            <OperationalLabelValueRow
              label="Broker"
              value={brokerLabel(selected)}
            />
            <OperationalLabelValueRow
              label="Website"
              value={selected.website ?? "Not set"}
            />
            <OperationalLabelValueRow
              label="Created"
              value={formatDisplayDate(selected.createdAt)}
            />
          </OperationalLabelValueList>

          <OperationalLabelValueList title="Agent channels">
            <OperationalLabelValueRow
              label="Active channels"
              value={
                enabledChannels ?? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )
              }
            />
            <OperationalLabelValueRow
              label="Email"
              value={
                channelOverview ? (
                  channelOverview.agentEmailAddress.handle ? (
                    `${channelOverview.agentEmailAddress.handle}@${AGENT_DOMAIN}`
                  ) : (
                    "Not configured"
                  )
                ) : (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )
              }
            />
            <OperationalLabelValueRow
              label="Slack"
              value={
                channelOverview ? (
                  channelOverview.connection ? (
                    `${channelOverview.connection.teamName}${
                      channelOverview.joinedChannels.length > 0
                        ? ` · ${channelOverview.joinedChannels.length} joined ${channelOverview.joinedChannels.length === 1 ? "channel" : "channels"}`
                        : " · No joined channels"
                    }`
                  ) : (
                    "Not connected"
                  )
                ) : (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )
              }
            />
          </OperationalLabelValueList>
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
                <TableHead className="w-[25%] px-4 text-label text-muted-foreground">
                  Client
                </TableHead>
                <TableHead className="w-[20%] text-label text-muted-foreground">
                  Broker
                </TableHead>
                <TableHead className="w-[22%] text-label text-muted-foreground">
                  Admin
                </TableHead>
                <TableHead className="w-[18%] text-label text-muted-foreground">
                  Website
                </TableHead>
                <TableHead className="w-[10%] text-label text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="w-[8%] px-4 text-label text-muted-foreground">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="h-32 px-4 text-base text-muted-foreground"
                  >
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
                        <p className="truncate font-medium text-foreground">
                          {client.name}
                        </p>
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
                      <StatusTag
                        tone={
                          client.operatorStatus === "live" &&
                          !client.inviteStatus
                            ? "success"
                            : "warning"
                        }
                      >
                        {operatorClientStatusLabel(client)}
                      </StatusTag>
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {formatDisplayDate(client.createdAt)}
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
