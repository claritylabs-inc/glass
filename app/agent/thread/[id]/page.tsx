"use client";

import { use, useCallback, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { usePresence } from "@/hooks/use-presence";
import { UnifiedThreadContent } from "@/components/agent-thread/thread-content";
import type { PolicyChangeAccess } from "@/components/agent-thread/types";

export { ThreadContextLink, UnifiedMessageBubble } from "@/components/agent-thread/thread-content";
export { PolicyChangeThreadSidebar } from "@/components/agent-thread/artifacts";
export type { PolicyChangeAccess, ThreadMessage } from "@/components/agent-thread/types";

/* ═══════════════════════════════════════════════════
   Main Thread Page
   ═══════════════════════════════════════════════════ */

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const presenceUsers = usePresence(`thread:${id}`);
  const agentHandle = viewerOrg?.brokerOrg?.agentHandle ?? viewerOrg?.org?.agentHandle;
  const agentBranding = viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false && viewerOrg?.brokerOrg
    ? { name: `${viewerOrg.brokerOrg.name} Agent`, iconUrl: viewerOrg.brokerOrg.iconUrl }
    : undefined;
  const policyChangeAccess = useMemo<PolicyChangeAccess>(() => {
    const isBroker = viewerOrg?.org?.type === "broker";
    const brokerConnected = isBroker || !!viewerOrg?.org?.brokerOrgId || !!viewerOrg?.brokerOrg?._id;
    return {
      canManage: isBroker,
      actorLabel: isBroker ? "broker" : "client",
      brokerConnected,
    };
  }, [viewerOrg?.brokerOrg?._id, viewerOrg?.org?.brokerOrgId, viewerOrg?.org?.type]);

  // Thread metadata lifted from child components for AppShell header
  const [threadMeta, setThreadMeta] = useState<{ detail: React.ReactNode; actions: React.ReactNode }>({
    detail: "Conversation",
    actions: null,
  });
  const [rightPanel, setRightPanel] = useState<React.ReactNode | null>(null);

  // Try unified threads table first
  const unifiedThread = useQuery(api.threads.tryGet, { id });

  const handleUnifiedMeta = useCallback((meta: { detail: React.ReactNode; actions: React.ReactNode }) => {
    setThreadMeta(meta);
  }, []);

  // Loading: unified query still pending
  if (unifiedThread === undefined) {
    return (
      <AppShell breadcrumbDetail="Conversation">
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
          </div>
        </div>
      </AppShell>
    );
  }

  // Found in unified threads table
  if (unifiedThread) {
    return (
      <AppShell
        breadcrumbDetail={threadMeta.detail}
        actions={threadMeta.actions}
        presenceUsers={presenceUsers}
        rightPanel={rightPanel}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full flex flex-col">
            <UnifiedThreadContent
              threadId={unifiedThread._id}
              onMeta={handleUnifiedMeta}
              onRightPanel={setRightPanel}
              viewerId={viewer?._id}
              viewerEmail={viewer?.email ?? undefined}
              agentHandle={agentHandle ?? undefined}
              agentBranding={agentBranding}
              policyChangeAccess={policyChangeAccess}
            />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbDetail="Conversation" presenceUsers={presenceUsers}>
      <div className="absolute inset-0 overflow-hidden">
        <div className="h-full flex items-center justify-center">
          <p className="text-body-sm text-muted-foreground/40">Thread not found</p>
        </div>
      </div>
    </AppShell>
  );
}
