import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { getOrgAccess } from "./lib/orgAuth";
import { Id } from "./_generated/dataModel";
import { recordBrokerActivity } from "./lib/brokerActivity";
import { notify } from "./lib/notify";

/** List uploaded org-context documents for the viewer's org. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const docs = await ctx.db
      .query("orgDocuments")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", access.orgId))
      .collect();
    return docs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Create a document row immediately after upload. */
export const create = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) throw new Error("No organization");
    const now = Date.now();
    const docId = await ctx.db.insert("orgDocuments", {
      orgId: access.orgId,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      size: args.size,
      extractionStatus: "pending",
      uploadedBy: access.userId,
      createdAt: now,
      updatedAt: now,
    });

    // Emit broker activity event if this org has a broker
    const org = await ctx.db.get(access.orgId);
    if (org && (org as { brokerOrgId?: Id<"organizations"> }).brokerOrgId) {
      const brokerOrgId = (org as { brokerOrgId: Id<"organizations"> }).brokerOrgId;
      await recordBrokerActivity(ctx, {
        brokerOrgId,
        clientOrgId: access.orgId,
        type: "document_uploaded",
        actorSide: "client",
        actorUserId: access.userId,
        summary: `Document "${args.fileName}" uploaded.`,
        payload: { orgDocumentId: docId, fileName: args.fileName },
      });
      // Notify broker of client document upload
      await notify(ctx, {
        orgId: brokerOrgId,
        type: "client_document_uploaded",
        title: "Client uploaded a document",
        body: `${org.name ?? "Your client"} uploaded a new document.`,
        relatedOrgId: access.orgId,
        actionType: "view_policy",
        actionPayload: { policyId: docId },
        coalesceKeyParts: ["client_document_uploaded", brokerOrgId, access.orgId],
      });
    }

    return docId;
  },
});

/** Delete a document, its blob, and related intelligence entries. */
export const remove = mutation({
  args: { id: v.id("orgDocuments") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) throw new Error("No organization");
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== access.orgId) throw new Error("Not found");

    // Cascade delete intelligence entries with matching sourceRef
    const entries = await ctx.db
      .query("orgIntelligence")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", access.orgId))
      .collect();
    for (const e of entries) {
      if (e.source === "manual" && e.sourceRef === doc.storageId) {
        await ctx.db.delete(e._id);
      }
    }

    await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(args.id);
  },
});

/** Internal: update status/metadata during the extraction lifecycle. */
export const updateStatus = internalMutation({
  args: {
    id: v.id("orgDocuments"),
    orgId: v.id("organizations"),
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("complete"),
      v.literal("error"),
    ),
    extractionError: v.optional(v.string()),
    entryCount: v.optional(v.number()),
    sourceLabel: v.optional(v.string()),
    documentType: v.optional(v.string()),
    asOfDate: v.optional(v.string()),
    documentDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, orgId, ...rest } = args;
    // Defense in depth: internal mutations bypass auth, so require the caller's orgId and verify it.
    const doc = await ctx.db.get(id);
    if (!doc || doc.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { ...rest, updatedAt: Date.now() });
  },
});

/** Internal: validate that a document id belongs to an org before mutating it from actions. */
export const belongsToOrg = internalQuery({
  args: {
    id: v.id("orgDocuments"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    return !!doc && doc.orgId === args.orgId;
  },
});

/** Internal: find existing doc by storageId (used during migration / extraction entry points). */
export const findByStorageId = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("orgDocuments")
      .withIndex("by_storageId", (idx) => idx.eq("storageId", args.storageId))
      .unique();
    return doc?._id ?? null;
  },
});

export type OrgDocumentId = Id<"orgDocuments">;
