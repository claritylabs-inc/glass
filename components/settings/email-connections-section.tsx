"use client";

import { useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";
import { ChevronRight, Loader2, Mail, Plus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AddMailboxDrawer,
  MailboxSettingsDrawer,
} from "@/components/settings/email-connection-drawers";
import {
  EMAIL_SCOPE_LABELS,
  automationSummary,
  formatMailboxActivity,
  iconForMailboxHost,
  type ConnectedEmailAccountRow,
  type EmailScope,
  type MailboxAutomation,
} from "@/components/settings/email-connection-ui";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useCurrentOrg } from "@/hooks/use-current-org";
import {
  useCachedQuery,
  useUpdateCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

export function EmailConnectionsSection() {
  const currentOrg = useCurrentOrg();
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const orgId = currentOrg?.orgId;
  const canManageOrgMailboxes = currentOrg?.role === "admin";
  const connectedEmailAccounts = useCachedQuery(
    "connectedEmail.list",
    api.connectedEmail.list,
    orgId ? { orgId } : "skip",
  );
  const upsertConnectedEmailAccounts = useUpsertCachedQuery<
    ConnectedEmailAccountRow[],
    { orgId: Id<"organizations"> }
  >("connectedEmail.list");
  const updateConnectedEmailAccounts = useUpdateCachedQuery<
    ConnectedEmailAccountRow[],
    { orgId: Id<"organizations"> }
  >("connectedEmail.list");
  const { setActions, setRightPanel } = useSettingsActions();
  const [addMailboxOpen, setAddMailboxOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] =
    useState<Id<"connectedEmailAccounts"> | null>(null);

  const selectedAccount = connectedEmailAccounts?.find(
    (account) => account._id === selectedAccountId,
  );

  const addConnectedAccount = useCallback(
    async (account: ConnectedEmailAccountRow) => {
      if (!orgId) return;
      await upsertConnectedEmailAccounts(
        { orgId },
        (current) => [
          account,
          ...(current ?? []).filter((row) => row._id !== account._id),
        ],
      );
    },
    [orgId, upsertConnectedEmailAccounts],
  );

  const saveConnectedAccount = useCallback(
    async (
      accountId: Id<"connectedEmailAccounts">,
      scope: EmailScope,
      automation: MailboxAutomation,
    ) => {
      if (!orgId) return;
      await updateConnectedEmailAccounts(
        { orgId },
        (current) =>
          current.map((row) =>
            row._id === accountId
              ? {
                  ...row,
                  scope,
                  automation,
                  automationConfigured: true,
                  updatedAt: dayjs().valueOf(),
                }
              : row,
          ),
      );
    },
    [orgId, updateConnectedEmailAccounts],
  );

  const removeConnectedAccount = useCallback(
    async (accountId: Id<"connectedEmailAccounts">) => {
      if (!orgId) return;
      await updateConnectedEmailAccounts(
        { orgId },
        (current) => current.filter((row) => row._id !== accountId),
      );
    },
    [orgId, updateConnectedEmailAccounts],
  );

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

  useEffect(() => {
    if (selectedAccount) {
      const canManageMailbox =
        canManageOrgMailboxes || selectedAccount.userId === viewer?._id;
      setRightPanel(
        <MailboxSettingsDrawer
          key={selectedAccount._id}
          account={selectedAccount}
          canManageMailbox={canManageMailbox}
          canManageOrgMailboxes={canManageOrgMailboxes}
          onOpenChange={(open) => {
            if (!open) setSelectedAccountId(null);
          }}
          onSaved={saveConnectedAccount}
          onDisconnected={removeConnectedAccount}
        />,
      );
    } else {
      setRightPanel(
        <AddMailboxDrawer
          open={addMailboxOpen}
          orgId={orgId}
          ownerUserId={viewer?._id}
          canManageOrgMailboxes={canManageOrgMailboxes}
          onOpenChange={setAddMailboxOpen}
          onConnected={addConnectedAccount}
        />,
      );
    }
    return () => setRightPanel(null);
  }, [
    addConnectedAccount,
    addMailboxOpen,
    canManageOrgMailboxes,
    orgId,
    removeConnectedAccount,
    saveConnectedAccount,
    selectedAccount,
    setRightPanel,
    viewer?._id,
  ]);

  return (
    <OperationalPanel>
      <OperationalPanelHeader
        title="Connected mailboxes"
        description="Glass can import policies, track insurance requirements, and learn company context from connected mailboxes."
        className="px-5 py-3.5"
      />
      {connectedEmailAccounts === undefined ? (
        <div className="px-5 py-8 text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </div>
      ) : connectedEmailAccounts.length > 0 ? (
        <div className="divide-y divide-foreground/6">
          {connectedEmailAccounts.map((account) => {
            const ProviderIcon = iconForMailboxHost(account.host);
            const error = account.lastScanError ?? account.lastError;
            const healthy = account.status === "active" && !error;
            return (
              <button
                key={account._id}
                type="button"
                onClick={() => setSelectedAccountId(account._id)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-foreground/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/10"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground">
                  <ProviderIcon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-foreground">
                    {account.emailAddress}
                  </span>
                  <span className="block truncate text-base text-muted-foreground">
                    {EMAIL_SCOPE_LABELS[account.scope]} · {automationSummary(account)}
                  </span>
                </span>
                <span className="hidden shrink-0 text-right sm:block">
                  <span
                    className={`block text-base font-medium ${
                      healthy ? "text-foreground" : "text-destructive"
                    }`}
                  >
                    {healthy ? "Connected" : "Needs attention"}
                  </span>
                  <span className="block text-base text-muted-foreground">
                    Checked{" "}
                    {formatMailboxActivity(
                      account.lastScanAt ?? account.lastTestedAt,
                    )}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center px-5 py-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
            <Mail className="size-5" />
          </span>
          <h3 className="mt-3 text-base font-medium text-foreground">
            Connect your first mailbox
          </h3>
          <p className="mt-1 max-w-sm text-base text-muted-foreground">
            Glass can monitor a personal or shared mailbox without manual forwarding.
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
  );
}
