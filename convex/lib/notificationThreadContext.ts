import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export function objectRecord(value: unknown): Record<string, unknown> | null {
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

// Resolves a notification's referenced thread and, for view_thread
// notifications targeting a user-private thread, the only user allowed to
// receive the notification.
export async function resolveNotificationThreadContext(
  ctx: ActionCtx,
  notification: Doc<"notifications">,
): Promise<{
  thread: Doc<"threads"> | null;
  privateThreadOwner?: Id<"users">;
}> {
  const thread = await resolveReferencedThread(ctx, notification);
  const privateThreadOwner =
    notification.actionType === "view_thread" &&
    thread?.visibility === "user_private"
      ? thread.createdBy
      : undefined;
  return { thread, privateThreadOwner };
}
