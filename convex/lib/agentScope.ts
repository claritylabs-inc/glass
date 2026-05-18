import dayjs from "dayjs";
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type AgentSurface = "web" | "email" | "imessage" | "mcp" | "cli";

export type AgentScopeOrg = {
  orgId: Id<"organizations">;
  name: string;
  type: "broker" | "client";
  isPrimary: boolean;
  canWrite: boolean;
  policyCount: number;
  quoteCount: number;
  expiringPolicyCount: number;
  expiredPolicyCount: number;
  openVendorComplianceItems: number;
  recentActivityCount: number;
};

export type AgentScope = {
  mode: "client" | "broker_portfolio";
  surface: AgentSurface;
  primaryOrgId: Id<"organizations">;
  readOrgIds: Id<"organizations">[];
  writableOrgIds: Id<"organizations">[];
  orgs: AgentScopeOrg[];
  focusedOrgId?: Id<"organizations">;
  brokerInternal: boolean;
};

function orgName(org: Doc<"organizations">): string {
  return org.name?.trim() || String(org._id);
}

async function summarizeOrg(ctx: any, org: Doc<"organizations">, args: {
  primaryOrgId: Id<"organizations">;
  canWrite: boolean;
}): Promise<AgentScopeOrg> {
  const now = dayjs().valueOf();
  const soon = dayjs().add(60, "day").valueOf();
  const policies = await ctx.db
    .query("policies")
    .withIndex("by_orgId", (q: any) => q.eq("orgId", org._id))
    .collect();
  const activeDocs = policies.filter((policy: Doc<"policies">) => !policy.deletedAt);
  const policyDocs = activeDocs.filter((policy: Doc<"policies">) => policy.documentType !== "quote");
  const quoteDocs = activeDocs.filter((policy: Doc<"policies">) => policy.documentType === "quote");
  const policyExpiry = policyDocs
    .map((policy: Doc<"policies">) => {
      const raw = policy.expirationDate;
      const parsed = raw ? dayjs(raw).valueOf() : Number.NaN;
      return Number.isFinite(parsed) ? parsed : undefined;
    })
    .filter((value: number | undefined): value is number => typeof value === "number");
  const expiredPolicyCount = policyExpiry.filter((value: number) => value < now).length;
  const expiringPolicyCount = policyExpiry.filter((value: number) => value >= now && value <= soon).length;

  const vendorRows = await ctx.db
    .query("vendorComplianceChecks")
    .withIndex("by_clientOrgId", (q: any) => q.eq("clientOrgId", org._id))
    .collect()
    .catch(() => []);
  const openVendorComplianceItems = vendorRows.filter(
    (row: Doc<"vendorComplianceChecks">) => row.status !== "met",
  ).length;

  const recentSince = dayjs().subtract(30, "day").valueOf();
  const recentActivity = await ctx.db
    .query("brokerActivity")
    .withIndex("by_clientOrgId_createdAt", (q: any) => q.eq("clientOrgId", org._id).gte("createdAt", recentSince))
    .collect()
    .catch(() => []);

  return {
    orgId: org._id,
    name: orgName(org),
    type: (org.type as "broker" | "client") ?? "client",
    isPrimary: org._id === args.primaryOrgId,
    canWrite: args.canWrite,
    policyCount: policyDocs.length,
    quoteCount: quoteDocs.length,
    expiringPolicyCount,
    expiredPolicyCount,
    openVendorComplianceItems,
    recentActivityCount: recentActivity.length,
  };
}

export const resolveForAction = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    surface: v.union(
      v.literal("web"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("mcp"),
      v.literal("cli"),
    ),
    focusedOrgId: v.optional(v.id("organizations")),
    allowBrokerPortfolio: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<AgentScope> => {
    const primaryOrg = await ctx.db.get(args.orgId);
    if (!primaryOrg) throw new Error("Organization not found");

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", args.orgId).eq("userId", args.userId))
      .first();
    if (!membership) throw new Error("Unauthorized");

    const primaryType = (primaryOrg.type as "broker" | "client") ?? "client";
    const allowBrokerPortfolio = args.allowBrokerPortfolio ?? true;

    if (primaryType !== "broker" || !allowBrokerPortfolio) {
      return {
        mode: "client",
        surface: args.surface,
        primaryOrgId: primaryOrg._id,
        readOrgIds: [primaryOrg._id],
        writableOrgIds: [primaryOrg._id],
        orgs: [await summarizeOrg(ctx, primaryOrg, { primaryOrgId: primaryOrg._id, canWrite: true })],
        focusedOrgId: args.focusedOrgId,
        brokerInternal: false,
      };
    }

    const clients = await ctx.db
      .query("organizations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", primaryOrg._id))
      .collect();

    let focusedOrgId = args.focusedOrgId;
    if (focusedOrgId && focusedOrgId !== primaryOrg._id) {
      const focused = clients.find((client) => client._id === focusedOrgId);
      if (!focused) focusedOrgId = undefined;
    }

    const portfolioOrgs = [primaryOrg, ...clients];
    const orgs = await Promise.all(
      portfolioOrgs.map((org) =>
        summarizeOrg(ctx, org, {
          primaryOrgId: primaryOrg._id,
          canWrite: org._id === primaryOrg._id || org.brokerOrgId === primaryOrg._id,
        }),
      ),
    );

    return {
      mode: "broker_portfolio",
      surface: args.surface,
      primaryOrgId: primaryOrg._id,
      readOrgIds: portfolioOrgs.map((org) => org._id),
      writableOrgIds: portfolioOrgs.map((org) => org._id),
      orgs,
      focusedOrgId,
      brokerInternal: true,
    };
  },
});

export function formatAgentScopePortfolioIndex(scope: AgentScope): string {
  if (scope.mode !== "broker_portfolio") return "";
  const lines = scope.orgs.map((org) => {
    const focus = scope.focusedOrgId === org.orgId ? " [focused]" : "";
    return `- ${org.name}${focus} (${org.type}, orgId: ${org.orgId}): ${org.policyCount} policies, ${org.quoteCount} quotes, ${org.expiringPolicyCount} expiring within 60 days, ${org.expiredPolicyCount} expired, ${org.openVendorComplianceItems} open vendor compliance item(s), ${org.recentActivityCount} recent broker activity item(s)`;
  });
  return `\n\nBROKER PORTFOLIO INDEX:\n${lines.join("\n")}`;
}

export function orgLabelForScope(scope: AgentScope, orgId: Id<"organizations"> | string): string {
  return scope.orgs.find((org) => String(org.orgId) === String(orgId))?.name ?? String(orgId);
}

export function isOrgReadableByScope(scope: AgentScope, orgId: Id<"organizations"> | string): boolean {
  return scope.readOrgIds.some((id) => String(id) === String(orgId));
}
