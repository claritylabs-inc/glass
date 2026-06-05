import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess, getPolicyAccessForQuery } from "./lib/access";
import {
  holderSnapshot,
  policyCertificateDedupeKey,
} from "./lib/certificateIdentity";

const certificateSourceValidator = v.union(
  v.literal("policy_page"),
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("sms"),
  v.literal("api"),
  v.literal("mcp"),
  v.literal("agent"),
  v.literal("unknown"),
);

const certificationStatusValidator = v.union(
  v.literal("not_applicable"),
  v.literal("pending"),
  v.literal("certified"),
  v.literal("declined"),
);

type ReadCtx = QueryCtx | MutationCtx;

async function nextCertificateVersionNumber(ctx: ReadCtx, certificateId: Id<"policyCertificates">) {
  const latest = await ctx.db
    .query("certificateVersions")
    .withIndex("by_certificateId_versionNumber", (q) => q.eq("certificateId", certificateId))
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const access = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!access) return [];
    const certificates = await ctx.db
      .query("policyCertificates")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    return await Promise.all(
      certificates.map(async (certificate) => {
        const [holder, currentVersion, latestIssuedVersion] = await Promise.all([
          ctx.db.get(certificate.holderId),
          certificate.currentVersionId ? ctx.db.get(certificate.currentVersionId) : null,
          certificate.latestIssuedVersionId ? ctx.db.get(certificate.latestIssuedVersionId) : null,
        ]);
        return {
          ...certificate,
          holder,
          currentVersion,
          latestIssuedVersion,
          url: currentVersion?.fileId ? await ctx.storage.getUrl(currentVersion.fileId) : null,
        };
      }),
    );
  },
});

export const listForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.orgId);
    const certificates = await ctx.db
      .query("policyCertificates")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    return await Promise.all(
      certificates.map(async (certificate) => {
        const [holder, policy, currentVersion] = await Promise.all([
          ctx.db.get(certificate.holderId),
          ctx.db.get(certificate.policyId),
          certificate.currentVersionId ? ctx.db.get(certificate.currentVersionId) : null,
        ]);
        return {
          ...certificate,
          holder,
          policy,
          currentVersion,
          url: currentVersion?.fileId ? await ctx.storage.getUrl(currentVersion.fileId) : null,
        };
      }),
    );
  },
});

export const listVersionsInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    certificateId: v.optional(v.id("policyCertificates")),
    holderId: v.optional(v.id("certificateHolders")),
  },
  handler: async (ctx, args) => {
    const rows = args.certificateId
      ? await ctx.db
          .query("certificateVersions")
          .withIndex("by_certificateId_versionNumber", (q) =>
            q.eq("certificateId", args.certificateId!),
          )
          .order("desc")
          .collect()
      : args.holderId
        ? await ctx.db
            .query("certificateVersions")
            .withIndex("by_holderId", (q) => q.eq("holderId", args.holderId!))
            .collect()
        : args.policyId
          ? await ctx.db
              .query("certificateVersions")
              .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId!))
              .collect()
          : await ctx.db
              .query("certificateVersions")
              .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
              .collect();
    const scoped = rows
      .filter((row) => row.orgId === args.orgId)
      .sort((left, right) => right.createdAt - left.createdAt);
    return await Promise.all(
      scoped.map(async (version) => ({
        ...version,
        holder: await ctx.db.get(version.holderId),
        url: version.fileId ? await ctx.storage.getUrl(version.fileId) : null,
      })),
    );
  },
});

export const getOrCreateParentInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderId: v.id("certificateHolders"),
    source: v.optional(certificateSourceValidator),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const dedupeKey = policyCertificateDedupeKey({
      orgId: String(args.orgId),
      policyId: String(args.policyId),
      holderId: String(args.holderId),
    });
    const existing = await ctx.db
      .query("policyCertificates")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (existing) return existing._id;
    const now = dayjs().valueOf();
    return await ctx.db.insert("policyCertificates", {
      orgId: args.orgId,
      policyId: args.policyId,
      holderId: args.holderId,
      status: "active",
      dedupeKey,
      source: args.source,
      createdByUserId: args.createdByUserId,
      updatedByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const findReusableIssuedVersionInternal = internalQuery({
  args: {
    certificateId: v.id("policyCertificates"),
    policyVersionId: v.optional(v.id("policyVersions")),
    authorityType: v.optional(v.union(v.literal("non_binding"), v.literal("certified"))),
    certificationStatus: v.optional(
      v.union(
        v.literal("not_applicable"),
        v.literal("pending"),
        v.literal("certified"),
        v.literal("declined"),
      ),
    ),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
  },
  handler: async (ctx, args) => {
    const parent = await ctx.db.get(args.certificateId);
    if (!parent?.latestIssuedVersionId) return null;
    const version = await ctx.db.get(parent.latestIssuedVersionId);
    if (!version || version.status !== "issued" || !version.fileId) return null;
    if (args.policyVersionId && version.policyVersionId !== args.policyVersionId) return null;
    if (args.authorityType && version.authorityType !== args.authorityType) return null;
    if (args.certificationStatus && version.certificationStatus !== args.certificationStatus) return null;
    if (args.partnerProgramId && version.partnerProgramId !== args.partnerProgramId) return null;
    if (args.templateId && version.templateId !== args.templateId) return null;
    return {
      ...version,
      url: await ctx.storage.getUrl(version.fileId),
    };
  },
});

export const recordIssuedVersionInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    certificateId: v.id("policyCertificates"),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    holderEmail: v.optional(v.string()),
    holderPhone: v.optional(v.string()),
    holderAddress: v.optional(v.any()),
    policySnapshot: v.optional(v.any()),
    policySnapshotHash: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    authorityType: v.optional(v.union(v.literal("non_binding"), v.literal("certified"))),
    certificationStatus: v.optional(certificationStatusValidator),
    partnerOrgId: v.optional(v.id("organizations")),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    standingAuthorizationId: v.optional(v.id("standingAuthorizations")),
    approvalMode: v.optional(
      v.union(
        v.literal("auto_approve_all"),
        v.literal("require_approval_all"),
        v.literal("llm_review"),
      ),
    ),
    approvalAudit: v.optional(v.any()),
    disclaimer: v.optional(v.string()),
    legacyCertificateId: v.optional(v.id("certificates")),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existingIssued = await ctx.db
      .query("certificateVersions")
      .withIndex("by_certificateId", (q) => q.eq("certificateId", args.certificateId))
      .filter((q) => q.eq(q.field("status"), "issued"))
      .collect();
    for (const version of existingIssued) {
      await ctx.db.patch(version._id, {
        status: "superseded",
        supersededAt: now,
        updatedAt: now,
      });
    }

    const versionNumber = await nextCertificateVersionNumber(ctx, args.certificateId);
    const versionId = await ctx.db.insert("certificateVersions", {
      orgId: args.orgId,
      certificateId: args.certificateId,
      holderId: args.holderId,
      policyId: args.policyId,
      policyVersionId: args.policyVersionId,
      versionNumber,
      status: "issued",
      fileId: args.fileId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      certificateHolder: args.certificateHolder,
      certificateHolderName: args.certificateHolderName,
      holderSnapshot: holderSnapshot({
        displayName: args.certificateHolderName ?? "Certificate holder",
        email: args.holderEmail,
        phone: args.holderPhone,
        address: args.holderAddress,
      }),
      policySnapshot: args.policySnapshot,
      policySnapshotHash: args.policySnapshotHash,
      source: args.source,
      authorityType: args.authorityType ?? "non_binding",
      certificationStatus: args.certificationStatus ?? "not_applicable",
      partnerOrgId: args.partnerOrgId,
      partnerProgramId: args.partnerProgramId,
      templateId: args.templateId,
      standingAuthorizationId: args.standingAuthorizationId,
      approvalMode: args.approvalMode,
      approvalAudit: args.approvalAudit,
      disclaimer: args.disclaimer,
      legacyCertificateId: args.legacyCertificateId,
      issuedAt: now,
      createdByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.certificateId, {
      currentVersionId: versionId,
      latestIssuedVersionId: versionId,
      lastIssuedAt: now,
      updatedByUserId: args.createdByUserId,
      updatedAt: now,
    });
    return {
      versionId,
      versionNumber,
    };
  },
});
