"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { Badge } from "@/components/ui/badge";
import { PhoneInput } from "@/components/ui/phone-input";
import { PillButton } from "@/components/ui/pill-button";
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
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";
const AFFIXED_INPUT_CLASSES =
  "min-w-0 flex-1 bg-transparent px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none";
const STANDALONE_VALUE = "__standalone__";
const AGENT_DOMAIN = getPublicAgentDomain();

function normalizeIdentifierInput(value: string) {
  const withoutDomain = value.trim().toLowerCase().split("@")[0] ?? "";
  return withoutDomain.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-label-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-foreground/6 py-2.5 last:border-b-0">
      <dt className="shrink-0 text-label-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body-sm text-foreground">{value}</dd>
    </div>
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

function OrgMark({
  name,
  iconUrl,
  website,
  size = "md",
}: {
  name: string;
  iconUrl?: string | null;
  website?: string | null;
  size?: "sm" | "md";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = iconUrl ?? faviconFromWebsite(website);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const sizeClass = size === "sm" ? "h-3.5 w-3.5 rounded-sm text-[8px]" : "h-7 w-7 rounded-md text-label-sm";
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-foreground/8 bg-white font-medium text-foreground ${sizeClass}`}>
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
  const [busy, setBusy] = useState(false);
  const [debouncedAgentHandle, setDebouncedAgentHandle] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = useQuery((api as any).operator.current, {});
  const clients = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.listClients,
    {},
  ) as ClientRow[] | undefined;
  const brokers = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.listBrokers,
    {},
  ) as BrokerOption[] | undefined;
  const handleAvailability = useQuery(
    api.orgs.checkHandleAvailability,
    debouncedAgentHandle ? { handle: debouncedAgentHandle } : "skip",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createClient = useAction((api as any).operator.createSoloClient);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const launchClient = useAction((api as any).operator.launchSoloClient);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setClientStatus = useMutation((api as any).operator.setSoloClientStatus);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startImpersonation = useMutation((api as any).operator.startImpersonation);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopImpersonation = useMutation((api as any).operator.stopImpersonation);

  const selected = useMemo(
    () => clients?.find((client) => client._id === selectedId) ?? null,
    [clients, selectedId],
  );
  const selectedBroker = useMemo(
    () => brokers?.find((broker) => broker._id === brokerOrgId) ?? null,
    [brokerOrgId, brokers],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAgentHandle(agentHandle), 250);
    return () => window.clearTimeout(timer);
  }, [agentHandle]);

  const handleChecking =
    agentHandle.length >= 3 &&
    (agentHandle !== debouncedAgentHandle || handleAvailability === undefined);
  const handleUnavailable = !!agentHandle && handleAvailability?.available === false;

  async function submitClient(event: React.FormEvent) {
    event.preventDefault();
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
      setName("");
      setBrokerOrgId(STANDALONE_VALUE);
      setWebsite("");
      setAgentHandle("");
      setAdminEmail("");
      setAdminName("");
      setAdminPhone("");
      if (result?.clientOrgId) setSelectedId(result.clientOrgId);
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
      toast.success("Client launched and login email sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to launch client");
    } finally {
      setBusy(false);
    }
  }

  function contactName(client: ClientRow) {
    return client.adminName ?? client.primaryContactName;
  }

  function contactEmail(client: ClientRow) {
    return client.adminEmail ?? client.primaryContactEmail;
  }

  function brokerLabel(client: ClientRow) {
    return client.brokerName ?? "Standalone";
  }

  async function moveToOnboarding(client: ClientRow) {
    setBusy(true);
    try {
      await setClientStatus({ clientOrgId: client._id, status: "onboarding" });
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
        Create client
      </PillButton>
    </>
  );

  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={(open) => {
        if (!open) setPanelMode(null);
      }}
      title={panelMode === "create" ? "Create client" : selected?.name ?? "Client details"}
      footer={
        panelMode === "create" ? (
          <PillButton
            type="submit"
            form="operator-create-client-form"
            disabled={busy || !name || !adminEmail || handleUnavailable}
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
                      <OrgMark
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
                      <OrgMark name={broker.name} iconUrl={broker.iconUrl} website={broker.website} size="sm" />
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
          <Field label="Client admin phone">
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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-body-sm font-medium text-foreground">{selected.name}</p>
              <p className="mt-1 truncate text-label-sm text-muted-foreground">
                {contactName(selected) ?? contactEmail(selected) ?? "No admin contact"}
              </p>
            </div>
            <Badge variant={selected.operatorStatus === "live" ? "default" : "secondary"}>
              {selected.operatorStatus === "live" ? "Live" : "Onboarding"}
            </Badge>
          </div>
          <dl className="border-t border-foreground/6">
            <DetailRow
              label="Broker"
              value={<span className="block truncate">{brokerLabel(selected)}</span>}
            />
            <DetailRow
              label="Contact"
              value={<span className="block truncate">{contactEmail(selected) ?? "Not set"}</span>}
            />
            <DetailRow
              label="Admin phone"
              value={<span className="block truncate">{selected.adminPhone ?? "Not set"}</span>}
            />
            <DetailRow
              label="Invite"
              value={<span className="block truncate">{selected.inviteStatus ?? "Accepted"}</span>}
            />
            <DetailRow
              label="Website"
              value={<span className="block truncate">{selected.website ?? "Not set"}</span>}
            />
            <DetailRow
              label="Agent handle"
              value={<span className="block truncate">{selected.agentHandle ?? "Not set"}</span>}
            />
            <DetailRow label="Created" value={dayjs(selected.createdAt).format("MMM D, YYYY")} />
          </dl>
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
        <section className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[25%] px-4 text-label-sm text-muted-foreground">Client</TableHead>
                <TableHead className="w-[20%] text-label-sm text-muted-foreground">Broker</TableHead>
                <TableHead className="w-[22%] text-label-sm text-muted-foreground">Admin</TableHead>
                <TableHead className="w-[18%] text-label-sm text-muted-foreground">Website</TableHead>
                <TableHead className="w-[10%] text-label-sm text-muted-foreground">Status</TableHead>
                <TableHead className="w-[8%] px-4 text-label-sm text-muted-foreground">Created</TableHead>
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
                  <TableCell colSpan={6} className="h-32 px-4 text-body-sm text-muted-foreground">
                    No client accounts found.
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((client) => (
                  <TableRow
                    key={client._id}
                    tabIndex={0}
                    onClick={() => {
                      setSelectedId(client._id);
                      setPanelMode("details");
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedId(client._id);
                      setPanelMode("details");
                    }}
                    className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selectedId === client._id ? "bg-muted/50" : ""
                    }`}
                  >
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <OrgMark name={client.name} iconUrl={client.iconUrl} website={client.website} />
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
        </section>
      </main>
    </AppShell>
  );
}
