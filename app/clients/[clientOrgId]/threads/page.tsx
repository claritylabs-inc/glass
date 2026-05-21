"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FadeIn } from "@/components/ui/fade-in";
import { Mail, MessageCircle } from "lucide-react";
import dayjs from "dayjs";

export default function ClientThreadsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const router = useRouter();

  const threads = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).threads.listForClient,
    clientOrgId
      ? { clientOrgId: clientOrgId as Id<"organizations">, archived: false }
      : "skip",
  ) as
    | Array<{
        _id: string;
        _creationTime: number;
        title: string;
        lastMessageAt?: number;
        originChannel?: "chat" | "email" | "imessage";
        threadPhone?: string;
      }>
    | undefined;

  const visibleThreads = threads ?? [];

  return (
    <FadeIn when={true} duration={0.12}>
      {visibleThreads.length === 0 && (
        <div className="text-center py-16">
          <p className="text-body-sm text-muted-foreground/40">
            No threads yet
          </p>
        </div>
      )}

      {visibleThreads.length > 0 && (
        <div className="space-y-1">
          {visibleThreads.map((thread) => (
            <button
              key={thread._id}
              type="button"
              onClick={() =>
                router.push(`/clients/${clientOrgId}/threads/${thread._id}`)
              }
              className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-foreground/6 bg-card hover:bg-foreground/[0.02] transition-colors group"
            >
              <div className="shrink-0 text-muted-foreground/30">
                {thread.originChannel === "imessage" ? (
                  <MessageCircle className="w-4 h-4" />
                ) : thread.originChannel === "email" ? (
                  <Mail className="w-4 h-4" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
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
              </div>
            </button>
          ))}
        </div>
      )}
    </FadeIn>
  );
}
