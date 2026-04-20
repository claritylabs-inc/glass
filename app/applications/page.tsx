"use client";

import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { ApplicationsList } from "@/components/applications-list";
import { useMembershipStatus } from "@/hooks/use-membership-status";
import { PendingApprovalState } from "@/components/pending-approval-state";

export default function ApplicationsPage() {
  const membershipStatus = useMembershipStatus();

  if (membershipStatus === "pending") {
    return (
      <AppShell>
        <PendingApprovalState />
      </AppShell>
    );
  }

  return (
    <AppShell>
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <ApplicationsList />
          </FadeIn>
    </AppShell>
  );
}
