"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { ClientList } from "@/components/client-list";
import { InviteClientDrawer } from "@/components/invite-client-drawer";
import { PillButton } from "@/components/ui/pill-button";
import { UserPlus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { useClientWorkspaceActions } from "./client-workspace-shell";

export default function ClientsPage() {
  const currentOrg = useCurrentOrg();
  const { setActions, setRightPanel } = useClientWorkspaceActions();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resumeClientOrgId, setResumeClientOrgId] =
    useState<Id<"organizations"> | null>(null);

  const openNew = useCallback(() => {
    setResumeClientOrgId(null);
    setInviteOpen(true);
  }, []);

  const openResume = useCallback((clientOrgId: Id<"organizations">) => {
    setResumeClientOrgId(clientOrgId);
    setInviteOpen(true);
  }, []);

  const partnerOrgId = currentOrg?.isBroker
    ? (currentOrg.orgId as Id<"organizations">)
    : null;
  const headerActions = useMemo(
    () =>
      partnerOrgId ? (
        <PillButton size="compact" onClick={openNew}>
          <UserPlus className="h-3.5 w-3.5" />
          Invite client
        </PillButton>
      ) : null,
    [openNew, partnerOrgId],
  );
  const invitePanel = useMemo(
    () =>
      partnerOrgId ? (
        <InviteClientDrawer
          partnerOrgId={partnerOrgId}
          open={inviteOpen}
          onOpenChange={(open) => {
            setInviteOpen(open);
            if (!open) setResumeClientOrgId(null);
          }}
          resumeClientOrgId={resumeClientOrgId}
        />
      ) : null,
    [inviteOpen, partnerOrgId, resumeClientOrgId],
  );

  useEffect(() => {
    setActions(headerActions);
    return () => setActions(null);
  }, [headerActions, setActions]);

  useEffect(() => {
    setRightPanel(invitePanel);
    return () => setRightPanel(null);
  }, [invitePanel, setRightPanel]);

  if (!currentOrg) {
    return <div className="min-h-32" aria-hidden="true" />;
  }

  if (!currentOrg.isBroker) {
    return (
      <div className="py-16 text-center">
        <p className={`text-muted-foreground/60 ${typeStyle("body.default")}`}>
          This page is for broker organizations only.
        </p>
      </div>
    );
  }

  return (
    <ClientList
      partnerOrgId={currentOrg.orgId as Id<"organizations">}
      onInvite={openNew}
      onResumeDraft={openResume}
    />
  );
}
