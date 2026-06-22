"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { useAction, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
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
import { toast } from "sonner";
import { OperatorSidebar } from "../operator-sidebar";
import {
  useCachedOperatorCurrent,
  useCachedOperatorMGAs,
  useOperatorMGACacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";

type MGARow = {
  _id: Id<"organizations">;
  name: string;
  website?: string;
  iconUrl?: string | null;
  programName?: string;
  operatorStatus: "onboarding" | "live";
  adminName?: string;
  adminEmail?: string;
  createdAt: number;
};

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

function OrgMark({ name, iconUrl, website }: { name: string; iconUrl?: string | null; website?: string | null }) {
  return <OrgBrandIcon name={name} iconUrl={iconUrl} website={website} size="md" />;
}

export default function OperatorMGAsPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<Id<"organizations"> | null>(null);
  const [panelMode, setPanelMode] = useState<"create" | "details" | null>(null);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [programName, setProgramName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [busy, setBusy] = useState(false);

  const current = useCachedOperatorCurrent();
  const mgas = useCachedOperatorMGAs() as MGARow[] | undefined;
  const { seedMGA, patchMGAStatus } = useOperatorMGACacheActions();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMGA = useAction((api as any).operator.createMGA);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const launchMGA = useAction((api as any).operator.launchMGA);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setMGAStatus = useMutation((api as any).operator.setMGAStatus);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startImpersonation = useMutation((api as any).operator.startImpersonation);
  const stopOperatorImpersonation = useStopOperatorImpersonation();

  const selected = useMemo(
    () => mgas?.find((mga) => mga._id === selectedId) ?? null,
    [mgas, selectedId],
  );

  async function submitMGA(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await createMGA({
        name,
        website: website || undefined,
        programName: programName || undefined,
        adminEmail,
        adminName: adminName || undefined,
      });
      toast.success("MGA created for setup");
      if (result?.mgaOrgId) {
        await seedMGA({
          mgaOrgId: result.mgaOrgId,
          name,
          website: website || undefined,
          programName: programName || undefined,
          adminEmail,
          adminName: adminName || undefined,
        });
        setSelectedId(result.mgaOrgId);
      }
      setName("");
      setWebsite("");
      setProgramName("");
      setAdminEmail("");
      setAdminName("");
      setPanelMode(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create MGA");
    } finally {
      setBusy(false);
    }
  }

  async function impersonate(mga: MGARow) {
    await startImpersonation({ targetOrgId: mga._id, targetRole: "admin" });
    router.push("/partner/approvals");
  }

  async function launch(mga: MGARow) {
    setBusy(true);
    try {
      await launchMGA({ mgaOrgId: mga._id });
      await patchMGAStatus(mga._id, "live");
      toast.success("MGA launched and login email sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to launch MGA");
    } finally {
      setBusy(false);
    }
  }

  async function moveToOnboarding(mga: MGARow) {
    setBusy(true);
    try {
      await setMGAStatus({ mgaOrgId: mga._id, status: "onboarding" });
      await patchMGAStatus(mga._id, "onboarding");
      toast.success("MGA account disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update MGA");
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
        Create MGA
      </PillButton>
    </>
  );

  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={(open) => {
        if (!open) setPanelMode(null);
      }}
      title={panelMode === "create" ? "Create MGA" : selected?.name ?? "MGA details"}
      footer={
        panelMode === "create" ? (
          <PillButton
            type="submit"
            form="operator-create-mga-form"
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
                Disable account
              </PillButton>
            )}
          </>
        ) : null
      }
    >
      {panelMode === "create" ? (
        <form id="operator-create-mga-form" onSubmit={submitMGA} className="space-y-3">
          <input
            className={INPUT_CLASSES}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="MGA name"
            required
          />
          <input
            className={INPUT_CLASSES}
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="Website"
          />
          <input
            className={INPUT_CLASSES}
            value={programName}
            onChange={(event) => setProgramName(event.target.value)}
            placeholder="Program name"
          />
          <input
            className={INPUT_CLASSES}
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            placeholder="MGA admin email"
            type="email"
            required
          />
          <input
            className={INPUT_CLASSES}
            value={adminName}
            onChange={(event) => setAdminName(event.target.value)}
            placeholder="MGA admin name"
          />
        </form>
      ) : selected ? (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-foreground">{selected.name}</p>
              <p className="mt-1 truncate text-label text-muted-foreground">
                {selected.adminName ?? selected.adminEmail ?? "No admin contact"}
              </p>
            </div>
            <Badge variant={selected.operatorStatus === "live" ? "default" : "secondary"}>
              {selected.operatorStatus === "live" ? "Live" : "Onboarding"}
            </Badge>
          </div>
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Program"
              value={<span className="block truncate">{selected.programName ?? "Not set"}</span>}
              align="right"
            />
            <OperationalLabelValueRow
              label="Website"
              value={<span className="block truncate">{selected.website ?? "Not set"}</span>}
              align="right"
            />
            <OperationalLabelValueRow
              label="Created"
              value={dayjs(selected.createdAt).format("MMM D, YYYY")}
              align="right"
            />
          </OperationalLabelValueList>
        </div>
      ) : null}
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={actions}
      breadcrumbDetail="MGAs"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="mgas"
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
                <TableHead className="w-[27%] px-4 text-label text-muted-foreground">MGA</TableHead>
                <TableHead className="w-[24%] text-label text-muted-foreground">Admin</TableHead>
                <TableHead className="w-[22%] text-label text-muted-foreground">Program</TableHead>
                <TableHead className="w-[18%] text-label text-muted-foreground">Website</TableHead>
                <TableHead className="w-[10%] text-label text-muted-foreground">Status</TableHead>
                <TableHead className="w-[8%] px-4 text-label text-muted-foreground">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mgas === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : mgas.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="h-32 px-4 text-base text-muted-foreground">
                    No MGA accounts found.
                  </TableCell>
                </TableRow>
              ) : (
                mgas.map((mga) => (
                  <TableRow
                    key={mga._id}
                    tabIndex={0}
                    onClick={() => {
                      setSelectedId(mga._id);
                      setPanelMode("details");
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedId(mga._id);
                      setPanelMode("details");
                    }}
                    className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selectedId === mga._id ? "bg-muted/50" : ""
                    }`}
                  >
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <OrgMark name={mga.name} iconUrl={mga.iconUrl} website={mga.website} />
                        <p className="truncate font-medium text-foreground">{mga.name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {mga.adminEmail ?? "No admin"}
                    </TableCell>
                    <TableCell className="max-w-52 truncate text-muted-foreground">
                      {mga.programName ?? "Not set"}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">
                      {mga.website ?? "Not set"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={mga.operatorStatus === "live" ? "default" : "secondary"}>
                        {mga.operatorStatus === "live" ? "Live" : "Onboarding"}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {dayjs(mga.createdAt).format("MMM D")}
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
