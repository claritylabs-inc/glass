"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
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
import { Loader2, LogOut, Plus, Trash2 } from "lucide-react";
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
import { useStartOperatorImpersonation } from "@/hooks/use-start-operator-impersonation";
import { formatDisplayDate } from "@/lib/date-format";
import {
  operatorClientStatusLabel,
  type OperatorClientRow,
} from "./client-model";
import { typeStyle } from "@/lib/typography";

const STANDALONE_VALUE = "__standalone__";
const AGENT_DOMAIN = getPublicAgentDomain();
const MAX_CLIENT_USERS = 25;

type ClientUserDraft = {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: "admin" | "member";
};

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
      <span className={`text-muted-foreground ${typeStyle("caption.medium")}`}>
        {label}
      </span>
      {children}
      {error ? (
        <span className={`block text-destructive ${typeStyle("caption.default")}`}>{error}</span>
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
  const [clientUsers, setClientUsers] = useState<ClientUserDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [debouncedPhoneChecks, setDebouncedPhoneChecks] = useState<
    Array<{ email: string; phone: string }>
  >([]);
  const nextClientUserId = useRef(1);

  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const brokers = useCachedOperatorBrokers();
  const { seedClient } = useOperatorClientCacheActions();
  const phoneChecks = useMemo(
    () =>
      clientUsers
        .map((user) => ({
          email: user.email.trim().toLowerCase(),
          phone: user.phone.trim(),
        }))
        .filter(({ phone }) => phone && isValidOptionalPhone(phone)),
    [clientUsers],
  );
  const createPhoneAvailability = useQuery(
    api.operator.checkUserPhoneAvailabilities,
    debouncedPhoneChecks.length > 0
      ? { users: debouncedPhoneChecks }
      : "skip",
  );
  const createClient = useAction(api.operator.createSoloClient);
  const { startImpersonation } = useStartOperatorImpersonation();
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
      () => setDebouncedPhoneChecks(phoneChecks),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [phoneChecks]);

  const emailCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of clientUsers) {
      const email = user.email.trim().toLowerCase();
      if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
    }
    return counts;
  }, [clientUsers]);
  const phoneCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of clientUsers) {
      const phone = user.phone.trim();
      if (phone) counts.set(phone, (counts.get(phone) ?? 0) + 1);
    }
    return counts;
  }, [clientUsers]);
  const availabilityByPhone = useMemo(
    () =>
      new Map(
        (createPhoneAvailability ?? []).map((result) => [result.phone, result]),
      ),
    [createPhoneAvailability],
  );

  function userEmailError(user: ClientUserDraft) {
    const email = user.email.trim().toLowerCase();
    return email && (emailCounts.get(email) ?? 0) > 1
      ? "Use a different email for each user"
      : null;
  }

  function userPhoneError(user: ClientUserDraft) {
    const phone = user.phone.trim();
    if (!isValidOptionalPhone(phone)) return "Enter a valid phone number";
    if (!phone) return null;
    if ((phoneCounts.get(phone) ?? 0) > 1) {
      return "Use a different phone number for each user";
    }
    const checkedPhone = availabilityByPhone.get(phone);
    if (
      !debouncedPhoneChecks.some(
        (check) =>
          check.phone === phone &&
          check.email === user.email.trim().toLowerCase(),
      ) ||
      createPhoneAvailability === undefined ||
      !checkedPhone
    ) {
      return "Checking phone number";
    }
    return checkedPhone.available === false
      ? "This phone number is already used by another user"
      : null;
  }

  const hasCreateUserError =
    (clientUsers.length > 0 &&
      !clientUsers.some((user) => user.role === "admin")) ||
    clientUsers.some(
      (user) =>
        !user.email.trim() ||
        userEmailError(user) !== null ||
        userPhoneError(user) !== null,
    );

  function addClientUser() {
    if (clientUsers.length >= MAX_CLIENT_USERS) return;
    const id = `user-${nextClientUserId.current}`;
    nextClientUserId.current += 1;
    setClientUsers((current) => [
      ...current,
      {
        id,
        email: "",
        name: "",
        phone: "",
        role: current.length === 0 ? "admin" : "member",
      },
    ]);
  }

  function updateClientUser(
    id: string,
    patch: Partial<Pick<ClientUserDraft, "email" | "name" | "phone" | "role">>,
  ) {
    setClientUsers((current) =>
      current.map((user) => (user.id === id ? { ...user, ...patch } : user)),
    );
  }

  function removeClientUser(id: string) {
    setClientUsers((current) => current.filter((user) => user.id !== id));
  }

  async function submitClient(event: React.FormEvent) {
    event.preventDefault();
    if (hasCreateUserError) return;
    setBusy(true);
    try {
      const primaryAdmin = clientUsers.find((user) => user.role === "admin");
      const result = await createClient({
        name,
        brokerOrgId:
          brokerOrgId === STANDALONE_VALUE
            ? undefined
            : (brokerOrgId as Id<"organizations">),
        website: website || undefined,
        users: clientUsers.map((user) => ({
          email: user.email,
          name: user.name || undefined,
          phone: user.phone || undefined,
          role: user.role,
        })),
      });
      const userCount = clientUsers.length;
      toast.success(
        userCount === 0
          ? "Client created without users"
          : `Client created with ${userCount} ${userCount === 1 ? "user" : "users"}`,
      );
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
          adminEmail: primaryAdmin?.email,
          adminName: primaryAdmin?.name || undefined,
          adminPhone: primaryAdmin?.phone || undefined,
        });
        router.push(`/operator/clients/${result.clientOrgId}`);
      }
      setName("");
      setBrokerOrgId(STANDALONE_VALUE);
      setWebsite("");
      setClientUsers([]);
      setDebouncedPhoneChecks([]);
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
        destination: "/policies",
        failureMessage: "Failed to impersonate client",
      });
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
          variant="icon"
          size="compact"
          label="Stop impersonating"
          expandLabel
          onClick={async () => {
            await stopOperatorImpersonation();
            toast.success("Impersonation stopped");
          }}
        >
          <LogOut className="size-3.5" />
        </PillButton>
      ) : null}
      <PillButton size="compact" onClick={openCreate}>
        <Plus className="size-3.5" />
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
              !name.trim() ||
              hasCreateUserError
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create client
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
          className="space-y-5"
        >
          <div className="space-y-3">
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
          </div>

          <section className="space-y-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <h2 className={typeStyle("heading.micro")}>Users</h2>
                <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                  Optional. Added users are attached without activation emails.
                </p>
              </div>
              <PillButton
                variant="secondary"
                size="compact"
                disabled={clientUsers.length >= MAX_CLIENT_USERS}
                onClick={addClientUser}
              >
                <Plus className="size-3.5" />
                Add user
              </PillButton>
            </div>

            {clientUsers.length === 0 ? (
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                No users added.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {clientUsers.map((user, index) => (
                  <div
                    key={user.id}
                    className="space-y-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-foreground ${typeStyle("body.medium")}`}>
                        User {index + 1}
                      </p>
                      <PillButton
                        variant="destructive"
                        size="compact"
                        iconOnly
                        label={`Remove user ${index + 1}`}
                        onClick={() => removeClientUser(user.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </PillButton>
                    </div>
                    <Field label="Email" error={userEmailError(user)}>
                      <Input
                        value={user.email}
                        onChange={(event) =>
                          updateClientUser(user.id, { email: event.target.value })
                        }
                        placeholder="terry@example.com"
                        type="email"
                        required
                      />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Name">
                        <Input
                          value={user.name}
                          onChange={(event) =>
                            updateClientUser(user.id, { name: event.target.value })
                          }
                          placeholder="Alex Morgan"
                        />
                      </Field>
                      <Field label="Access">
                        <Select
                          value={user.role}
                          onValueChange={(value) =>
                            updateClientUser(user.id, {
                              role: value === "admin" ? "admin" : "member",
                            })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {user.role === "admin" ? "Admin" : "Member"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">Member</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <Field label="Phone" error={userPhoneError(user)}>
                      <PhoneInput
                        value={user.phone}
                        onChange={(value) =>
                          updateClientUser(user.id, { phone: value ?? "" })
                        }
                        defaultCountry="US"
                        placeholder="(555) 123-4567"
                      />
                    </Field>
                  </div>
                ))}
                {!clientUsers.some((user) => user.role === "admin") ? (
                  <p
                    role="alert"
                    className={`pt-3 text-destructive ${typeStyle("caption.default")}`}
                  >
                    At least one user must be an admin.
                  </p>
                ) : null}
              </div>
            )}
          </section>
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
              <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
                {selected.primaryContactName ??
                  selected.adminName ??
                  "No primary contact"}
              </p>
              <p className={`truncate text-muted-foreground ${typeStyle("body.default")}`}>
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
                channelOverview?.agentEmailAddress ? (
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
      rightPanel={rightPanel}
    >
      <main className="flex w-full flex-col">
        <OperationalPanel>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={`w-[25%] px-4 text-muted-foreground ${typeStyle("label.table")}`}>
                  Client
                </TableHead>
                <TableHead className={`w-[20%] text-muted-foreground ${typeStyle("label.table")}`}>
                  Broker
                </TableHead>
                <TableHead className={`w-[22%] text-muted-foreground ${typeStyle("label.table")}`}>
                  Admin
                </TableHead>
                <TableHead className={`w-[18%] text-muted-foreground ${typeStyle("label.table")}`}>
                  Website
                </TableHead>
                <TableHead className={`w-[10%] text-muted-foreground ${typeStyle("label.table")}`}>
                  Status
                </TableHead>
                <TableHead className={`w-[8%] px-4 text-muted-foreground ${typeStyle("label.table")}`}>
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
                    className={`h-32 px-4 text-muted-foreground ${typeStyle("body.default")}`}
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
                        <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
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
