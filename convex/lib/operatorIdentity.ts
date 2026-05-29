import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export type OperatorRole = "operator" | "owner";

export function normalizeOperatorEmail(email: string | undefined | null) {
  return (email ?? "").trim().toLowerCase();
}

export function operatorBootstrapEmails() {
  return new Set(
    (process.env.OPERATOR_BOOTSTRAP_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((email) => normalizeOperatorEmail(email))
      .filter(Boolean),
  );
}

export function isBootstrapOperatorEmail(email: string | undefined | null) {
  const normalized = normalizeOperatorEmail(email);
  return !!normalized && operatorBootstrapEmails().has(normalized);
}

export async function assertCustomerUser(
  ctx: Ctx,
  userId: Id<"users">,
  message = "Operator accounts cannot join customer organizations",
) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  if (user.accountKind === "operator" || isBootstrapOperatorEmail(user.email)) {
    throw new Error(message);
  }
  return user;
}

export async function assertCustomerEmail(
  email: string,
  message = "Operator emails cannot be used for customer accounts",
) {
  if (isBootstrapOperatorEmail(email)) throw new Error(message);
}

export async function getActiveOperatorProfile(ctx: Ctx): Promise<{
  userId: Id<"users">;
  user: Doc<"users">;
  profile: Doc<"operatorProfiles">;
} | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user || user.accountKind !== "operator") return null;
  const profile = await ctx.db
    .query("operatorProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!profile || profile.status !== "active") return null;
  return { userId, user, profile };
}

export async function requireOperator(ctx: Ctx) {
  const operator = await getActiveOperatorProfile(ctx);
  if (!operator) throw new Error("Operator access required");
  return operator;
}

export async function requireOperatorOwner(ctx: Ctx) {
  const operator = await requireOperator(ctx);
  if (operator.profile.role !== "owner") throw new Error("Operator owner access required");
  return operator;
}

export async function writeOperatorAudit(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    type:
      | "operator_bootstrap"
      | "broker_created"
      | "broker_status_changed"
      | "broker_launch_email_sent"
      | "client_created"
      | "client_status_changed"
      | "client_launch_email_sent"
      | "mga_created"
      | "mga_status_changed"
      | "mga_launch_email_sent"
      | "impersonation_started"
      | "impersonation_stopped"
      | "setup_write";
    targetOrgId?: Id<"organizations">;
    targetUserId?: Id<"users">;
    summary: string;
    metadata?: unknown;
  },
) {
  await ctx.db.insert("operatorAuditEvents", {
    operatorUserId: args.operatorUserId,
    type: args.type,
    targetOrgId: args.targetOrgId,
    targetUserId: args.targetUserId,
    summary: args.summary,
    metadata: args.metadata,
    createdAt: dayjs().valueOf(),
  });
}

export async function getActiveOperatorImpersonation(ctx: Ctx) {
  const operator = await getActiveOperatorProfile(ctx);
  if (!operator) return null;
  const session = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("by_operator_status", (q) =>
      q.eq("operatorUserId", operator.userId).eq("status", "active"),
    )
    .first();
  if (!session) return null;
  const targetOrg = await ctx.db.get(session.targetOrgId);
  if (!targetOrg) return null;
  return { operator, session, targetOrg };
}

export async function assertImpersonatedSetupWrite(
  ctx: Ctx,
  orgId: Id<"organizations">,
) {
  const active = await getActiveOperatorImpersonation(ctx);
  if (!active) return null;

  let setupOrg: Doc<"organizations"> | null = null;
  if (active.targetOrg._id === orgId) {
    setupOrg = active.targetOrg;
  } else {
    const org = await ctx.db.get(orgId);
    if (org?.type === "client" && org.brokerOrgId === active.targetOrg._id) {
      setupOrg = active.targetOrg.type === "broker" ? active.targetOrg : null;
    }
  }

  if (!setupOrg || (setupOrg.operatorStatus ?? "live") !== "onboarding") {
    throw new Error("Operator impersonation is read-only for this organization");
  }
  return active;
}

export async function assertImpersonatedBrokerTaskWrite(
  ctx: Ctx,
  orgId: Id<"organizations">,
) {
  const active = await getActiveOperatorImpersonation(ctx);
  if (!active) return null;

  let brokerOrg: Doc<"organizations"> | null = null;
  if (active.targetOrg._id === orgId && active.targetOrg.type === "broker") {
    brokerOrg = active.targetOrg;
  } else {
    const org = await ctx.db.get(orgId);
    if (
      org?.type === "client" &&
      org.brokerOrgId === active.targetOrg._id &&
      active.targetOrg.type === "broker"
    ) {
      brokerOrg = active.targetOrg;
    }
  }

  if (!brokerOrg) {
    throw new Error("Operator impersonation is read-only for this organization");
  }
  return active;
}
