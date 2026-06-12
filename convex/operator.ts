import dayjs from "dayjs";
import { v } from "convex/values";
import { createAccount, getAuthUserId } from "@convex-dev/auth/server";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { buildEmailShell, escapeHtml } from "./lib/emailTemplate";
import { getAuthFromAddress, sendResendEmail } from "./lib/resend";
import { getAuthSiteUrl } from "./lib/domains";
import { normalizeCoverageName } from "./lib/coverageNames";
import {
  findUserByNormalizedPhone,
  normalizeAvailableUserPhone,
  normalizeUserPhone,
} from "./lib/userPhone";
import {
  assertCustomerUser,
  isBootstrapOperatorEmail,
  normalizeOperatorEmail,
  requireOperator,
  writeOperatorAudit,
} from "./lib/operatorIdentity";

const brokerStatusValidator = v.union(v.literal("onboarding"), v.literal("live"));
const orgRoleValidator = v.union(v.literal("admin"), v.literal("member"));
const extractionTraceStatusValidator = v.union(
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
  v.literal("cancelled"),
);
const internalApi = internal as any;
const OPERATOR_TRACE_EVENT_LIMIT = 500;
const CANCELLED_BY_USER = "Cancelled by user";

type OperatorSourceNode = Doc<"sourceNodes">;

function normalizeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
}

function slugFromName(name: string) {
  return normalizeSlug(name.trim().replace(/\s+/g, "-"));
}

function normalizeHandle(value: string | undefined) {
  const raw = value?.trim().toLowerCase() ?? "";
  const withoutDomain = raw.includes("@") ? raw.split("@")[0] : raw;
  const normalized = withoutDomain.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

function validateAgentHandle(handle: string | undefined) {
  if (!handle) return;
  if (handle.length < 3 || handle.length > 30) {
    throw new Error("Agent handle must be 3-30 characters");
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(handle)) {
    throw new Error("Agent handle must start with a letter and end with a letter or number");
  }
}

function normalizeOptionalContactEmail(value: string | undefined) {
  const email = normalizeOperatorEmail(value);
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid contact email");
  }
  return email;
}

function normalizeOptionalContactPhone(value: string | undefined) {
  const phone = value?.trim();
  if (!phone) return undefined;
  const parsed = parsePhoneNumberFromString(phone, "US");
  if (!parsed || !parsed.isValid()) {
    throw new Error("Enter a valid contact phone number");
  }
  return parsed.number;
}

async function clearOperatorExtractionQueue(
  ctx: MutationCtx,
  policyId: Id<"policies">,
) {
  const rows = await ctx.db
    .query("policyExtractionQueue")
    .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

async function clearOperatorExtractionArtifacts(
  ctx: MutationCtx,
  policyId: Id<"policies">,
) {
  const artifacts = await ctx.db
    .query("policyExtractionArtifacts")
    .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
    .collect();
  for (const artifact of artifacts) {
    await ctx.storage.delete(artifact.storageId).catch(() => {});
    await ctx.db.delete(artifact._id);
  }
}

function appendExtractionStopLog(
  log: Doc<"policyExtractionRuns">["pipelineLog"],
  timestamp: number,
) {
  return [
    ...(Array.isArray(log) ? log : []),
    {
      timestamp,
      message: "Extraction stopped by operator",
      phase: "cancel",
      level: "warn",
    },
  ].slice(-200);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function sourceNodeText(node: OperatorSourceNode) {
  return node.textExcerpt || node.description || node.title;
}

function normalizeCoverageContextText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+[|/:-]+$/g, "")
    .trim();
}

function coverageSourceContext(
  coverage: Record<string, unknown>,
  node: OperatorSourceNode | undefined,
  children: OperatorSourceNode[],
) {
  if (!node) return undefined;
  const excluded = new Set(
    [
      coverage.name,
      coverage.limit,
      coverage.deductible,
      coverage.premium,
    ]
      .map((value) => typeof value === "string" ? normalizeCoverageContextText(value).toLowerCase() : "")
      .filter(Boolean),
  );
  const cells = children
    .filter((child) => child.kind === "table_cell")
    .sort((left, right) => left.order - right.order);
  const contextCells = cells
    .map((cell) => ({
      label: normalizeCoverageContextText(cell.title),
      value: normalizeCoverageContextText(sourceNodeText(cell)),
    }))
    .filter((cell) => {
      if (!cell.value || excluded.has(cell.value.toLowerCase())) return false;
      if (/^\$?[\d,.]+(?:\s*\/\s*\$?[\d,.]+)?(?:\s*\([^)]*\))?$/i.test(cell.value)) return false;
      if (/^(each claim limit|aggregate limit|deductible|premium|retroactive date)$/i.test(cell.label)) return false;
      return true;
    });
  const preferred = contextCells.find((cell) =>
    /\b(coverage|part|class|description|item|subject|type|column 1)\b/i.test(cell.label),
  ) ?? contextCells[0];
  if (preferred) {
    return preferred.label && !/^column\s+\d+$/i.test(preferred.label)
      ? `${preferred.label}: ${preferred.value}`
      : preferred.value;
  }
  const rowText = normalizeCoverageContextText(node.textExcerpt ?? "");
  return rowText || undefined;
}

async function policyWithOperatorCoverageContext(
  ctx: QueryCtx,
  policy: Doc<"policies"> | null,
) {
  const profile = recordValue(policy?.operationalProfile);
  const coverages = Array.isArray(profile?.coverages)
    ? profile.coverages.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  if (!policy || !profile || coverages.length === 0) return policy;

  const coverageNodeIds = [
    ...new Set(coverages.flatMap((coverage) => stringArray(coverage.sourceNodeIds))),
  ].slice(0, 80);
  if (coverageNodeIds.length === 0) return policy;

  const nodeEntries = await Promise.all(
    coverageNodeIds.map(async (nodeId) => {
      const node = await ctx.db
        .query("sourceNodes")
        .withIndex("by_policyId_nodeId", (q) =>
          q.eq("policyId", policy._id).eq("nodeId", nodeId),
        )
        .first();
      const children = node
        ? await ctx.db
            .query("sourceNodes")
            .withIndex("by_policyId_parentNodeId", (q) =>
              q.eq("policyId", policy._id).eq("parentNodeId", node.nodeId),
            )
            .collect()
        : [];
      return [nodeId, { node, children }] as const;
    }),
  );
  const nodesById = new Map(nodeEntries);
  return {
    ...policy,
    operationalProfile: {
      ...profile,
      coverages: coverages.map((coverage) => {
        const nodeId = stringArray(coverage.sourceNodeIds)[0];
        const entry = nodeId ? nodesById.get(nodeId) : undefined;
        const context = coverageSourceContext(
          coverage,
          entry?.node ?? undefined,
          entry?.children ?? [],
        );
        const name = normalizeCoverageName(context) ?? normalizeCoverageName(
          typeof coverage.name === "string" ? coverage.name : undefined,
        );
        return name ? { ...coverage, name } : coverage;
      }),
    },
  };
}

function operatorOwnerEmails() {
  return new Set(
    (process.env.OPERATOR_OWNER_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((email) => normalizeOperatorEmail(email))
      .filter(Boolean),
  );
}

function roleForBootstrapEmail(email: string): "operator" | "owner" {
  const owners = operatorOwnerEmails();
  if (owners.has(email)) return "owner";
  return "operator";
}

async function countBrokerClients(ctx: QueryCtx, brokerOrgId: Id<"organizations">) {
  const clients = await ctx.db
    .query("organizations")
    .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
    .take(500);
  return clients.length;
}

async function getOrgAdmin(ctx: QueryCtx, orgId: Id<"organizations">) {
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(20);
  const adminMembership = memberships.find((membership) => membership.role === "admin");
  return adminMembership ? await ctx.db.get(adminMembership.userId) : null;
}

export const bootstrapViewer = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    const email = normalizeOperatorEmail(user?.email);
    if (!user || !email || !isBootstrapOperatorEmail(email)) {
      throw new Error("This email is not authorized for operator access");
    }

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (memberships) {
      throw new Error("Customer accounts cannot become operator accounts");
    }

    const now = dayjs().valueOf();
    const role = roleForBootstrapEmail(email);
    const existing = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    await ctx.db.patch(userId, {
      accountKind: "operator",
      onboardingComplete: true,
    });
    if (existing) {
      await ctx.db.patch(existing._id, {
        email,
        role,
        status: "active",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("operatorProfiles", {
        userId,
        email,
        role,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: userId,
      type: "operator_bootstrap",
      summary: `Operator account bootstrapped for ${email}`,
    });
    return { ok: true, role };
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const activeImpersonation = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("by_operator_status", (q) =>
        q.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .first();
    const targetOrg = activeImpersonation
      ? await ctx.db.get(activeImpersonation.targetOrgId)
      : null;
    return {
      user: {
        _id: operator.user._id,
        name: operator.user.name,
        email: operator.user.email,
      },
      profile: operator.profile,
      activeImpersonation: activeImpersonation && targetOrg
        ? {
            ...activeImpersonation,
            targetOrgName: targetOrg.name,
            targetOrgType: targetOrg.type ?? "client",
            targetOrgOperatorStatus: targetOrg.operatorStatus ?? "live",
          }
        : null,
    };
  },
});

export const listBrokers = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const search = args.search?.trim().toLowerCase();
    const brokers = await ctx.db
      .query("organizations")
      .withIndex("by_type", (q) => q.eq("type", "broker"))
      .take(200);
    const filtered = search
      ? brokers.filter((broker) =>
          [broker.name, broker.slug, broker.website, broker.primaryContactEmail]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search)),
        )
      : brokers;
    return await Promise.all(
      filtered.map(async (broker) => {
        const memberships = await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", broker._id))
          .take(20);
        const adminMembership = memberships.find((membership) => membership.role === "admin");
        const admin = adminMembership ? await ctx.db.get(adminMembership.userId) : null;
        return {
          _id: broker._id,
          name: broker.name,
          slug: broker.slug,
          website: broker.website,
          iconUrl: broker.iconStorageId ? await ctx.storage.getUrl(broker.iconStorageId) : null,
          agentHandle: broker.agentHandle,
          operatorStatus: broker.operatorStatus ?? "live",
          onboardingComplete: broker.onboardingComplete,
          adminName: admin?.name,
          adminEmail: admin?.email,
          adminPhone: admin?.phone,
          clientCount: await countBrokerClients(ctx, broker._id),
          createdAt: broker._creationTime,
        };
      }),
    );
  },
});

async function listOperatorClientRows(ctx: QueryCtx) {
  const clients = await ctx.db
    .query("organizations")
    .withIndex("by_type", (q) => q.eq("type", "client"))
    .take(500);
  return await Promise.all(
    clients.map(async (client) => {
      const admin = await getOrgAdmin(ctx, client._id);
      const broker = client.brokerOrgId ? await ctx.db.get(client.brokerOrgId) : null;
      return {
        _id: client._id,
        name: client.name,
        website: client.website,
        iconUrl: client.iconStorageId ? await ctx.storage.getUrl(client.iconStorageId) : null,
        agentHandle: client.agentHandle,
        operatorStatus: client.operatorStatus ?? "live",
        onboardingComplete: client.onboardingComplete,
        inviteStatus: client.inviteStatus,
        primaryContactName: client.primaryContactName,
        primaryContactEmail: client.primaryContactEmail,
        primaryContactPhone: client.primaryContactPhone,
        adminUserId: admin?._id,
        adminName: admin?.name,
        adminEmail: admin?.email,
        adminPhone: admin?.phone,
        brokerOrgId: client.brokerOrgId,
        brokerName: broker?.name,
        createdAt: client._creationTime,
      };
    }),
  );
}

export const listClients = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return await listOperatorClientRows(ctx);
  },
});

export const listSoloClients = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return await listOperatorClientRows(ctx);
  },
});

export const listMGAs = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const partners = await ctx.db
      .query("organizations")
      .withIndex("by_type", (q) => q.eq("type", "partner"))
      .take(300);
    const mgas = partners.filter((partner) => partner.partnerKind === "program_admin");
    return await Promise.all(
      mgas.map(async (mga) => {
        const admin = await getOrgAdmin(ctx, mga._id);
        const program = await ctx.db
          .query("partnerPrograms")
          .withIndex("by_partnerOrgId", (q) => q.eq("partnerOrgId", mga._id))
          .first();
        return {
          _id: mga._id,
          name: mga.name,
          website: mga.website,
          iconUrl: mga.iconStorageId ? await ctx.storage.getUrl(mga.iconStorageId) : null,
          programName: program?.name,
          operatorStatus: mga.operatorStatus ?? "live",
          onboardingComplete: mga.onboardingComplete,
          adminName: admin?.name,
          adminEmail: admin?.email,
          createdAt: mga._creationTime,
        };
      }),
    );
  },
});

export const listExtractionTraces = query({
  args: {
    status: v.optional(extractionTraceStatusValidator),
    orgId: v.optional(v.id("organizations")),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 200), 500));
    const sessions = args.orgId
      ? await ctx.db
        .query("policyExtractionTraceSessions")
        .withIndex("by_orgId_startedAt", (q) => {
          const byOrg = q.eq("orgId", args.orgId!);
          if (args.dateFrom !== undefined && args.dateTo !== undefined) return byOrg.gte("startedAt", args.dateFrom).lte("startedAt", args.dateTo);
          if (args.dateFrom !== undefined) return byOrg.gte("startedAt", args.dateFrom);
          if (args.dateTo !== undefined) return byOrg.lte("startedAt", args.dateTo);
          return byOrg;
        })
        .order("desc")
        .take(limit)
      : args.status
        ? await ctx.db
          .query("policyExtractionTraceSessions")
          .withIndex("by_status_startedAt", (q) => {
            const byStatus = q.eq("status", args.status!);
            if (args.dateFrom !== undefined && args.dateTo !== undefined) return byStatus.gte("startedAt", args.dateFrom).lte("startedAt", args.dateTo);
            if (args.dateFrom !== undefined) return byStatus.gte("startedAt", args.dateFrom);
            if (args.dateTo !== undefined) return byStatus.lte("startedAt", args.dateTo);
            return byStatus;
          })
          .order("desc")
          .take(limit)
        : await ctx.db
          .query("policyExtractionTraceSessions")
          .withIndex("by_startedAt", (q) => {
            if (args.dateFrom !== undefined && args.dateTo !== undefined) return q.gte("startedAt", args.dateFrom).lte("startedAt", args.dateTo);
            if (args.dateFrom !== undefined) return q.gte("startedAt", args.dateFrom);
            if (args.dateTo !== undefined) return q.lte("startedAt", args.dateTo);
            return q;
          })
          .order("desc")
          .take(limit);
    const filtered = sessions
      .filter((session) => !args.status || session.status === args.status)
      .filter((session) => args.dateFrom === undefined || session.startedAt >= args.dateFrom!)
      .filter((session) => args.dateTo === undefined || session.startedAt <= args.dateTo!)
      .slice(0, limit);

    const orgIds = Array.from(new Set(filtered.map((session) => session.orgId)));
    const orgRows = await Promise.all(orgIds.map(async (orgId) => {
      const org = await ctx.db.get(orgId);
      return [orgId, org] as const;
    }));
    const orgsById = new Map(orgRows);

    return filtered.map((session) => {
      const org = orgsById.get(session.orgId);
      const policyLabel = session.fileName ?? "Extraction trace";
      return {
        _id: session._id,
        _creationTime: session._creationTime,
        traceId: session.traceId,
        policyId: session.policyId,
        orgId: session.orgId,
        userId: session.userId,
        sourceKind: session.sourceKind,
        trigger: session.trigger,
        fileName: session.fileName,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        lastEventAt: session.lastEventAt,
        totalDurationMs: session.totalDurationMs,
        modelCallCount: session.modelCallCount,
        modelDurationMs: session.modelDurationMs,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        slowestLabel: session.slowestLabel,
        slowestKind: session.slowestKind,
        slowestDurationMs: session.slowestDurationMs,
        error: session.error,
        expiresAt: session.expiresAt,
        updatedAt: session.updatedAt,
        orgName: org?.name ?? "Unknown org",
        orgType: org?.type ?? "client",
        policyLabel,
        documentType: session.sourceKind ?? "policy",
      };
    });
  },
});

export const getExtractionTrace = query({
  args: { traceId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();
    if (!session) return null;
    const [org, rawPolicy, eventsWithExtra] = await Promise.all([
      ctx.db.get(session.orgId),
      ctx.db.get(session.policyId),
      ctx.db
        .query("policyExtractionTraceEvents")
        .withIndex("by_traceId_timestamp", (q) => q.eq("traceId", args.traceId))
        .order("asc")
        .take(OPERATOR_TRACE_EVENT_LIMIT + 1),
    ]);
    const policy = await policyWithOperatorCoverageContext(ctx, rawPolicy);
    const eventsTruncated = eventsWithExtra.length > OPERATOR_TRACE_EVENT_LIMIT;
    const events = eventsWithExtra.slice(0, OPERATOR_TRACE_EVENT_LIMIT);
    const fileUrl = policy?.fileId ? await ctx.storage.getUrl(policy.fileId) : null;
    return {
      session: {
        ...session,
        orgName: org?.name ?? "Unknown org",
        orgType: org?.type ?? "client",
        policyLabel: policy
          ? [
              policy.carrier && policy.carrier !== "Extracting..." ? policy.carrier : null,
              policy.policyNumber && policy.policyNumber !== "Extracting..." ? policy.policyNumber : null,
            ].filter(Boolean).join(" · ") || policy.fileName || "Extracting..."
          : "Deleted policy",
        fileName: session.fileName ?? policy?.fileName,
        documentType: policy?.documentType ?? "policy",
      },
      policy,
      eventsTruncated,
      fileUrl,
      events,
    };
  },
});

export const rerunExtraction = action({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args): Promise<{ success: boolean; traceId?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, { userId });

    const policy = await ctx.runQuery(internalApi.policies.getInternal, {
      id: args.policyId,
    });
    if (!policy) throw new Error("Policy not found");

    const result = await ctx.runAction(internalApi.actions.policyExtraction.retryPolicyExtraction, {
      policyId: args.policyId,
      mode: "full",
    }) as { success?: boolean; traceId?: string } | undefined;
    return { success: true, traceId: result?.traceId };
  },
});

export const stopExtraction = mutation({
  args: { traceId: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();
    if (!session) throw new Error("Extraction trace not found");
    if (session.status !== "running") {
      return { success: true, stopped: false };
    }

    const timestamp = dayjs().valueOf();
    const policy = await ctx.db.get(session.policyId);
    const run = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("by_policyId", (q) => q.eq("policyId", session.policyId))
      .first();

    if (run) {
      await ctx.db.patch(run._id, {
        pipelineStatus: "error",
        pipelineError: CANCELLED_BY_USER,
        pipelineCheckpoint: undefined,
        pipelineLog: appendExtractionStopLog(run.pipelineLog, timestamp),
        updatedAt: timestamp,
      });
    }
    await clearOperatorExtractionQueue(ctx, session.policyId);
    await clearOperatorExtractionArtifacts(ctx, session.policyId);

    if (policy) {
      await ctx.db.patch(session.policyId, {
        pipelineStatus: "error",
        pipelineError: CANCELLED_BY_USER,
        pipelineCheckpoint: undefined,
        pipelineLog: undefined,
      });
      await ctx.db.insert("policyAuditLog", {
        policyId: session.policyId,
        userId: operator.userId,
        orgId: policy.orgId,
        action: "operator_cancelled_extraction",
        detail: args.traceId,
      });
    }

    await ctx.db.patch(session._id, {
      status: "cancelled",
      completedAt: timestamp,
      lastEventAt: timestamp,
      totalDurationMs: timestamp - session.startedAt,
      error: CANCELLED_BY_USER,
      updatedAt: timestamp,
    });
    await ctx.db.insert("policyExtractionTraceEvents", {
      traceId: session.traceId,
      policyId: session.policyId,
      orgId: session.orgId,
      kind: "session",
      timestamp,
      status: "cancelled",
      message: "Extraction stopped by operator",
      error: CANCELLED_BY_USER,
      durationMs: timestamp - session.startedAt,
      expiresAt: session.expiresAt,
    });

    return { success: true, stopped: true };
  },
});

export const checkBrokerSetupIdentifiers = query({
  args: {
    slug: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const slug = args.slug ? normalizeSlug(args.slug) : undefined;
    const agentHandle = normalizeHandle(args.agentHandle);

    let slugOrgId: Id<"organizations"> | undefined;
    const slugStatus = slug
      ? await (async () => {
          if (slug.length < 3 || slug.length > 40) {
            return { available: false, normalized: slug, reason: "Slug must be 3-40 characters", mode: "unavailable" as const };
          }
          if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
            return { available: false, normalized: slug, reason: "Slug must start and end with a letter or number", mode: "unavailable" as const };
          }
          const slugOrg = await ctx.db
            .query("organizations")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .first();
          if (!slugOrg) return { available: true, normalized: slug, mode: "available" as const };
          slugOrgId = slugOrg._id;
          if (slugOrg.type === "broker") {
            return { available: true, normalized: slug, reason: "Existing broker will be updated", mode: "updates_existing" as const };
          }
          return { available: false, normalized: slug, reason: "Slug is already used by a non-broker org", mode: "unavailable" as const };
        })()
      : null;

    const handleStatus = agentHandle
      ? await (async () => {
          try {
            validateAgentHandle(agentHandle);
          } catch (error) {
            return {
              available: false,
              normalized: agentHandle,
              reason: error instanceof Error ? error.message : "Agent handle is invalid",
              mode: "unavailable" as const,
            };
          }
          const existingByHandle = await ctx.db
            .query("organizations")
            .withIndex("by_agentHandle", (q) => q.eq("agentHandle", agentHandle))
            .first();
          if (!existingByHandle) {
            return { available: true, normalized: agentHandle, mode: "available" as const };
          }
          if (slugOrgId && existingByHandle._id === slugOrgId) {
            return { available: true, normalized: agentHandle, reason: "Existing broker will be updated", mode: "updates_existing" as const };
          }
          return { available: false, normalized: agentHandle, reason: "Agent handle is already taken", mode: "unavailable" as const };
        })()
      : null;

    return { slug: slugStatus, agentHandle: handleStatus };
  },
});

export const checkUserPhoneAvailability = query({
  args: {
    phone: v.string(),
    ownerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);

    let normalized: string | undefined;
    try {
      normalized = normalizeUserPhone(args.phone);
    } catch {
      return { available: false, normalized: "" };
    }
    if (!normalized) return { available: false, normalized: "" };

    const existing = await findUserByNormalizedPhone(ctx, normalized);
    return {
      available: !existing || existing._id === args.ownerUserId,
      current: existing?._id === args.ownerUserId,
      normalized,
    };
  },
});

export const createBroker = action({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    website: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    adminPhone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ brokerOrgId: Id<"organizations"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, { userId });

    const adminEmail = normalizeOperatorEmail(args.adminEmail);
    if (!adminEmail || isBootstrapOperatorEmail(adminEmail)) {
      throw new Error("Broker admin email must be a customer email");
    }
    const now = dayjs().valueOf();
    const account = await createAccount(ctx, {
      provider: "resend-otp",
      account: { id: adminEmail },
      profile: {
        email: adminEmail,
        name: args.adminName?.trim() || undefined,
        accountKind: "customer",
        emailVerificationTime: now,
        onboardingComplete: true,
      },
      shouldLinkViaEmail: true,
    });
    if (!account.user) throw new Error("Could not create broker admin");

    return await ctx.runMutation(internalApi.operator.upsertBrokerInternal, {
      operatorUserId: userId,
      adminUserId: account.user._id,
      adminEmail,
      adminName: args.adminName,
      adminPhone: args.adminPhone,
      broker: {
        name: args.name,
        slug: args.slug,
        website: args.website,
        agentHandle: args.agentHandle,
      },
    });
  },
});

export const createSoloClient = action({
  args: {
    name: v.string(),
    brokerOrgId: v.optional(v.id("organizations")),
    website: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    adminPhone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ clientOrgId: Id<"organizations"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, { userId });

    const adminEmail = normalizeOperatorEmail(args.adminEmail);
    if (!adminEmail || isBootstrapOperatorEmail(adminEmail)) {
      throw new Error("Client admin email must be a customer email");
    }
    const now = dayjs().valueOf();
    const account = await createAccount(ctx, {
      provider: "resend-otp",
      account: { id: adminEmail },
      profile: {
        email: adminEmail,
        name: args.adminName?.trim() || undefined,
        accountKind: "customer",
        emailVerificationTime: now,
        onboardingComplete: true,
      },
      shouldLinkViaEmail: true,
    });
    if (!account.user) throw new Error("Could not create client admin");

    return await ctx.runMutation(internalApi.operator.createSoloClientInternal, {
      operatorUserId: userId,
      adminUserId: account.user._id,
      adminEmail,
      adminName: args.adminName,
      adminPhone: args.adminPhone,
      client: {
        name: args.name,
        brokerOrgId: args.brokerOrgId,
        website: args.website,
        agentHandle: args.agentHandle,
      },
    });
  },
});

export const createMGA = action({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    programName: v.optional(v.string()),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ mgaOrgId: Id<"organizations"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, { userId });

    const adminEmail = normalizeOperatorEmail(args.adminEmail);
    if (!adminEmail || isBootstrapOperatorEmail(adminEmail)) {
      throw new Error("MGA admin email must be a customer email");
    }
    const now = dayjs().valueOf();
    const account = await createAccount(ctx, {
      provider: "resend-otp",
      account: { id: adminEmail },
      profile: {
        email: adminEmail,
        name: args.adminName?.trim() || undefined,
        accountKind: "customer",
        emailVerificationTime: now,
        onboardingComplete: true,
      },
      shouldLinkViaEmail: true,
    });
    if (!account.user) throw new Error("Could not create MGA admin");

    return await ctx.runMutation(internalApi.operator.createMGAInternal, {
      operatorUserId: userId,
      adminUserId: account.user._id,
      adminEmail,
      adminName: args.adminName,
      mga: {
        name: args.name,
        website: args.website,
        programName: args.programName,
      },
    });
  },
});

export const setBrokerStatus = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    status: brokerStatusValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const broker = await ctx.db.get(args.brokerOrgId);
    if (!broker || broker.type !== "broker") throw new Error("Broker not found");
    const previous = broker.operatorStatus ?? "live";
    await ctx.db.patch(args.brokerOrgId, { operatorStatus: args.status });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "broker_status_changed",
      targetOrgId: args.brokerOrgId,
      summary: `${broker.name} changed from ${previous} to ${args.status}`,
      metadata: { previous, next: args.status },
    });
  },
});

export const setSoloClientStatus = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    status: brokerStatusValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.type !== "client") throw new Error("Client not found");
    const previous = client.operatorStatus ?? "live";
    await ctx.db.patch(args.clientOrgId, { operatorStatus: args.status });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "client_status_changed",
      targetOrgId: args.clientOrgId,
      summary: `${client.name} changed from ${previous} to ${args.status}`,
      metadata: { previous, next: args.status },
    });
  },
});

export const updateClientSettings = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    brokerOrgId: v.optional(v.id("organizations")),
    website: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.type !== "client") throw new Error("Client not found");

    const broker = args.brokerOrgId ? await ctx.db.get(args.brokerOrgId) : null;
    if (args.brokerOrgId && (!broker || broker.type !== "broker")) {
      throw new Error("Broker not found");
    }

    const agentHandle = normalizeHandle(args.agentHandle);
    validateAgentHandle(agentHandle);
    if (agentHandle) {
      const existingByHandle = await ctx.db
        .query("organizations")
        .withIndex("by_agentHandle", (q) => q.eq("agentHandle", agentHandle))
        .first();
      if (existingByHandle && existingByHandle._id !== args.clientOrgId) {
        throw new Error("Agent handle is already taken");
      }
    }

    const primaryContactEmail = normalizeOptionalContactEmail(args.primaryContactEmail);
    const admin = await getOrgAdmin(ctx, args.clientOrgId);
    const primaryContactPhone = await normalizeAvailableUserPhone(
      ctx,
      args.primaryContactPhone,
      admin?._id,
    );
    const patch = {
      brokerOrgId: args.brokerOrgId,
      website: args.website?.trim() || undefined,
      agentHandle,
      primaryContactName: args.primaryContactName?.trim() || undefined,
      primaryContactEmail,
      primaryContactPhone,
    };

    await ctx.db.patch(args.clientOrgId, patch);
    if (admin && normalizeOperatorEmail(admin.email) === primaryContactEmail) {
      await ctx.db.patch(admin._id, {
        name: patch.primaryContactName,
        phone: primaryContactPhone,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Updated client settings for ${client.name}`,
      metadata: {
        previousBrokerOrgId: client.brokerOrgId,
        nextBrokerOrgId: args.brokerOrgId,
        website: patch.website,
        agentHandle,
        primaryContactEmail,
      },
    });
  },
});

export const updateBrokerSettings = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    slug: v.optional(v.string()),
    website: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
    adminName: v.optional(v.string()),
    adminPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const broker = await ctx.db.get(args.brokerOrgId);
    if (!broker || broker.type !== "broker") throw new Error("Broker not found");

    const slug = args.slug ? normalizeSlug(args.slug) : undefined;
    if (slug) {
      if (slug.length < 3 || slug.length > 40) {
        throw new Error("Slug must be 3-40 characters");
      }
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
        throw new Error("Slug must start and end with a letter or number");
      }
      const existingBySlug = await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (existingBySlug && existingBySlug._id !== args.brokerOrgId) {
        throw new Error("Slug is already taken");
      }
    }

    const agentHandle = normalizeHandle(args.agentHandle);
    validateAgentHandle(agentHandle);
    if (agentHandle) {
      const existingByHandle = await ctx.db
        .query("organizations")
        .withIndex("by_agentHandle", (q) => q.eq("agentHandle", agentHandle))
        .first();
      if (existingByHandle && existingByHandle._id !== args.brokerOrgId) {
        throw new Error("Agent handle is already taken");
      }
    }

    const adminPhone = normalizeOptionalContactPhone(args.adminPhone);
    const admin = await getOrgAdmin(ctx, args.brokerOrgId);
    if (admin) {
      await ctx.db.patch(admin._id, {
        name: args.adminName?.trim() || undefined,
        phone: adminPhone,
      });
    }

    const patch = {
      slug,
      website: args.website?.trim() || undefined,
      agentHandle,
    };

    await ctx.db.patch(args.brokerOrgId, patch);
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.brokerOrgId,
      summary: `Updated broker settings for ${broker.name}`,
      metadata: {
        slug,
        website: patch.website,
        agentHandle,
        adminName: args.adminName?.trim() || undefined,
      },
    });
  },
});

export const setMGAStatus = mutation({
  args: {
    mgaOrgId: v.id("organizations"),
    status: brokerStatusValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const mga = await ctx.db.get(args.mgaOrgId);
    if (!mga || mga.type !== "partner" || mga.partnerKind !== "program_admin") {
      throw new Error("MGA not found");
    }
    const previous = mga.operatorStatus ?? "live";
    await ctx.db.patch(args.mgaOrgId, { operatorStatus: args.status });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "mga_status_changed",
      targetOrgId: args.mgaOrgId,
      summary: `${mga.name} changed from ${previous} to ${args.status}`,
      metadata: { previous, next: args.status },
    });
  },
});

export const launchBroker = action({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args): Promise<{ loginUrl: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, { userId });
    const launch: {
      brokerOrgId: Id<"organizations">;
      name: string;
      slug?: string;
      adminUserId?: Id<"users">;
      adminEmail?: string;
      adminName?: string;
    } | null = await ctx.runQuery(internalApi.operator.getBrokerLaunchContextInternal, args);
    if (!launch) throw new Error("Broker launch context not found");
    if (!launch.adminEmail) throw new Error("Broker has no admin email");

    const siteUrl = getAuthSiteUrl();
    const loginUrl: string = launch.slug
      ? `${siteUrl}/login/${launch.slug}?email=${encodeURIComponent(launch.adminEmail)}`
      : `${siteUrl}/login?email=${encodeURIComponent(launch.adminEmail)}`;
    const subject = `${launch.name} is ready on Glass`;
    const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    Your Glass workspace for <strong>${escapeHtml(launch.name)}</strong> is ready.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Open Glass</a>
</td></tr>
<tr><td style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Sign in with ${escapeHtml(launch.adminEmail)}. You can also copy this link:<br>
    <a href="${escapeHtml(loginUrl)}" style="color:#6b7280;word-break:break-all;">${escapeHtml(loginUrl)}</a>
  </p>
</td></tr>`;
    const html = buildEmailShell({ title: subject, bodyHtml, siteUrl });
    const text = `Your Glass workspace for ${launch.name} is ready.\n\nOpen Glass:\n${loginUrl}\n\nSign in with ${launch.adminEmail}.`;
    const result = await sendResendEmail(
      {
        from: getAuthFromAddress("Glass"),
        to: launch.adminName
          ? `${launch.adminName} <${launch.adminEmail}>`
          : launch.adminEmail,
        subject,
        html,
        text,
      },
      { retries: 2 },
    );
    if (!result.ok) throw new Error(`Failed to send launch email: ${result.error}`);
    await ctx.runMutation(internalApi.operator.markBrokerLaunchedInternal, {
      brokerOrgId: args.brokerOrgId,
      operatorUserId: userId,
      adminUserId: launch.adminUserId,
    });
    return { loginUrl };
  },
});

export const launchSoloClient = action({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args): Promise<{ loginUrl: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, { userId });
    const launch: {
      clientOrgId: Id<"organizations">;
      name: string;
      adminUserId?: Id<"users">;
      adminEmail?: string;
      adminName?: string;
    } | null = await ctx.runQuery(internalApi.operator.getSoloClientLaunchContextInternal, args);
    if (!launch) throw new Error("Client launch context not found");
    if (!launch.adminEmail) throw new Error("Client has no admin email");

    const siteUrl = getAuthSiteUrl();
    const loginUrl = `${siteUrl}/login?email=${encodeURIComponent(launch.adminEmail)}`;
    const subject = `${launch.name} is ready on Glass`;
    const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    Your Glass workspace for <strong>${escapeHtml(launch.name)}</strong> is ready.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Open Glass</a>
</td></tr>
<tr><td style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Sign in with ${escapeHtml(launch.adminEmail)}. You can also copy this link:<br>
    <a href="${escapeHtml(loginUrl)}" style="color:#6b7280;word-break:break-all;">${escapeHtml(loginUrl)}</a>
  </p>
</td></tr>`;
    const html = buildEmailShell({ title: subject, bodyHtml, siteUrl });
    const text = `Your Glass workspace for ${launch.name} is ready.\n\nOpen Glass:\n${loginUrl}\n\nSign in with ${launch.adminEmail}.`;
    const result = await sendResendEmail(
      {
        from: getAuthFromAddress("Glass"),
        to: launch.adminName
          ? `${launch.adminName} <${launch.adminEmail}>`
          : launch.adminEmail,
        subject,
        html,
        text,
      },
      { retries: 2 },
    );
    if (!result.ok) throw new Error(`Failed to send launch email: ${result.error}`);
    await ctx.runMutation(internalApi.operator.markSoloClientLaunchedInternal, {
      clientOrgId: args.clientOrgId,
      operatorUserId: userId,
      adminUserId: launch.adminUserId,
    });
    return { loginUrl };
  },
});

export const launchMGA = action({
  args: { mgaOrgId: v.id("organizations") },
  handler: async (ctx, args): Promise<{ loginUrl: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, { userId });
    const launch: {
      mgaOrgId: Id<"organizations">;
      name: string;
      adminUserId?: Id<"users">;
      adminEmail?: string;
      adminName?: string;
    } | null = await ctx.runQuery(internalApi.operator.getMGALaunchContextInternal, args);
    if (!launch) throw new Error("MGA launch context not found");
    if (!launch.adminEmail) throw new Error("MGA has no admin email");

    const siteUrl = getAuthSiteUrl();
    const loginUrl = `${siteUrl}/login?email=${encodeURIComponent(launch.adminEmail)}`;
    const subject = `${launch.name} is ready on Glass`;
    const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    Your Glass workspace for <strong>${escapeHtml(launch.name)}</strong> is ready.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Open Glass</a>
</td></tr>
<tr><td style="padding:20px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Sign in with ${escapeHtml(launch.adminEmail)}. You can also copy this link:<br>
    <a href="${escapeHtml(loginUrl)}" style="color:#6b7280;word-break:break-all;">${escapeHtml(loginUrl)}</a>
  </p>
</td></tr>`;
    const html = buildEmailShell({ title: subject, bodyHtml, siteUrl });
    const text = `Your Glass workspace for ${launch.name} is ready.\n\nOpen Glass:\n${loginUrl}\n\nSign in with ${launch.adminEmail}.`;
    const result = await sendResendEmail(
      {
        from: getAuthFromAddress("Glass"),
        to: launch.adminName
          ? `${launch.adminName} <${launch.adminEmail}>`
          : launch.adminEmail,
        subject,
        html,
        text,
      },
      { retries: 2 },
    );
    if (!result.ok) throw new Error(`Failed to send launch email: ${result.error}`);
    await ctx.runMutation(internalApi.operator.markMGALaunchedInternal, {
      mgaOrgId: args.mgaOrgId,
      operatorUserId: userId,
      adminUserId: launch.adminUserId,
    });
    return { loginUrl };
  },
});

export const startImpersonation = mutation({
  args: {
    targetOrgId: v.id("organizations"),
    targetRole: orgRoleValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const org = await ctx.db.get(args.targetOrgId);
    if (!org) throw new Error("Organization not found");
    const now = dayjs().valueOf();
    const active = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("by_operator_status", (q) =>
        q.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .collect();
    for (const session of active) {
      await ctx.db.patch(session._id, { status: "ended", endedAt: now });
    }
    const sessionId = await ctx.db.insert("operatorImpersonationSessions", {
      operatorUserId: operator.userId,
      targetOrgId: args.targetOrgId,
      targetRole: args.targetRole,
      status: "active",
      createdAt: now,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "impersonation_started",
      targetOrgId: args.targetOrgId,
      summary: `Started ${args.targetRole} impersonation for ${org.name}`,
    });
    return { sessionId };
  },
});

export const stopImpersonation = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const now = dayjs().valueOf();
    const active = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("by_operator_status", (q) =>
        q.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .collect();
    for (const session of active) {
      await ctx.db.patch(session._id, { status: "ended", endedAt: now });
      await writeOperatorAudit(ctx, {
        operatorUserId: operator.userId,
        type: "impersonation_stopped",
        targetOrgId: session.targetOrgId,
        summary: "Stopped operator impersonation",
      });
    }
  },
});

export const requireOperatorForUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.accountKind !== "operator") throw new Error("Operator access required");
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!profile || profile.status !== "active") throw new Error("Operator access required");
    return { userId: args.userId, profile };
  },
});

export const upsertBrokerInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    adminUserId: v.id("users"),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    adminPhone: v.optional(v.string()),
    broker: v.object({
      name: v.string(),
      slug: v.optional(v.string()),
      website: v.optional(v.string()),
      agentHandle: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await assertCustomerUser(ctx, args.adminUserId);
    const brokerName = args.broker.name.trim();
    if (!brokerName) throw new Error("Broker name is required");
    const slug = args.broker.slug ? normalizeSlug(args.broker.slug) : slugFromName(brokerName);
    if (slug.length < 3 || slug.length > 40) throw new Error("Slug must be 3-40 characters");
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
      throw new Error("Slug must start and end with a letter or number");
    }
    const existingBySlug = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existingBySlug && existingBySlug.type !== "broker") {
      throw new Error("Slug is already used by a non-broker org");
    }
    const agentHandle = normalizeHandle(args.broker.agentHandle);
    validateAgentHandle(agentHandle);
    if (agentHandle) {
      const existingByHandle = await ctx.db
        .query("organizations")
        .withIndex("by_agentHandle", (q) => q.eq("agentHandle", agentHandle))
        .first();
      if (existingByHandle && existingByHandle._id !== existingBySlug?._id) {
        throw new Error("Agent handle is already taken");
      }
    }
    const patch = {
      name: brokerName,
      type: "broker" as const,
      partnerType: "broker" as const,
      slug,
      website: args.broker.website?.trim() || undefined,
      agentHandle,
      primaryInsuranceContactId: args.adminUserId,
      onboardingComplete: true,
      operatorStatus: "onboarding" as const,
    };
    const brokerOrgId = existingBySlug?._id ?? await ctx.db.insert("organizations", patch);
    if (existingBySlug) await ctx.db.patch(brokerOrgId, patch);

    const existingAdminMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", brokerOrgId).eq("userId", args.adminUserId),
      )
      .first();
    if (!existingAdminMembership) {
      const otherMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", args.adminUserId))
        .first();
      if (otherMembership) throw new Error("Broker admin already belongs to another organization");
      await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: args.adminUserId,
        role: "admin",
      });
    }
    const adminUserPatch: {
      accountKind: "customer";
      email: string;
      name?: string;
      phone?: string;
      onboardingComplete: boolean;
    } = {
      accountKind: "customer",
      email: args.adminEmail,
      name: args.adminName?.trim() || undefined,
      onboardingComplete: true,
    };
    if (args.adminPhone !== undefined) {
      adminUserPatch.phone = await normalizeAvailableUserPhone(
        ctx,
        args.adminPhone,
        args.adminUserId,
      );
    }
    await ctx.db.patch(args.adminUserId, adminUserPatch);
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "broker_created",
      targetOrgId: brokerOrgId,
      targetUserId: args.adminUserId,
      summary: `Created or updated broker ${brokerName}`,
      metadata: { slug, adminEmail: args.adminEmail },
    });
    return { brokerOrgId };
  },
});

export const createSoloClientInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    adminUserId: v.id("users"),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    adminPhone: v.optional(v.string()),
    client: v.object({
      name: v.string(),
      brokerOrgId: v.optional(v.id("organizations")),
      website: v.optional(v.string()),
      agentHandle: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await assertCustomerUser(ctx, args.adminUserId);
    const clientName = args.client.name.trim();
    if (!clientName) throw new Error("Client name is required");
    const broker = args.client.brokerOrgId ? await ctx.db.get(args.client.brokerOrgId) : null;
    if (args.client.brokerOrgId && (!broker || broker.type !== "broker")) {
      throw new Error("Broker not found");
    }
    const agentHandle = normalizeHandle(args.client.agentHandle);
    validateAgentHandle(agentHandle);
    if (agentHandle) {
      const existingByHandle = await ctx.db
        .query("organizations")
        .withIndex("by_agentHandle", (q) => q.eq("agentHandle", agentHandle))
        .first();
      if (existingByHandle) throw new Error("Agent handle is already taken");
    }
    const otherMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", args.adminUserId))
      .first();
    if (otherMembership) throw new Error("Client admin already belongs to another organization");

    const adminPhone = await normalizeAvailableUserPhone(
      ctx,
      args.adminPhone,
      args.adminUserId,
    );
    const clientOrgId = await ctx.db.insert("organizations", {
      name: clientName,
      type: "client",
      brokerOrgId: args.client.brokerOrgId,
      website: args.client.website?.trim() || undefined,
      agentHandle,
      allowedEmails: [args.adminEmail],
      emailVerification: "strict",
      primaryContactName: args.adminName?.trim() || undefined,
      primaryContactEmail: args.adminEmail,
      primaryContactPhone: adminPhone,
      onboardingComplete: true,
      operatorStatus: "onboarding",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: args.adminUserId,
      role: "admin",
    });
    const adminUserPatch: {
      accountKind: "customer";
      email: string;
      name?: string;
      phone?: string;
      onboardingComplete: boolean;
    } = {
      accountKind: "customer",
      email: args.adminEmail,
      name: args.adminName?.trim() || undefined,
      onboardingComplete: true,
    };
    if (args.adminPhone !== undefined) {
      adminUserPatch.phone = adminPhone;
    }
    await ctx.db.patch(args.adminUserId, adminUserPatch);
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "client_created",
      targetOrgId: clientOrgId,
      targetUserId: args.adminUserId,
      summary: broker
        ? `Created client ${clientName} for broker ${broker.name}`
        : `Created standalone client ${clientName}`,
      metadata: { adminEmail: args.adminEmail, brokerOrgId: args.client.brokerOrgId },
    });
    return { clientOrgId };
  },
});

export const createMGAInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    adminUserId: v.id("users"),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    mga: v.object({
      name: v.string(),
      website: v.optional(v.string()),
      programName: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await assertCustomerUser(ctx, args.adminUserId);
    const mgaName = args.mga.name.trim();
    if (!mgaName) throw new Error("MGA name is required");
    const otherMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", args.adminUserId))
      .first();
    if (otherMembership) throw new Error("MGA admin already belongs to another organization");

    const mgaOrgId = await ctx.db.insert("organizations", {
      name: mgaName,
      type: "partner",
      partnerKind: "program_admin",
      website: args.mga.website?.trim() || undefined,
      allowedEmails: [args.adminEmail],
      emailVerification: "strict",
      onboardingComplete: true,
      operatorStatus: "onboarding",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: mgaOrgId,
      userId: args.adminUserId,
      role: "admin",
    });
    await ctx.db.patch(args.adminUserId, {
      accountKind: "customer",
      email: args.adminEmail,
      name: args.adminName?.trim() || undefined,
      onboardingComplete: true,
    });
    await ctx.db.insert("partnerPrograms", {
      partnerOrgId: mgaOrgId,
      name: args.mga.programName?.trim() || mgaName,
      aliases: [],
      status: "active",
      createdAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "mga_created",
      targetOrgId: mgaOrgId,
      targetUserId: args.adminUserId,
      summary: `Created MGA ${mgaName}`,
      metadata: { adminEmail: args.adminEmail },
    });
    return { mgaOrgId };
  },
});

export const getBrokerLaunchContextInternal = internalQuery({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const broker = await ctx.db.get(args.brokerOrgId);
    if (!broker || broker.type !== "broker") return null;
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.brokerOrgId))
      .collect();
    const adminMembership = memberships.find((membership) => membership.role === "admin");
    const admin = adminMembership ? await ctx.db.get(adminMembership.userId) : null;
    return {
      brokerOrgId: broker._id,
      name: broker.name,
      slug: broker.slug,
      adminUserId: admin?._id,
      adminEmail: admin?.email,
      adminName: admin?.name,
    };
  },
});

export const getSoloClientLaunchContextInternal = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.type !== "client") return null;
    const admin = await getOrgAdmin(ctx, args.clientOrgId);
    return {
      clientOrgId: client._id,
      name: client.name,
      adminUserId: admin?._id,
      adminEmail: admin?.email ?? client.primaryContactEmail,
      adminName: admin?.name ?? client.primaryContactName,
    };
  },
});

export const getMGALaunchContextInternal = internalQuery({
  args: { mgaOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const mga = await ctx.db.get(args.mgaOrgId);
    if (!mga || mga.type !== "partner" || mga.partnerKind !== "program_admin") return null;
    const admin = await getOrgAdmin(ctx, args.mgaOrgId);
    return {
      mgaOrgId: mga._id,
      name: mga.name,
      adminUserId: admin?._id,
      adminEmail: admin?.email,
      adminName: admin?.name,
    };
  },
});

export const markBrokerLaunchedInternal = internalMutation({
  args: {
    brokerOrgId: v.id("organizations"),
    operatorUserId: v.id("users"),
    adminUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const broker = await ctx.db.get(args.brokerOrgId);
    if (!broker || broker.type !== "broker") throw new Error("Broker not found");
    await ctx.db.patch(args.brokerOrgId, { operatorStatus: "live", onboardingComplete: true });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "broker_launch_email_sent",
      targetOrgId: args.brokerOrgId,
      targetUserId: args.adminUserId,
      summary: `Launched ${broker.name} and sent broker login email`,
    });
  },
});

export const markSoloClientLaunchedInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    operatorUserId: v.id("users"),
    adminUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.type !== "client") throw new Error("Client not found");
    await ctx.db.patch(args.clientOrgId, { operatorStatus: "live", onboardingComplete: true });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "client_launch_email_sent",
      targetOrgId: args.clientOrgId,
      targetUserId: args.adminUserId,
      summary: `Launched ${client.name} and sent client login email`,
    });
  },
});

export const markMGALaunchedInternal = internalMutation({
  args: {
    mgaOrgId: v.id("organizations"),
    operatorUserId: v.id("users"),
    adminUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const mga = await ctx.db.get(args.mgaOrgId);
    if (!mga || mga.type !== "partner" || mga.partnerKind !== "program_admin") {
      throw new Error("MGA not found");
    }
    await ctx.db.patch(args.mgaOrgId, { operatorStatus: "live", onboardingComplete: true });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "mga_launch_email_sent",
      targetOrgId: args.mgaOrgId,
      targetUserId: args.adminUserId,
      summary: `Launched ${mga.name} and sent MGA login email`,
    });
  },
});
