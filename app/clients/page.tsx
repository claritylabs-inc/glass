"use client";

import { useState } from "react";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { AppShell } from "@/components/app-shell";
import { ClientList } from "@/components/client-list";
import { InviteClientDrawer } from "@/components/invite-client-drawer";
import { PillButton } from "@/components/ui/pill-button";
import { UserPlus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

export default function ClientsPage() {
  const currentOrg = useCurrentOrg();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resumeClientOrgId, setResumeClientOrgId] = useState<Id<"organizations"> | null>(null);

  if (!currentOrg) {
    return (
      <AppShell>
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground/60">Loading…</p>
        </div>
      </AppShell>
    );
  }

  if (!currentOrg.isBroker) {
    return (
      <AppShell>
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground/60">
            This page is for broker organizations only.
          </p>
        </div>
      </AppShell>
    );
  }

  const openNew = () => {
    setResumeClientOrgId(null);
    setInviteOpen(true);
  };

  const openResume = (clientOrgId: Id<"organizations">) => {
    setResumeClientOrgId(clientOrgId);
    setInviteOpen(true);
  };

  const headerActions = (
    <PillButton size="compact" onClick={openNew}>
      <UserPlus className="h-3.5 w-3.5" />
      Invite client
    </PillButton>
  );

  const brokerOrgId = currentOrg.orgId as Id<"organizations">;

  return (
    <AppShell
      actions={headerActions}
      rightPanel={
        <InviteClientDrawer
          brokerOrgId={brokerOrgId}
          open={inviteOpen}
          onOpenChange={(v) => {
            setInviteOpen(v);
            if (!v) setResumeClientOrgId(null);
          }}
          resumeClientOrgId={resumeClientOrgId}
        />
      }
    >
      <ClientList
        brokerOrgId={brokerOrgId}
        onInvite={openNew}
        onResumeDraft={openResume}
      />
    </AppShell>
  );
}
