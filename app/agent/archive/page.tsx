"use client";

import { useMutation } from "convex/react";
import { toast } from "sonner";
import { ArchiveRestore } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { ThreadListRow } from "@/components/agent-thread/thread-list-row";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import {
  useArchivedThreadCacheActions,
  useCachedArchivedThreads,
} from "@/lib/sync/spot-cached-queries";

export default function ArchivePage() {
  const threads = useCachedArchivedThreads();
  const unarchive = useMutation(api.threads.unarchive);
  const { unarchiveThreadLocally } = useArchivedThreadCacheActions();

  async function handleUnarchive(id: Id<"threads">) {
    try {
      await unarchiveThreadLocally(id);
      await unarchive({ id });
      toast.success("Unarchived");
    } catch {
      toast.error("Failed to unarchive");
    }
  }

  return (
    <AppShell breadcrumbDetail="Archive">
      <FadeIn when={true} duration={0.12}>
        {(threads ?? []).length === 0 ? (
          <EmptyStateCard
            icon={<ArchiveRestore className="h-5 w-5" />}
            title="No archived threads"
            description="Threads you archive from the sidebar are kept here."
          />
        ) : (
          <div className="space-y-1">
            {(threads ?? []).map((thread) => (
              <ThreadListRow
                key={thread._id}
                thread={thread}
                action={
                  <PillButton
                    size="compact"
                    variant="icon"
                    onClick={() => handleUnarchive(thread._id)}
                    label="Unarchive"
                    className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </PillButton>
                }
              />
            ))}
          </div>
        )}
      </FadeIn>
    </AppShell>
  );
}
