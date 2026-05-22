"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
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
  clientCount: number;
  createdAt: number;
};

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

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
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = useQuery((api as any).operator.current, {});
  const brokers = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.listBrokers,
    {},
  ) as BrokerRow[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createBroker = useAction((api as any).operator.createBroker);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const launchBroker = useAction((api as any).operator.launchBroker);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setBrokerStatus = useMutation((api as any).operator.setBrokerStatus);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startImpersonation = useMutation((api as any).operator.startImpersonation);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopImpersonation = useMutation((api as any).operator.stopImpersonation);

  const selected = useMemo(
    () => brokers?.find((broker) => broker._id === selectedId) ?? null,
    [brokers, selectedId],
  );

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
      });
      toast.success("Broker created for setup");
      setName("");
      setSlug("");
      setWebsite("");
      setAgentHandle("");
      setAdminEmail("");
      setAdminName("");
      if (result?.brokerOrgId) setSelectedId(result.brokerOrgId);
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
      toast.success("Broker moved back to onboarding");
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

  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={(open) => {
        if (!open) setPanelMode(null);
      }}
      title={panelMode === "create" ? "Create broker setup" : selected?.name ?? "Broker details"}
      footer={
        panelMode === "create" ? (
          <PillButton
            type="submit"
            form="operator-create-broker-form"
            disabled={busy || !name || !adminEmail}
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
                Move back to onboarding
              </PillButton>
            )}
          </>
        ) : null
      }
    >
      {panelMode === "create" ? (
        <form id="operator-create-broker-form" onSubmit={submitBroker} className="space-y-3">
          <input
            className={INPUT_CLASSES}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Broker name"
            required
          />
          <input
            className={INPUT_CLASSES}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="Slug"
          />
          <input
            className={INPUT_CLASSES}
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="Website"
          />
          <input
            className={INPUT_CLASSES}
            value={agentHandle}
            onChange={(event) => setAgentHandle(event.target.value)}
            placeholder="Agent handle"
          />
          <input
            className={INPUT_CLASSES}
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            placeholder="Broker admin email"
            type="email"
            required
          />
          <input
            className={INPUT_CLASSES}
            value={adminName}
            onChange={(event) => setAdminName(event.target.value)}
            placeholder="Broker admin name"
          />
        </form>
      ) : selected ? (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-body-sm font-medium text-foreground">{selected.name}</p>
              <p className="mt-1 truncate text-label-sm text-muted-foreground">
                {selected.adminName ?? selected.adminEmail ?? "No admin contact"}
              </p>
            </div>
            <Badge variant={selected.operatorStatus === "live" ? "default" : "secondary"}>
              {selected.operatorStatus === "live" ? "Live" : "Onboarding"}
            </Badge>
          </div>
          <dl className="border-t border-foreground/6">
            <DetailRow
              label="Slug"
              value={<span className="block truncate">{selected.slug ? `/${selected.slug}` : "Not set"}</span>}
            />
            <DetailRow
              label="Website"
              value={<span className="block truncate">{selected.website ?? "Not set"}</span>}
            />
            <DetailRow
              label="Agent handle"
              value={<span className="block truncate">{selected.agentHandle ?? "Not set"}</span>}
            />
            <DetailRow label="Clients" value={selected.clientCount} />
            <DetailRow label="Created" value={dayjs(selected.createdAt).format("MMM D, YYYY")} />
          </dl>
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
                    onClick={() => {
                      setSelectedId(broker._id);
                      setPanelMode("details");
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedId(broker._id);
                      setPanelMode("details");
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
