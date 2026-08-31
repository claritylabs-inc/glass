"use client";

import { useRouter } from "next/navigation";
import {
  LockKeyhole,
  Mail,
  MessageCircle,
  MessageSquare,
  Plus,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { ActionSurfaceButton } from "@/components/ui/action-surface";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { openCommandPalette } from "@/components/command-palette";
import { formatDisplayDateTime } from "@/lib/date-format";
import { getThreadDisplayLabel, type ThreadDisplayLike } from "@/lib/thread-display";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";

type ThreadRow = ThreadDisplayLike & {
  originChannel?: "chat" | "email" | "imessage" | "slack";
};

export default function AgentThreadsPage() {
  const router = useRouter();
  const threads = useCachedQuery(
    "threads.list.active",
    api.threads.list,
    { archived: false },
  ) as ThreadRow[] | undefined;

  return (
    <AppShell
      breadcrumbDetail="Threads"
      actions={
        <PillButton type="button" onClick={openCommandPalette}>
          <Plus className="h-4 w-4" />
          New thread
        </PillButton>
      }
    >
      <FadeIn when={true} duration={0.12}>
        {threads === undefined ? (
          <div className="min-h-32" aria-hidden="true" />
        ) : threads.length === 0 ? (
          <EmptyStateCard
            icon={<MessageSquare className="h-5 w-5" />}
            title="No threads yet"
            description="Start a conversation with Spot about your policies, requirements, or connected email."
            actionLabel="Start a thread"
            onAction={openCommandPalette}
          />
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => {
              const isPrivateSlack =
                thread.originChannel === "slack" &&
                thread.visibility === "user_private";
              return (
                <ActionSurfaceButton
                  key={thread._id}
                  type="button"
                  onClick={() => router.push(`/agent/thread/${thread._id}`)}
                  className="group flex w-full items-center gap-3 px-4 py-3"
                >
                  <div className="shrink-0 text-muted-foreground/30">
                    {thread.originChannel === "imessage" ? (
                      <MessageCircle className="h-4 w-4" />
                    ) : thread.originChannel === "slack" ? (
                      <SiSlack className="h-4 w-4" />
                    ) : thread.originChannel === "email" ? (
                      <Mail className="h-4 w-4" />
                    ) : (
                      <MessageSquare className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
                        {getThreadDisplayLabel(thread)}
                      </p>
                      {isPrivateSlack ? (
                        <LockKeyhole
                          className="h-3 w-3 shrink-0 text-muted-foreground/35"
                          aria-label="Private Slack thread"
                        />
                      ) : null}
                    </div>
                    <p className={`text-muted-foreground/40 ${typeStyle("caption.default")}`}>
                      {formatDisplayDateTime(
                        thread.lastMessageAt ?? thread._creationTime,
                      )}
                      {thread.originChannel === "imessage"
                        ? " · iMessage"
                        : thread.originChannel === "slack"
                          ? isPrivateSlack
                            ? " · Private Slack"
                            : " · Slack"
                          : thread.originChannel === "email"
                            ? " · Email"
                            : " · Chat"}
                    </p>
                  </div>
                </ActionSurfaceButton>
              );
            })}
          </div>
        )}
      </FadeIn>
    </AppShell>
  );
}
