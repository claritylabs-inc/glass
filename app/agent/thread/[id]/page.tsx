"use client";

import { use, useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { usePresence } from "@/hooks/use-presence";
import { UnifiedThreadContent } from "@/components/agent-thread/thread-content";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export {
  ThreadContextLink,
  UnifiedMessageBubble,
} from "@/components/agent-thread/thread-content";
export type {
  ThreadMessage,
} from "@/components/agent-thread/types";

/* ═══════════════════════════════════════════════════
   Main Thread Page
   ═══════════════════════════════════════════════════ */

export default function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const threadId = id as Id<"threads">;
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const viewerOrg = useCachedQuery("orgs.viewerOrg", api.orgs.viewerOrg, {});
  const presenceUsers = usePresence(`thread:${id}`);
  const agentHandle =
    viewerOrg?.brokerOrg?.agentHandle ?? viewerOrg?.org?.agentHandle;
  const agentBranding =
    viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false && viewerOrg?.brokerOrg
      ? {
          name: `${viewerOrg.brokerOrg.name} Agent`,
          iconUrl: viewerOrg.brokerOrg.iconUrl,
        }
      : undefined;
  // Thread metadata lifted from child components for AppShell header
  const [threadMeta, setThreadMeta] = useState<{
    detail: React.ReactNode;
    actions: React.ReactNode;
  }>({
    detail: "Conversation",
    actions: null,
  });
  const [rightPanel, setRightPanel] = useState<React.ReactNode | null>(null);

  const unifiedThread = useCachedQuery("threads.get.current", api.threads.get, {
    id: threadId,
  });

  const handleUnifiedMeta = useCallback(
    (meta: { detail: React.ReactNode; actions: React.ReactNode }) => {
      setThreadMeta(meta);
    },
    [],
  );

  // Found in unified threads table
  if (unifiedThread !== null) {
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
              threadId={unifiedThread?._id ?? threadId}
              onMeta={handleUnifiedMeta}
              onRightPanel={setRightPanel}
              viewerId={viewer?._id}
              viewerEmail={viewer?.email ?? undefined}
              agentHandle={agentHandle ?? undefined}
              agentBranding={agentBranding}
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
          <p className="text-base text-muted-foreground/40">
            Thread not found
          </p>
        </div>
      </div>
    </AppShell>
  );
}
