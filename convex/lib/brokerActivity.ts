import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export type BrokerActivityEvent = {
  brokerOrgId: Id<"organizations">;
  clientOrgId: Id<"organizations">;
  type:
    | "invitation_accepted"
    | "onboarding_completed"
    | "document_uploaded"
    | "policy_uploaded"
    | "policy_extraction_completed"
    | "notification_fired";
  actorUserId?: Id<"users">;
  actorSide: "broker" | "client" | "system";
  payload?: Record<string, unknown>;
  summary: string;
};

export async function recordBrokerActivity(
  ctx: MutationCtx,
  event: BrokerActivityEvent,
): Promise<void> {
  await ctx.db.insert("brokerActivity", {
    ...event,
    createdAt: Date.now(),
  });
}
