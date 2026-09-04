import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getClientPortalUrl } from "./lib/domains";
import {
  createMagicLinkToken,
  hashMagicLinkToken,
} from "./lib/magicLinkTokens";
import {
  requireOperator,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import { requireDirectOperatorWrite } from "./procurementRequests";
import { readOrgWiki } from "./orgWiki";
import {
  PACKET_SECTIONS,
  assemblePacketMarkdown,
  composeRequestMarkdown,
  defaultPacketSection,
  audienceIncludes,
  type PacketAudience,
} from "./lib/procurementPacket";

const audienceValidator = v.union(
  v.literal("operator"),
  v.literal("client"),
  v.literal("broker"),
);
const PACKET_LINK_TTL_DAYS = 30;

async function requestForOperator(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Procurement request not found");
  return request;
}

async function directOperator(ctx: MutationCtx, userId: Id<"users">) {
  await requireOperatorForUser(ctx, userId);
  await requireDirectOperatorWrite(ctx, userId);
}

export async function upsertPacketSectionByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    key: string;
    body: string;
    heading?: string;
    audience?: PacketAudience;
    source?: Doc<"procurementPacketSections">["source"];
    sourceRefs?: string[];
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const request = await requestForOperator(ctx, args.requestId);
  const now = dayjs().valueOf();
  const canonical = defaultPacketSection(args.key);
  const existing = await ctx.db
    .query("procurementPacketSections")
    .withIndex("request_key", (q) =>
      q.eq("requestId", request._id).eq("key", args.key),
    )
    .first();
  const audience =
    args.audience ?? existing?.audience ?? canonical.defaultAudience;
  if (canonical.sensitive && audience !== "operator")
    throw new Error("Sensitive packet sections require operator visibility");
  const values = {
    requestId: request._id,
    clientOrgId: request.clientOrgId,
    key: args.key,
    heading: args.heading?.trim() || existing?.heading || canonical.heading,
    body: args.body.trim(),
    order:
      existing?.order ?? PACKET_SECTIONS.findIndex(([key]) => key === args.key),
    audience,
    source: args.source ?? existing?.source ?? "manual",
    sourceRefs: args.sourceRefs ?? existing?.sourceRefs,
    manuallyEditedAt: now,
    createdByUserId: existing?.createdByUserId ?? args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const id =
    existing?._id ?? (await ctx.db.insert("procurementPacketSections", values));
  if (existing) await ctx.db.patch(existing._id, values);
  if (audience !== "operator")
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedAt: now,
      updatedByUserId: args.operatorUserId,
    });
  return { id };
}

export async function setPacketSectionAudienceByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    sectionId: Id<"procurementPacketSections">;
    audience: PacketAudience;
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const section = await ctx.db.get(args.sectionId);
  if (!section) throw new Error("Packet section not found");
  const canonical = defaultPacketSection(section.key);
  if (canonical.sensitive && args.audience !== "operator")
    throw new Error("Sensitive packet sections cannot be widened");
  if (
    args.audience === "operator" ||
    audienceIncludes(args.audience, section.audience)
  ) {
    const now = dayjs().valueOf();
    await ctx.db.patch(section._id, {
      audience: args.audience,
      audienceProposed: undefined,
      updatedByUserId: args.operatorUserId,
      updatedAt: now,
    });
    const request = await ctx.db.get(section.requestId);
    if (request && args.audience !== "operator")
      await ctx.db.patch(request._id, {
        packetRevision: (request.packetRevision ?? 0) + 1,
        updatedAt: now,
        updatedByUserId: args.operatorUserId,
      });
  }
  return { ok: true };
}

/** The client wiki composes in on read rather than being copied into the
 * packet, so a new request starts with the client's durable background and
 * later wiki edits reach requests already open. Operator audience only: the
 * client and broker projections stay the packet alone. */
export async function listPacketSections(
  ctx: QueryCtx | MutationCtx,
  args: { requestId: Id<"procurementRequests">; audience?: PacketAudience },
) {
  const request = await requestForOperator(ctx, args.requestId);
  const sections = await ctx.db
    .query("procurementPacketSections")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .collect();
  const audience = args.audience ?? "operator";
  const wiki =
    audience === "operator"
      ? await readOrgWiki(ctx, request.clientOrgId)
      : null;
  return {
    requestId: request._id,
    packetRevision: request.packetRevision ?? 0,
    sections: sections
      .filter(
        (section) =>
          audience === "operator" ||
          audienceIncludes(section.audience, audience),
      )
      .sort((a, b) => a.order - b.order),
    clientWiki: wiki
      ? { orgId: wiki.orgId, sections: wiki.sections, markdown: wiki.markdown }
      : null,
    markdown: composeRequestMarkdown({
      wikiMarkdown: wiki?.markdown ?? "",
      packetMarkdown: assemblePacketMarkdown(sections, { audience }),
    }),
    gaps: PACKET_SECTIONS.filter(
      ([key]) =>
        !sections.some((section) => section.key === key && section.body.trim()),
    ).map(([key, heading]) => ({ key, heading })),
  };
}

export const get = query({
  args: {
    requestId: v.id("procurementRequests"),
    audience: v.optional(audienceValidator),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await listPacketSections(ctx, args);
  },
});

/** Apply source-backed machine updates without silently changing a human edit
 * or the projection already visible to a recipient. */
export const applyAgentUpdateInternal = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    sourceFingerprint: v.string(),
    sections: v.array(
      v.object({
        key: v.string(),
        body: v.string(),
        audienceProposed: v.optional(
          v.union(v.literal("client"), v.literal("broker")),
        ),
        rationale: v.optional(v.string()),
        sourceRefs: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const request = await requestForOperator(ctx, args.requestId);
    const now = dayjs().valueOf();
    let changed = false;
    for (const update of args.sections) {
      const canonical = defaultPacketSection(update.key);
      if (canonical.sensitive && update.audienceProposed) continue;
      const existing = await ctx.db
        .query("procurementPacketSections")
        .withIndex("request_key", (q) =>
          q.eq("requestId", request._id).eq("key", update.key),
        )
        .first();
      if (existing?.manuallyEditedAt) continue;
      const priorRefs = new Set(existing?.sourceRefs ?? []);
      if (update.sourceRefs.some((ref) => priorRefs.has(ref))) continue;
      const sourceRefs = [...priorRefs, ...update.sourceRefs].slice(-50);
      if (!existing) {
        await ctx.db.insert("procurementPacketSections", {
          requestId: request._id,
          clientOrgId: request.clientOrgId,
          key: update.key,
          heading: canonical.heading,
          body: update.body.trim(),
          order: PACKET_SECTIONS.findIndex(([key]) => key === update.key),
          audience: "operator",
          audienceProposed: update.audienceProposed,
          source: "email",
          sourceRefs,
          proposedRationale: update.rationale,
          createdByUserId: request.updatedByUserId,
          updatedByUserId: request.updatedByUserId,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      } else {
        const patch: Record<string, unknown> = { sourceRefs, updatedAt: now };
        if (existing.audience === "operator") patch.body = update.body.trim();
        else patch.proposedBody = update.body.trim();
        if (update.audienceProposed)
          patch.audienceProposed = update.audienceProposed;
        if (update.rationale) patch.proposedRationale = update.rationale;
        await ctx.db.patch(existing._id, patch);
        changed = true;
      }
    }
    if (changed) {
      const run = await ctx.db
        .query("procurementPacketUpdateRuns")
        .withIndex("request", (q) => q.eq("requestId", request._id))
        .order("desc")
        .first();
      if (!run || run.sourceFingerprint !== args.sourceFingerprint)
        await ctx.db.insert("procurementPacketUpdateRuns", {
          requestId: request._id,
          sourceFingerprint: args.sourceFingerprint,
          status: "complete",
          attempts: 1,
          updatedAt: now,
        });
    }
    return { changed };
  },
});

export const acceptProposal = mutation({
  args: { sectionId: v.id("procurementPacketSections") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await directOperator(ctx, operator.userId);
    const section = await ctx.db.get(args.sectionId);
    if (!section || (!section.proposedBody && !section.audienceProposed))
      throw new Error("No packet proposal pending");
    const now = dayjs().valueOf();
    const nextAudience = section.audienceProposed ?? section.audience;
    await ctx.db.patch(section._id, {
      body: section.proposedBody ?? section.body,
      audience: nextAudience,
      proposedBody: undefined,
      audienceProposed: undefined,
      proposedRationale: undefined,
      updatedAt: now,
      updatedByUserId: operator.userId,
    });
    const request = await ctx.db.get(section.requestId);
    if (request && nextAudience !== "operator")
      await ctx.db.patch(request._id, {
        packetRevision: (request.packetRevision ?? 0) + 1,
        updatedAt: now,
        updatedByUserId: operator.userId,
      });
    return { ok: true };
  },
});

export const rejectProposal = mutation({
  args: { sectionId: v.id("procurementPacketSections") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await directOperator(ctx, operator.userId);
    const section = await ctx.db.get(args.sectionId);
    if (!section) throw new Error("Packet section not found");
    await ctx.db.patch(section._id, {
      proposedBody: undefined,
      audienceProposed: undefined,
      proposedRationale: undefined,
      updatedAt: dayjs().valueOf(),
      updatedByUserId: operator.userId,
    });
    return { ok: true };
  },
});

export async function mintPacketLinkForOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    outreachId: Id<"procurementBrokerOutreaches">;
    recipientLabel: string;
    recipientEmail?: string;
    expiresAt?: number;
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const request = await requestForOperator(ctx, args.requestId);
  const outreach = await ctx.db.get(args.outreachId);
  if (!outreach || outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this request");
  const now = dayjs().valueOf();
  const token = createMagicLinkToken();
  const expiresAt =
    args.expiresAt && args.expiresAt > now
      ? args.expiresAt
      : dayjs(now).add(PACKET_LINK_TTL_DAYS, "day").valueOf();
  const id = await ctx.db.insert("procurementPacketLinks", {
    requestId: request._id,
    clientOrgId: request.clientOrgId,
    outreachId: outreach._id,
    tokenHash: await hashMagicLinkToken(token),
    recipientLabel: args.recipientLabel.trim(),
    recipientEmail: args.recipientEmail?.trim().toLowerCase(),
    expiresAt,
    packetRevisionAtIssue: request.packetRevision ?? 0,
    viewCount: 0,
    createdByUserId: args.operatorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(outreach._id, {
    packetRevisionAtIssue: request.packetRevision ?? 0,
    updatedAt: now,
    updatedByUserId: args.operatorUserId,
  });
  return {
    id,
    token,
    url: `${getClientPortalUrl()}/share/packet/${token}`,
    expiresAt,
  };
}

export const mintLinkInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    requestId: v.id("procurementRequests"),
    outreachId: v.id("procurementBrokerOutreaches"),
    recipientLabel: v.string(),
    recipientEmail: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => mintPacketLinkForOperator(ctx, args),
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) return null;
    const hash = await hashMagicLinkToken(token);
    const link = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("token", (q) => q.eq("tokenHash", hash))
      .unique();
    const now = dayjs().valueOf();
    if (!link || link.revokedAt || link.expiresAt <= now) return null;
    const request = await ctx.db.get(link.requestId);
    const outreach = await ctx.db.get(link.outreachId);
    if (!request || !outreach || outreach.requestId !== request._id)
      return null;
    const sections = await ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect();
    const visible = sections
      .filter((section) => audienceIncludes(section.audience, "broker"))
      .sort((a, b) => a.order - b.order);
    const fileItems = await ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect();
    const files = fileItems
      .filter(
        (item) =>
          item.brokerRelease === "listed" || item.brokerRelease === "attached",
      )
      .map((item) => ({
        _id: item._id,
        name: item.label,
        brokerRelease: item.brokerRelease as "listed" | "attached",
      }));
    return {
      state: "ready" as const,
      linkId: link._id,
      requestId: request._id,
      recipientLabel: link.recipientLabel,
      expiresAt: link.expiresAt,
      packetRevisionAtIssue: link.packetRevisionAtIssue,
      sections: visible,
      markdown: assemblePacketMarkdown(visible, { audience: "broker" }),
      files,
    };
  },
});

export const getFileByTokenInternal = internalQuery({
  args: { token: v.string(), item: v.string() },
  handler: async (ctx, args) => {
    const hash = await hashMagicLinkToken(args.token.trim());
    const link = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("token", (q) => q.eq("tokenHash", hash))
      .unique();
    const now = dayjs().valueOf();
    if (!link || link.revokedAt || link.expiresAt <= now) return null;
    const itemId = ctx.db.normalizeId("procurementFileItems", args.item);
    if (!itemId) return null;
    const item = await ctx.db.get(itemId);
    if (
      !item ||
      item.requestId !== link.requestId ||
      item.brokerRelease !== "attached" ||
      !item.clientFileId
    )
      return null;
    const file = await ctx.db.get(item.clientFileId);
    if (!file || file.deletedAt || file.archivedAt) return null;
    return {
      fileId: file.fileId,
      contentType: file.contentType,
      name: file.name,
    };
  },
});

export const recordView = mutation({
  args: {
    linkId: v.id("procurementPacketLinks"),
    path: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => recordViewInternalHandler(ctx, args),
});

async function recordViewInternalHandler(
  ctx: MutationCtx,
  args: {
    linkId: Id<"procurementPacketLinks">;
    path: string;
    userAgent?: string;
  },
) {
  const link = await ctx.db.get(args.linkId);
  if (!link || link.revokedAt || link.expiresAt <= dayjs().valueOf())
    return { ok: false };
  const now = dayjs().valueOf();
  await ctx.db.insert("procurementPacketViews", {
    linkId: link._id,
    requestId: link.requestId,
    at: now,
    path: args.path,
    userAgent: args.userAgent,
  });
  await ctx.db.patch(link._id, {
    lastViewedAt: now,
    viewCount: link.viewCount + 1,
    updatedAt: now,
  });
  return { ok: true };
}

export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = dayjs().valueOf();
    const links = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("expiration")
      .collect();
    let count = 0;
    for (const link of links)
      if (!link.revokedAt && link.expiresAt <= now) {
        await ctx.db.patch(link._id, { revokedAt: now, updatedAt: now });
        count += 1;
      }
    return { count };
  },
});
