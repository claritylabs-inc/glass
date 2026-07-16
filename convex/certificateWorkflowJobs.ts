import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess } from "./lib/access";
import {
  certificateHolderDisplayBlock,
  holderSnapshot,
  type CertificateHolderAddressInput,
} from "./lib/certificateIdentity";

const jobStatusValidator = v.union(
  v.literal("review_required"),
  v.literal("blocked_missing_contact"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("cancelled"),
  v.literal("failed"),
);

const jobKindValidator = v.union(
  v.literal("renewal_reissue"),
  v.literal("manual_review"),
);

function cleanOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeEmail(value?: string) {
  return cleanOptional(value)?.toLowerCase();
}

async function nextVersionNumber(ctx: MutationCtx, certificateId: Id<"policyCertificates">) {
  const latest = await ctx.db
    .query("certificateVersions")
    .withIndex("by_certificateId_versionNumber", (q) => q.eq("certificateId", certificateId))
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

async function createWorkflowJob(ctx: MutationCtx, args: {
  orgId: Id<"organizations">;
  brokerOrgId?: Id<"organizations">;
  certificateId: Id<"policyCertificates">;
  holderId: Id<"certificateHolders">;
  policyId: Id<"policies">;
  policyVersionId?: Id<"policyVersions">;
  kind: "renewal_reissue" | "manual_review";
  idempotencyKey: string;
  reason?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  createdByUserId?: Id<"users">;
}) {
  const existing = await ctx.db
    .query("certificateWorkflowJobs")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
    .first();
  if (existing) return { jobId: existing._id, created: false, status: existing.status };
  const now = dayjs().valueOf();
  const holder = await ctx.db.get(args.holderId);
  const versionId = await ctx.db.insert("certificateVersions", {
    orgId: args.orgId,
    certificateId: args.certificateId,
    holderId: args.holderId,
    policyId: args.policyId,
    policyVersionId: args.policyVersionId,
    versionNumber: await nextVersionNumber(ctx, args.certificateId),
    status: "draft",
    certificateHolder: holder
      ? certificateHolderDisplayBlock({
          displayName: holder.displayName,
          contactName: holder.contactName,
          email: holder.email,
          phone: holder.phone,
          address: holder.address as CertificateHolderAddressInput | undefined,
        })
      : args.recipientName,
    certificateHolderName: holder?.displayName ?? args.recipientName,
    holderSnapshot: holder
      ? holderSnapshot({
          displayName: holder.displayName,
          contactName: holder.contactName,
          email: holder.email,
          phone: holder.phone,
          address: holder.address as CertificateHolderAddressInput | undefined,
        })
      : undefined,
    source: "agent",
    createdByUserId: args.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  const status = args.recipientEmail ? "review_required" : "blocked_missing_contact";
  const jobId = await ctx.db.insert("certificateWorkflowJobs", {
    orgId: args.orgId,
    brokerOrgId: args.brokerOrgId,
    certificateId: args.certificateId,
    certificateVersionId: versionId,
    holderId: args.holderId,
    policyId: args.policyId,
    policyVersionId: args.policyVersionId,
    kind: args.kind,
    status,
    idempotencyKey: args.idempotencyKey,
    reason: args.reason,
    recipientName: args.recipientName ?? holder?.displayName,
    recipientEmail: args.recipientEmail,
    recipientPhone: args.recipientPhone,
    createdByUserId: args.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  return { jobId, created: true, status };
}

export const createRenewalJobsForPolicyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Organization not found");
    const brokerOrgId = org.type === "broker"
      ? args.orgId
      : org.type === "client"
        ? org.brokerOrgId
        : undefined;
    const clientOverride = org.type === "client"
      ? await ctx.db
          .query("certificateWorkflowSettings")
          .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.orgId))
          .first()
      : null;
    const brokerDefault = brokerOrgId
      ? await ctx.db
          .query("certificateWorkflowSettings")
          .withIndex("by_brokerOrgId_clientOrgId", (q) =>
            q.eq("brokerOrgId", brokerOrgId).eq("clientOrgId", undefined),
          )
          .first()
      : null;
    const settings = clientOverride ?? brokerDefault;
    if (settings?.renewalReissueEnabled === false) return { created: 0, jobs: [] };
    const certificates = await ctx.db
      .query("policyCertificates")
      .withIndex("by_policyId_status", (q) => q.eq("policyId", args.policyId).eq("status", "active"))
      .collect();
    const jobs = [];
    for (const certificate of certificates) {
      if (!certificate.latestIssuedVersionId) continue;
      const holder = await ctx.db.get(certificate.holderId);
      if (!holder) continue;
      const job = await createWorkflowJob(ctx, {
        orgId: args.orgId,
        brokerOrgId,
        certificateId: certificate._id,
        holderId: certificate.holderId,
        policyId: args.policyId,
        policyVersionId: args.policyVersionId,
        kind: "renewal_reissue",
        idempotencyKey: `renewal_reissue:${String(args.policyVersionId ?? args.policyId)}:${String(certificate._id)}`,
        reason: "Policy renewal requires certificate review for the current holder.",
        recipientName: holder.displayName,
        recipientEmail: holder.email,
        recipientPhone: holder.phone,
        createdByUserId: args.createdByUserId,
      });
      if (job.created) jobs.push(job);
    }
    return { created: jobs.length, jobs };
  },
});

export const listForOrg = query({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    status: v.optional(jobStatusValidator),
    kind: v.optional(jobKindValidator),
  },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.orgId);
    const rows = args.policyId
      ? await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId!))
          .order("desc")
          .collect()
      : await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
          .order("desc")
          .collect();
    const enriched = await Promise.all(
      rows
        .filter((row) =>
          row.orgId === args.orgId &&
          (!args.status || row.status === args.status) &&
          (!args.kind || row.kind === args.kind),
        )
        .map(async (row) => {
          const policy = await ctx.db.get(row.policyId);
          if (!policy || policy.deletedAt) return null;
          return {
            ...row,
            holder: await ctx.db.get(row.holderId),
            policy,
            certificateVersion: row.certificateVersionId ? await ctx.db.get(row.certificateVersionId) : null,
          };
        }),
    );
    return enriched.filter((row) => row !== null);
  },
});

export const listForOrgInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    status: v.optional(jobStatusValidator),
    kind: v.optional(jobKindValidator),
  },
  handler: async (ctx, args) => {
    const rows = args.policyId
      ? await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId!))
          .collect()
      : await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
          .collect();
    const enriched = await Promise.all(
      rows
        .filter((row) =>
          row.orgId === args.orgId &&
          (!args.status || row.status === args.status) &&
          (!args.kind || row.kind === args.kind),
        )
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(async (row) => {
          const policy = await ctx.db.get(row.policyId);
          if (!policy || policy.deletedAt) return null;
          return {
            ...row,
            holder: await ctx.db.get(row.holderId),
            policy,
            certificateVersion: row.certificateVersionId ? await ctx.db.get(row.certificateVersionId) : null,
          };
        }),
    );
    return enriched.filter((row) => row !== null);
  },
});

export const reviewJob = mutation({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate workflow job not found");
    const access = await getOrgAccess(ctx, job.orgId);
    if (access.accessType === "connected_client") throw new Error("Connected client access is read-only.");
    if (job.status === "sent" || job.status === "cancelled") throw new Error("Completed jobs cannot be reviewed.");
    const recipientEmail = normalizeEmail(args.recipientEmail) ?? job.recipientEmail;
    const now = dayjs().valueOf();
    const status = recipientEmail ? "review_required" : "blocked_missing_contact";
    await ctx.db.patch(args.jobId, {
      status,
      recipientEmail,
      recipientPhone: cleanOptional(args.recipientPhone) ?? job.recipientPhone,
      reviewNotes: cleanOptional(args.reviewNotes),
      reviewedByUserId: access.userId,
      reviewedAt: now,
      updatedAt: now,
    });
    return { status };
  },
});

export const cancelJob = mutation({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate workflow job not found");
    const access = await getOrgAccess(ctx, job.orgId);
    if (access.accessType === "connected_client") throw new Error("Connected client access is read-only.");
    if (job.status === "sent") throw new Error("Sent jobs cannot be cancelled.");
    const now = dayjs().valueOf();
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      cancelReason: cleanOptional(args.reason),
      cancelledByUserId: access.userId,
      cancelledAt: now,
      updatedAt: now,
    });
    if (job.certificateVersionId) {
      await ctx.db.patch(job.certificateVersionId, {
        status: "void",
        voidedAt: now,
        updatedAt: now,
      });
    }
    return { status: "cancelled" };
  },
});

export const prepareSendJob = mutation({
  args: { jobId: v.id("certificateWorkflowJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate workflow job not found");
    const access = await getOrgAccess(ctx, job.orgId);
    if (access.accessType === "connected_client") throw new Error("Connected client access is read-only.");
    if (job.status !== "review_required") throw new Error("Job must be ready for review before sending.");
    if (!job.recipientEmail) throw new Error("Recipient email is required before sending.");
    const holder = await ctx.db.get(job.holderId);
    const org = await ctx.db.get(job.orgId);
    const policy = await ctx.db.get(job.policyId);
    if (!holder || !org || !policy) throw new Error("Certificate workflow job is missing required records.");
    const now = dayjs().valueOf();
    await ctx.db.patch(args.jobId, {
      status: "sending",
      reviewedByUserId: job.reviewedByUserId ?? access.userId,
      reviewedAt: job.reviewedAt ?? now,
      updatedAt: now,
    });
    return { job, holder, org, policy, userId: access.userId };
  },
});

export const markSentInternal = internalMutation({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    generatedCertificateVersionId: v.optional(v.id("certificateVersions")),
    sentByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate workflow job not found");
    const now = dayjs().valueOf();
    if (job.certificateVersionId && args.generatedCertificateVersionId && job.certificateVersionId !== args.generatedCertificateVersionId) {
      await ctx.db.patch(job.certificateVersionId, {
        status: "void",
        voidedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(args.jobId, {
      status: "sent",
      certificateVersionId: args.generatedCertificateVersionId ?? job.certificateVersionId,
      sentByUserId: args.sentByUserId,
      sentAt: now,
      updatedAt: now,
    });
    return { status: "sent" };
  },
});

export const markFailedInternal = internalMutation({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "failed",
      lastError: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const getInternal = internalQuery({
  args: { jobId: v.id("certificateWorkflowJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});
