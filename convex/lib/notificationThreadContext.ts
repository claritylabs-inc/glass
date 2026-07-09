import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function resolveReferencedThread(
  ctx: ActionCtx,
  notification: Doc<"notifications">,
): Promise<Doc<"threads"> | null> {
  for (const candidate of [notification.actionPayload, notification.sourceRef]) {
    const threadId = objectRecord(candidate)?.threadId;
    if (typeof threadId !== "string" || !threadId.trim()) continue;
    try {
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: threadId as Id<"threads">,
      });
      if (thread?.orgId === notification.orgId) return thread;
    } catch {
      continue;
    }
  }
  return null;
}

function resolveThreadLabel(
  notification: Doc<"notifications">,
  thread: Doc<"threads"> | null,
) {
  for (const candidate of [notification.actionPayload, notification.sourceRef]) {
    const threadTitle = objectRecord(candidate)?.threadTitle;
    if (typeof threadTitle === "string" && threadTitle.trim()) {
      return threadTitle.trim();
    }
  }
  return thread?.title.trim() || undefined;
}

export async function resolveNotificationThreadContext(
  ctx: ActionCtx,
  notification: Doc<"notifications">,
): Promise<{
  thread: Doc<"threads"> | null;
  privateThreadOwner?: Id<"users">;
  threadLabel?: string;
}> {
  const thread = await resolveReferencedThread(ctx, notification);
  const privateThreadOwner =
    notification.actionType === "view_thread" &&
    thread?.visibility === "user_private"
      ? thread.createdBy
      : undefined;
  return {
    thread,
    privateThreadOwner,
    threadLabel: resolveThreadLabel(notification, thread),
  };
}
