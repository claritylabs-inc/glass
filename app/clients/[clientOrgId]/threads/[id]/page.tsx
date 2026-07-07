"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  UnifiedMessageBubble,
  ThreadContextLink,
  type ThreadMessage,
} from "@/app/agent/thread/[id]/page";
import { useClientDetailActions } from "../../layout";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export default function ClientThreadReadOnlyPage() {
  const { clientOrgId, id } = useParams<{ clientOrgId: string; id: string }>();
  const { setBreadcrumbExtra } = useClientDetailActions();

  const viewer = useCachedQuery("clients.thread.viewer", api.users.viewer, {});

  const thread = useCachedQuery(
    "threads.getForClient",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).threads.getForClient,
    clientOrgId && id
      ? {
          clientOrgId: clientOrgId as Id<"organizations">,
          id: id as Id<"threads">,
        }
      : "skip",
  ) as
    | {
        _id: Id<"threads">;
        title: string;
        initialContext?: {
          pageType: string;
          entityId?: string;
          summary?: string;
        };
        originChannel?: "chat" | "email" | "imessage";
      }
    | null
    | undefined;

  const messages = useCachedQuery(
    "threads.messagesForClient",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).threads.messagesForClient,
    clientOrgId && id
      ? {
          clientOrgId: clientOrgId as Id<"organizations">,
          threadId: id as Id<"threads">,
        }
      : "skip",
  ) as ThreadMessage[] | undefined;

  useEffect(() => {
    if (thread?.title) {
      setBreadcrumbExtra(
        <span className="truncate text-foreground">{thread.title}</span>,
      );
    }
    return () => setBreadcrumbExtra(null);
  }, [thread?.title, setBreadcrumbExtra]);

  if (thread === undefined || messages === undefined) {
    return <div className="min-h-40" />;
  }

  if (thread === null) {
    return (
      <div className="text-center py-16">
        <p className="text-base text-muted-foreground/40">
          Thread not found
        </p>
      </div>
    );
  }

  const firstUserIdx = messages.findIndex((m) => m.role === "user");

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {messages.length === 0 && (
        <div className="text-center py-16">
          <p className="text-base text-muted-foreground/40">No messages</p>
        </div>
      )}

      {messages.map((msg, idx) => {
        const isFirstUser = idx === firstUserIdx;
        const firstUserIsOwn =
          isFirstUser &&
          ((viewer?._id && msg.userId === viewer._id) ||
            (viewer?.email &&
              msg.fromEmail?.toLowerCase() === viewer.email.toLowerCase()));
        return (
          <div key={msg._id}>
            <UnifiedMessageBubble
              msg={msg}
              viewerId={viewer?._id}
              viewerEmail={viewer?.email ?? undefined}
              isFirstUserMessage={false}
              threadContext={undefined}
              brokerPerspective
            />
            {isFirstUser && thread.initialContext && (
              <div
                className={`mt-2 flex ${firstUserIsOwn ? "justify-end mr-9.5" : "ml-9.5"}`}
              >
                <ThreadContextLink context={thread.initialContext} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
