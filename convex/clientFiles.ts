import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import {
  normalizeAgentAttachmentContentType,
  normalizeAgentAttachmentFilename,
} from "./lib/agentAttachmentLimits";
import { getOrgAccessForQuery, type OrgAccess } from "./lib/access";
import {
  boundedClientFileHint,
  buildClientFileName,
} from "./lib/clientFileNames";
import {
  assertNoOperatorImpersonation,
  requireClientOrganization,
  requireDirectOperatorClientWrite,
  requirePolicyForClient,
  updateClientFileByOperator,
} from "./lib/clientFiles";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";

const CLIENT_FILE_UPLOAD_TTL_MS = 30 * 60 * 1_000;
const MAX_CLIENT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CLIENT_FILES_PER_PAGE = 250;

function mayReadClientFile(access: OrgAccess, file: Doc<"clientFiles">) {
  if (access.accessType === "operator") return true;
  if (
    access.accessType !== "member" &&
    access.accessType !== "broker_of_client"
  ) {
    return false;
  }
  return file.clientVisible;
}

function policyLabel(policy: Doc<"policies"> | null) {
  if (!policy) return null;
  return (
    [policy.carrier, policy.policyNumber]
      .map((value) => value?.trim())
      .filter((value) => value && value !== "Extracting...")
      .join(" · ") ||
    policy.fileName?.trim() ||
    "Policy"
  );
}

async function clientFileRow(ctx: QueryCtx, file: Doc<"clientFiles">) {
  const policy = file.policyId ? await ctx.db.get(file.policyId) : null;
  return {
    _id: file._id,
    orgId: file.orgId,
    name: file.name,
    originalName: file.originalName,
    contentType: file.contentType,
    size: file.size,
    clientVisible: file.clientVisible,
    policyId: file.policyId,
    policyLabel: policyLabel(policy),
    uploadedBySide: file.uploadedBySide,
    nameSource: file.nameSource,
    nameStatus: file.nameStatus,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    url: await ctx.storage.getUrl(file.fileId),
  };
}

export const list = query({
  args: {
    clientOrgId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccessForQuery(ctx, args.clientOrgId, {
      allowOperator: true,
    });
    if (!access || access.orgType !== "client") {
      return { files: [], truncated: false, canManage: false };
    }
    const limit = Math.max(
      1,
      Math.min(args.limit ?? 200, MAX_CLIENT_FILES_PER_PAGE),
    );
    const canManage = access.accessType === "operator";
    const rows = canManage
      ? await ctx.db
          .query("clientFiles")
          .withIndex("organization", (index) =>
            index.eq("orgId", args.clientOrgId),
          )
          .order("desc")
          .take(limit + 1)
      : await ctx.db
          .query("clientFiles")
          .withIndex("visibility", (index) =>
            index.eq("orgId", args.clientOrgId).eq("clientVisible", true),
          )
          .order("desc")
          .take(limit + 1);
    const visibleRows = rows
      .slice(0, limit)
      .filter((file) => mayReadClientFile(access, file));
    return {
      files: await Promise.all(
        visibleRows.map((file) => clientFileRow(ctx, file)),
      ),
      truncated: rows.length > limit,
      canManage,
    };
  },
});

export const getUrl = query({
  args: { clientFileId: v.id("clientFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.clientFileId);
    if (!file) return null;
    const access = await getOrgAccessForQuery(ctx, file.orgId, {
      allowOperator: true,
    });
    if (!access || !mayReadClientFile(access, file)) return null;
    return await ctx.storage.getUrl(file.fileId);
  },
});

export const listVisibleInternal = internalQuery({
  args: {
    orgIds: v.array(v.id("organizations")),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgIds = args.orgIds.slice(0, 25);
    const search = args.query?.trim().toLowerCase();
    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
    const rows = (
      await Promise.all(
        orgIds.map(async (orgId) => {
          const [org, files] = await Promise.all([
            ctx.db.get(orgId),
            ctx.db
              .query("clientFiles")
              .withIndex("visibility", (index) =>
                index.eq("orgId", orgId).eq("clientVisible", true),
              )
              .order("desc")
              .take(100),
          ]);
          if (!org || org.type !== "client") return [];
          return files.map((file) => ({ file, orgName: org.name }));
        }),
      )
    )
      .flat()
      .filter(({ file }) =>
        search
          ? [file.name, file.originalName].some((value) =>
              value.toLowerCase().includes(search),
            )
          : true,
      )
      .sort((left, right) => right.file.updatedAt - left.file.updatedAt)
      .slice(0, limit);
    return rows.map(({ file, orgName }) => ({
      clientFileId: file._id,
      orgId: file.orgId,
      orgName,
      name: file.name,
      originalName: file.originalName,
      contentType: file.contentType,
      size: file.size,
      policyId: file.policyId,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }));
  },
});

export const getVisibleInternal = internalQuery({
  args: {
    clientFileId: v.id("clientFiles"),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.clientFileId);
    if (
      !file ||
      !file.clientVisible ||
      !args.orgIds.some((orgId) => orgId === file.orgId)
    ) {
      return null;
    }
    const org = await ctx.db.get(file.orgId);
    if (!org || org.type !== "client") return null;
    return {
      clientFileId: file._id,
      orgId: file.orgId,
      orgName: org.name,
      fileId: file.fileId,
      name: file.name,
      originalName: file.originalName,
      contentType: file.contentType,
      size: file.size,
      policyId: file.policyId,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      url: await ctx.storage.getUrl(file.fileId),
    };
  },
});

export const getForOperatorInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    clientFileId: v.id("clientFiles"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    void operator;
    const file = await ctx.db.get(args.clientFileId);
    if (!file) return null;
    const org = await ctx.db.get(file.orgId);
    if (!org || org.type !== "client") return null;
    return {
      clientFileId: file._id,
      orgId: file.orgId,
      orgName: org.name,
      fileId: file.fileId,
      name: file.name,
      originalName: file.originalName,
      contentType: file.contentType,
      size: file.size,
      policyId: file.policyId,
      clientVisible: file.clientVisible,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      url: await ctx.storage.getUrl(file.fileId),
    };
  },
});

export const generateUploadUrl = mutation({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { operator } = await requireDirectOperatorClientWrite(
      ctx,
      args.clientOrgId,
    );
    const now = dayjs().valueOf();
    const expiresAt = now + CLIENT_FILE_UPLOAD_TTL_MS;
    const uploadIntentId = await ctx.db.insert("clientFileUploadIntents", {
      operatorUserId: operator.userId,
      clientOrgId: args.clientOrgId,
      expiresAt,
      createdAt: now,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.clientFiles.cleanupUploadIntentInternal,
      { uploadIntentId },
    );
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      uploadIntentId,
    };
  },
});

export const registerUpload = mutation({
  args: {
    uploadIntentId: v.id("clientFileUploadIntents"),
    fileId: v.id("_storage"),
    originalName: v.string(),
    contentType: v.string(),
    clientVisible: v.boolean(),
    policyId: v.optional(v.id("policies")),
    hint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const intent = await ctx.db.get(args.uploadIntentId);
    if (
      !intent ||
      intent.operatorUserId !== operator.userId ||
      intent.expiresAt <= dayjs().valueOf() ||
      (intent.fileId && intent.fileId !== args.fileId)
    ) {
      throw new Error("Client file upload intent is invalid or expired");
    }
    const organization = await requireClientOrganization(
      ctx,
      intent.clientOrgId,
    );
    await requirePolicyForClient(ctx, args.policyId, organization._id);
    const metadata = await ctx.db.system.get("_storage", args.fileId);
    if (!metadata) throw new Error("Client file was not uploaded");
    if (metadata.size > MAX_CLIENT_FILE_BYTES) {
      throw new Error("Client files must be 50 MB or smaller");
    }
    await ctx.db.patch(intent._id, { fileId: args.fileId });
    const existing = await ctx.db
      .query("clientFiles")
      .withIndex("storage", (index) => index.eq("fileId", args.fileId))
      .first();
    if (existing) throw new Error("Client file was already registered");
    const originalName = normalizeAgentAttachmentFilename(args.originalName);
    const contentType = normalizeAgentAttachmentContentType(
      args.contentType || metadata.contentType || "application/octet-stream",
    );
    const now = dayjs().valueOf();
    const clientFileId = await ctx.db.insert("clientFiles", {
      orgId: organization._id,
      fileId: args.fileId,
      name: buildClientFileName(originalName, originalName),
      originalName,
      contentType,
      size: metadata.size,
      clientVisible: args.clientVisible,
      policyId: args.policyId,
      uploadedByUserId: operator.userId,
      uploadedBySide: "operator",
      nameSource: "original",
      nameStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.delete(intent._id);
    await ctx.scheduler.runAfter(0, internal.actions.clientFileNaming.infer, {
      clientFileId,
      expectedUpdatedAt: now,
      hint: boundedClientFileHint(args.hint),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: organization._id,
      summary: `Uploaded ${originalName} for ${organization.name}`,
      metadata: {
        domain: "client_files",
        clientFileId,
        policyId: args.policyId,
        clientVisible: args.clientVisible,
      },
    });
    return { clientFileId };
  },
});

export const discardUpload = mutation({
  args: {
    uploadIntentId: v.id("clientFileUploadIntents"),
    fileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const intent = await ctx.db.get(args.uploadIntentId);
    if (!intent || intent.operatorUserId !== operator.userId) {
      return { discarded: false as const };
    }
    if (intent.fileId && args.fileId && intent.fileId !== args.fileId) {
      return { discarded: false as const };
    }
    const fileId = intent.fileId ?? args.fileId;
    if (fileId) {
      const referenced = await ctx.db
        .query("clientFiles")
        .withIndex("storage", (index) => index.eq("fileId", fileId))
        .first();
      if (!referenced) await ctx.storage.delete(fileId);
    }
    await ctx.db.delete(intent._id);
    return { discarded: true as const };
  },
});

export const update = mutation({
  args: {
    clientFileId: v.id("clientFiles"),
    name: v.optional(v.string()),
    clientVisible: v.optional(v.boolean()),
    policyId: v.optional(v.union(v.id("policies"), v.null())),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await updateClientFileByOperator(ctx, {
      operatorUserId: operator.userId,
      clientFileId: args.clientFileId,
      name: args.name,
      clientVisible: args.clientVisible,
      policyId: args.policyId,
      source: "operator",
    });
  },
});

export const getForNamingInternal = internalQuery({
  args: { clientFileId: v.id("clientFiles") },
  handler: async (ctx, args) => await ctx.db.get(args.clientFileId),
});

export const applyInferredNameInternal = internalMutation({
  args: {
    clientFileId: v.id("clientFiles"),
    expectedUpdatedAt: v.number(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.clientFileId);
    if (
      !file ||
      file.updatedAt !== args.expectedUpdatedAt ||
      file.nameSource !== "original"
    ) {
      return { applied: false as const };
    }
    await ctx.db.patch(file._id, {
      name: buildClientFileName(args.title, file.originalName),
      nameSource: "ai",
      nameStatus: "ready",
      nameInferenceError: undefined,
      updatedAt: dayjs().valueOf(),
    });
    return { applied: true as const };
  },
});

export const markNameInferenceFailedInternal = internalMutation({
  args: {
    clientFileId: v.id("clientFiles"),
    expectedUpdatedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.clientFileId);
    if (
      !file ||
      file.updatedAt !== args.expectedUpdatedAt ||
      file.nameSource !== "original"
    ) {
      return { applied: false as const };
    }
    await ctx.db.patch(file._id, {
      nameStatus: "failed",
      nameInferenceError: args.error.slice(0, 500),
      updatedAt: dayjs().valueOf(),
    });
    return { applied: true as const };
  },
});

export const cleanupUploadIntentInternal = internalMutation({
  args: { uploadIntentId: v.id("clientFileUploadIntents") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.uploadIntentId);
    if (!intent) return { deleted: false as const };
    const now = dayjs().valueOf();
    if (intent.expiresAt > now) {
      await ctx.scheduler.runAt(
        intent.expiresAt,
        internal.clientFiles.cleanupUploadIntentInternal,
        args,
      );
      return { deleted: false as const };
    }
    if (intent.fileId) {
      const file = await ctx.db
        .query("clientFiles")
        .withIndex("storage", (index) => index.eq("fileId", intent.fileId!))
        .first();
      if (!file) await ctx.storage.delete(intent.fileId);
    }
    await ctx.db.delete(intent._id);
    return { deleted: true as const };
  },
});
