import dayjs from "dayjs";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getCurrentOrgAccess } from "./lib/access";
import { createProcurementInboxToken } from "./lib/procurement";
import { assemblePacketMarkdown, audienceIncludes } from "./lib/procurementPacket";

async function createUniqueInboxToken(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inboxToken = createProcurementInboxToken();
    const existing = await ctx.db
      .query("procurementRequests")
      .withIndex("inbox", (index) => index.eq("inboxToken", inboxToken))
      .first();
    if (!existing) return inboxToken;
  }
  throw new Error("Could not create a unique procurement forwarding address");
}

function optionalEffectiveDate(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    !dayjs(normalized).isValid() ||
    dayjs(normalized).format("YYYY-MM-DD") !== normalized
  ) {
    throw new Error("Effective date must use YYYY-MM-DD");
  }
  return normalized;
}

function clientStatus(status: Doc<"procurementRequests">["status"]) {
  if (status === "draft" || status === "submitted") return "submitted" as const;
  if (status === "gathering_information") return "information_needed" as const;
  if (
    [
      "marketing",
      "proposal_review",
      "quote_review",
      "client_decision",
    ].includes(status)
  )
    return "in_progress" as const;
  if (["binding", "accepted"].includes(status)) return "finalizing" as const;
  if (["completed", "closed"].includes(status)) return "completed" as const;
  return "cancelled" as const;
}

type Ctx = QueryCtx | MutationCtx;

async function requireClientMembership(ctx: Ctx) {
  const access = await getCurrentOrgAccess(ctx);
  if (!access || access.orgType !== "client")
    throw new Error("Client membership required");
  return access;
}

async function requireVisibleRequest(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
) {
  const access = await requireClientMembership(ctx);
  const request = await ctx.db.get(requestId);
  const packetSections = request
    ? await ctx.db.query("procurementPacketSections").withIndex("request", (q) => q.eq("requestId", request._id)).collect()
    : [];
  if (
    !request ||
    request.clientOrgId !== access.orgId ||
    (!request.clientVisible && !packetSections.some((section) => audienceIncludes(section.audience, "client")))
  )
    throw new Error("Request not found");
  return { access, request };
}

async function requestDto(ctx: QueryCtx, request: Doc<"procurementRequests">) {
  const [joins, specifications, activities, documents, resultingPolicy, packetSections] =
    await Promise.all([
      ctx.db
        .query("procurementRequestRequirements")
        .withIndex("request", (q) => q.eq("requestId", request._id))
        .collect(),
      ctx.db
        .query("procurementSpecifications")
        .withIndex("request", (q) => q.eq("requestId", request._id))
        .collect(),
      ctx.db
        .query("procurementRequestActivities")
        .withIndex("client_visible", (q) =>
          q.eq("requestId", request._id).eq("clientVisible", true),
        )
        .collect(),
      ctx.db
        .query("procurementRequestDocuments")
        .withIndex("client_visible", (q) =>
          q.eq("requestId", request._id).eq("clientVisible", true),
        )
        .collect(),
      request.resultingPolicyId ? ctx.db.get(request.resultingPolicyId) : null,
      ctx.db.query("procurementPacketSections").withIndex("request", (q) => q.eq("requestId", request._id)).collect(),
    ]);
  const requirements = (
    await Promise.all(joins.map((join) => ctx.db.get(join.requirementId)))
  )
    .filter((requirement): requirement is Doc<"insuranceRequirements"> =>
      Boolean(requirement && requirement.status === "active"),
    )
    .map((requirement) => ({
      _id: requirement._id,
      title: requirement.title,
      requirementText: requirement.requirementText,
      lineOfBusiness: requirement.lineOfBusiness,
      limits: requirement.limits,
      maxDeductible: requirement.maxDeductible,
      coverageForm: requirement.coverageForm,
      provisions: requirement.provisions,
      requiredForms: requirement.requiredForms,
    }));
  const files = await Promise.all(
    documents.map(async (document) => ({
      _id: document._id,
      name: document.name,
      contentType: document.contentType,
      size: document.size,
      uploadedBySide: document.uploadedBySide,
      createdAt: document.createdAt,
      url: await ctx.storage.getUrl(document.fileId),
    })),
  );
  const filesById = new Map(files.map((file) => [String(file._id), file]));
  return {
    _id: request._id,
    title: request.title,
    narrative: request.originalNarrative ?? request.requestSummary,
    packet: {
      markdown: assemblePacketMarkdown(packetSections, { audience: "client" }),
      sections: packetSections.filter((section) => audienceIncludes(section.audience, "client")).sort((a, b) => a.order - b.order),
    },
    status: clientStatus(request.status),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    targetEffectiveDate: request.targetEffectiveDate,
    requirements,
    specifications: specifications.map((item) => ({
      _id: item._id,
      key: item.key,
      label: item.label,
      value: item.value,
    })),
    resultingPolicy:
      resultingPolicy && !resultingPolicy.deletedAt
        ? {
            _id: resultingPolicy._id,
            carrier: resultingPolicy.carrier,
            policyNumber: resultingPolicy.policyNumber,
          }
        : undefined,
    activity: activities.map((item) => {
      const file = item.documentId
        ? filesById.get(String(item.documentId))
        : undefined;
      return {
        _id: item._id,
        kind: item.kind,
        body: item.body,
        authorSide: item.authorSide,
        documentId: item.documentId,
        fileName: file?.name,
        fileUrl: file?.url,
        createdAt: item.createdAt,
      };
    }),
    files,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireClientMembership(ctx);
    const rows = await ctx.db
      .query("procurementRequests")
      .withIndex("organization", (q) => q.eq("clientOrgId", access.orgId))
      .order("desc")
      .collect();
    return await Promise.all(
      rows
        .filter((row) => row.clientVisible)
        .map((row) => requestDto(ctx, row)),
    );
  },
});

export const get = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) =>
    requestDto(ctx, (await requireVisibleRequest(ctx, args.requestId)).request),
});

export const create = mutation({
  args: {
    title: v.string(),
    narrative: v.string(),
    targetEffectiveDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireClientMembership(ctx);
    const title = args.title.trim();
    const narrative = args.narrative.trim();
    if (!title || !narrative)
      throw new Error("Title and narrative are required");
    const now = dayjs().valueOf();
    const requestId = await ctx.db.insert("procurementRequests", {
      clientOrgId: access.orgId,
      title: title.slice(0, 200),
      requestSummary: narrative,
      requirements: narrative,
      originalNarrative: narrative,
      targetEffectiveDate: optionalEffectiveDate(args.targetEffectiveDate),
      status: "submitted",
      createdBySide: "client",
      clientVisible: true,
      sharedAt: now,
      requirementRevision: 0,
      specificationRevision: 0,
      inboxToken: await createUniqueInboxToken(ctx),
      createdByUserId: access.userId,
      updatedByUserId: access.userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("procurementRequestActivities", {
      requestId,
      clientOrgId: access.orgId,
      authorUserId: access.userId,
      authorSide: "client",
      kind: "message",
      body: narrative,
      clientVisible: true,
      createdAt: now,
    });
    return { requestId };
  },
});

export const postMessage = mutation({
  args: { requestId: v.id("procurementRequests"), body: v.string() },
  handler: async (ctx, args) => {
    const { access, request } = await requireVisibleRequest(
      ctx,
      args.requestId,
    );
    const body = args.body.trim();
    if (!body) throw new Error("Message is required");
    const createdAt = dayjs().valueOf();
    return await ctx.db.insert("procurementRequestActivities", {
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      authorUserId: access.userId,
      authorSide: "client",
      kind: "message",
      body,
      clientVisible: true,
      createdAt,
    });
  },
});

export const generateUploadUrl = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    await requireVisibleRequest(ctx, args.requestId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachFile = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const { access, request } = await requireVisibleRequest(
      ctx,
      args.requestId,
    );
    if (!(await ctx.storage.getMetadata(args.storageId)))
      throw new Error("Uploaded file not found");
    const createdAt = dayjs().valueOf();
    const documentId = await ctx.db.insert("procurementRequestDocuments", {
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      fileId: args.storageId,
      name: args.fileName.trim() || "Document",
      contentType: args.contentType,
      size: args.size,
      clientVisible: true,
      uploadedByUserId: access.userId,
      uploadedBySide: "client",
      createdAt,
    });
    await ctx.db.insert("procurementRequestActivities", {
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      authorUserId: access.userId,
      authorSide: "client",
      kind: "document",
      documentId,
      clientVisible: true,
      createdAt,
    });
    return { documentId };
  },
});
