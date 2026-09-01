"use client";

import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, MessageSquare, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { OperatorSidebar } from "@/app/operator/operator-sidebar";
import { AppShell } from "@/components/app-shell";
import { useOptionalOperatorAgent } from "@/components/operator-agent/operator-agent-provider";
import {
  OperatorThreadChannelIcon,
  operatorThreadChannelLabel,
} from "@/components/operator-agent/operator-thread-channel";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  normalizeOperatorAgentThreads,
  operatorAgentApi,
} from "@/lib/operator-agent-api";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";

export default function OperatorThreadsPage() {
  const router = useRouter();
  const controller = useOptionalOperatorAgent();
  const rawThreads = useQuery(operatorAgentApi.listThreads, { limit: 100 });
  const threads = useMemo(
    () => normalizeOperatorAgentThreads(rawThreads),
    [rawThreads],
  );
  const createThread = useMutation(operatorAgentApi.createThread);

  async function startThread() {
    try {
      const threadId = await createThread({});
      controller?.setActiveThreadId(threadId);
      router.push(`/operator/threads/${threadId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start a thread",
      );
    }
  }

  return (
    <AppShell
      actions={
        <PillButton type="button" onClick={() => void startThread()}>
          <Plus className="size-4" />
          New thread
        </PillButton>
      }
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="threads"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
    >
      {rawThreads === undefined ? (
        <OperationalPanel>
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </OperationalPanel>
      ) : threads.length === 0 ? (
        <EmptyStateCard
          icon={<MessageSquare className="size-5" />}
          title="No operator threads yet"
          description="Start a thread here, or message Spot from Slack or iMessage."
          actionLabel="Start a thread"
          onAction={() => void startThread()}
        />
      ) : (
        <OperationalPanel>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[64%] sm:w-[58%]">
                  Conversation
                </TableHead>
                <TableHead className="w-[36%] sm:w-[18%]">Channel</TableHead>
                <TableHead className="hidden w-[24%] text-right sm:table-cell">
                  Last activity
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {threads.map((thread) => (
                <TableRow
                  key={thread.id}
                  tabIndex={0}
                  onClick={() => router.push(`/operator/threads/${thread.id}`)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    router.push(`/operator/threads/${thread.id}`);
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <TableCell>
                    <p
                      className={`truncate text-foreground ${typeStyle("body.medium")}`}
                    >
                      {thread.title}
                    </p>
                    <p
                      className={`truncate text-muted-foreground sm:hidden ${typeStyle("caption.default")}`}
                    >
                      {formatDisplayDateTime(thread.lastMessageAt)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <OperatorThreadChannelIcon
                        channel={thread.channel}
                        className="size-3.5 shrink-0"
                      />
                      {operatorThreadChannelLabel(thread.channel)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                    {formatDisplayDateTime(thread.lastMessageAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </OperationalPanel>
      )}
    </AppShell>
  );
}
