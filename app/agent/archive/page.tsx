"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";
import { ArchiveRestore, Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import dayjs from "dayjs";
import { Id } from "@/convex/_generated/dataModel";
import {
  useArchivedThreadCacheActions,
  useCachedArchivedThreads,
} from "@/lib/sync/glass-cached-queries";

export default function ArchivePage() {
  const threads = useCachedArchivedThreads();
  const unarchive = useMutation(api.threads.unarchive);
  const { removeArchivedThreadLocally } = useArchivedThreadCacheActions();

  async function handleUnarchive(id: Id<"threads">) {
    try {
      void removeArchivedThreadLocally(id);
      await unarchive({ id });
      toast.success("Unarchived");
    } catch {
      toast.error("Failed to unarchive");
    }
  }

  return (
    <AppShell breadcrumbDetail="Archive">
      <FadeIn when={true} duration={0.12}>
        {(threads ?? []).length === 0 && (
          <div className="text-center py-16">
            <p className="text-body-sm text-muted-foreground/40">
              No archived threads
            </p>
          </div>
        )}

        {(threads ?? []).length > 0 && (
          <div className="space-y-1">
            {(threads ?? []).map((thread) => (
              <div
                key={thread._id}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-foreground/6 bg-card hover:bg-foreground/[0.02] transition-colors group"
              >
                <div className="shrink-0 text-muted-foreground/30">
                  {thread.originChannel === "imessage" ? (
                    <MessageCircle className="w-4 h-4" />
                  ) : thread.originChannel === "email" ? (
                    <Mail className="w-4 h-4" />
                  ) : null}
                </div>
                <Link
                  href={`/agent/thread/${thread._id}`}
                  className="flex-1 min-w-0"
                >
                  <p className="text-body-sm font-medium text-foreground truncate">
                    {thread.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground/40">
                    {dayjs(thread.lastMessageAt ?? thread._creationTime).format(
                      "MMM D, YYYY · h:mm A",
                    )}
                    {thread.originChannel === "imessage"
                      ? " · iMessage"
                      : thread.originChannel === "email"
                        ? " · Email"
                        : " · Chat"}
                  </p>
                </Link>
                <PillButton
                  size="compact"
                  variant="icon"
                  onClick={() => handleUnarchive(thread._id)}
                  label="Unarchive"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ArchiveRestore className="w-4 h-4" />
                </PillButton>
              </div>
            ))}
          </div>
        )}
      </FadeIn>
    </AppShell>
  );
}
