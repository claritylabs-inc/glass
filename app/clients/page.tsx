"use client";

import { useState } from "react";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { AppShell } from "@/components/app-shell";
import { ClientList } from "@/components/client-list";
import { PillButton } from "@/components/ui/pill-button";
import { UserPlus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

export default function ClientsPage() {
  const currentOrg = useCurrentOrg();
  const [inviteOpen, setInviteOpen] = useState(false);

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

  const headerActions = (
    <PillButton size="compact" onClick={() => setInviteOpen(true)}>
      <UserPlus className="h-3.5 w-3.5" />
      Invite client
    </PillButton>
  );

  return (
    <AppShell actions={headerActions}>
      <ClientList
        brokerOrgId={currentOrg.orgId as Id<"organizations">}
        inviteOpen={inviteOpen}
        onInviteOpenChange={setInviteOpen}
      />
    </AppShell>
  );
}
