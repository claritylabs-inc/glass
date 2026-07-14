import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getOrgAccess, getPolicyAccessForQuery, type OrgAccess } from "./lib/access";
import {
  holderSnapshot,
  policyCertificateDedupeKey,
} from "./lib/certificateIdentity";
import {
  certificateHolderIdentity,
  compareCertificateHolderAddresses,
  type CertificateHolderResolutionCandidate,
} from "./lib/certificateHolderResolution";
import { requireOperator } from "./lib/operatorIdentity";

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

const certificateRequestKindValidator = v.union(
  v.literal("holder"),
  v.literal("additional_insured"),
);

const certificateFormCodeValidator = v.union(
  v.literal("acord25"),
  v.literal("acord24"),
  v.literal("acord27"),
  v.literal("acord28"),
  v.literal("acord29"),
  v.literal("acord30"),
  v.literal("acord31"),
);

type ReadCtx = QueryCtx | MutationCtx;
type IssuedCertificateCandidate = {
  candidateId: string;
  policyCertificateId: Id<"policyCertificates">;
  holderId: Id<"certificateHolders">;
  holder: Doc<"certificateHolders">;
  version: Doc<"certificateVersions">;
  url: string | null;
  issuedAt?: number;
  createdAt: number;
};

function assertCanWriteCertificates(access: OrgAccess) {
  if (access.accessType === "connected_client") {
    throw new Error("Connected client access is read-only.");
  }
}

function isOpenWorkflowJobStatus(status: Doc<"certificateWorkflowJobs">["status"]) {
  return status === "review_required" ||
    status === "blocked_missing_contact" ||
    status === "sending";
}

async function nextCertificateVersionNumber(ctx: ReadCtx, certificateId: Id<"policyCertificates">) {
  const latest = await ctx.db
    .query("certificateVersions")
    .withIndex("by_certificateId_versionNumber", (q) => q.eq("certificateId", certificateId))
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

async function currentPolicyVersionId(ctx: ReadCtx, policyId: Id<"policies">) {
  const policy = await ctx.db.get(policyId);
  if (!policy) return undefined;
  if (policy.currentPolicyVersionId) return policy.currentPolicyVersionId;
  const latest = await ctx.db
    .query("policyVersions")
    .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", policyId))
    .order("desc")
    .first();
  return latest?._id;
}

function candidateIdentity(holder: Doc<"certificateHolders">, version?: Doc<"certificateVersions"> | null) {
  const holderSnapshot = version?.holderSnapshot as {
    displayName?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      formatted?: string;
    };
  } | undefined;
  return certificateHolderIdentity({
    displayName: holder.displayName,
    address: holder.address ?? holderSnapshot?.address,
  });
}

async function collectIssuedCertificateCandidates(ctx: ReadCtx, args: {
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  policyVersionId?: Id<"policyVersions">;
  requestKind?: "holder" | "additional_insured";
  requestSignature?: string;
}) {
  const policy = await ctx.db.get(args.policyId);
  if (!policy || policy.orgId !== args.orgId || policy.deletedAt) return [];
  const policyVersionId = args.policyVersionId ?? await currentPolicyVersionId(ctx, args.policyId);
  const parents = await ctx.db
    .query("policyCertificates")
    .withIndex("by_policyId_status", (q) =>
      q.eq("policyId", args.policyId).eq("status", "active"),
    )
    .collect();
  const candidates: CertificateHolderResolutionCandidate<IssuedCertificateCandidate>[] = [];
  for (const parent of parents.slice(0, 50)) {
    if (parent.orgId !== args.orgId || !parent.latestIssuedVersionId) continue;
    const [holder, version] = await Promise.all([
      ctx.db.get(parent.holderId),
      ctx.db.get(parent.latestIssuedVersionId),
    ]);
    if (!holder || !version || version.status !== "issued" || !version.fileId) continue;
    if (version.policyId !== args.policyId) continue;
    if (policyVersionId && version.policyVersionId !== policyVersionId) continue;
    if (args.requestKind && (version.requestKind ?? "holder") !== args.requestKind) continue;
    if (args.requestSignature && version.requestSignature !== args.requestSignature) continue;
    const url = await ctx.storage.getUrl(version.fileId);
    const data = {
      candidateId: String(parent._id),
      policyCertificateId: parent._id,
      holderId: holder._id,
      holder,
      version,
      url,
      issuedAt: version.issuedAt,
      createdAt: version.createdAt,
    };
    candidates.push({
      candidateId: data.candidateId,
      identity: candidateIdentity(holder, version),
      issuedAt: version.issuedAt,
      createdAt: version.createdAt,
      data,
    });
  }
  return candidates.sort((left, right) =>
    Number(right.issuedAt ?? right.createdAt ?? 0) -
    Number(left.issuedAt ?? left.createdAt ?? 0),
  );
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
    const enriched = await Promise.all(
      certificates.map(async (certificate) => {
        const [holder, policy, currentVersion, latestIssuedVersion, versions] = await Promise.all([
          ctx.db.get(certificate.holderId),
          ctx.db.get(certificate.policyId),
          certificate.currentVersionId ? ctx.db.get(certificate.currentVersionId) : null,
          certificate.latestIssuedVersionId ? ctx.db.get(certificate.latestIssuedVersionId) : null,
          ctx.db
            .query("certificateVersions")
            .withIndex("by_certificateId_versionNumber", (q) =>
              q.eq("certificateId", certificate._id),
            )
            .order("desc")
            .collect(),
        ]);
        if (!policy || policy.deletedAt) return null;
        const versionsWithUrls = await Promise.all(
          versions.map(async (version) => ({
            ...version,
            url: version.fileId ? await ctx.storage.getUrl(version.fileId) : null,
          })),
        );
        return {
          ...certificate,
          holder,
          policy,
          currentVersion,
          latestIssuedVersion,
          url: currentVersion?.fileId ? await ctx.storage.getUrl(currentVersion.fileId) : null,
          versions: versionsWithUrls,
        };
      }),
    );
    return enriched.filter((row) => row !== null);
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
        const [holder, policy, currentVersion, versions] = await Promise.all([
          ctx.db.get(certificate.holderId),
          ctx.db.get(certificate.policyId),
          certificate.currentVersionId ? ctx.db.get(certificate.currentVersionId) : null,
          ctx.db
            .query("certificateVersions")
            .withIndex("by_certificateId_versionNumber", (q) =>
              q.eq("certificateId", certificate._id),
            )
            .order("desc")
            .collect(),
        ]);
        const versionsWithUrls = await Promise.all(
          versions.map(async (version) => ({
            ...version,
            url: version.fileId ? await ctx.storage.getUrl(version.fileId) : null,
          })),
        );
        return {
          ...certificate,
          holder,
          policy,
          currentVersion,
          url: currentVersion?.fileId ? await ctx.storage.getUrl(currentVersion.fileId) : null,
          versions: versionsWithUrls,
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
    const parentIds = Array.from(new Set(scoped.map((row) => row.certificateId)));
    const parents = new Map(
      await Promise.all(
        parentIds.map(async (certificateId) =>
          [certificateId, await ctx.db.get(certificateId)] as const,
        ),
      ),
    );
    const policies = new Map(
      await Promise.all(
        Array.from(new Set(scoped.map((row) => row.policyId))).map(
          async (policyId) => [policyId, await ctx.db.get(policyId)] as const,
        ),
      ),
    );
    const visible = scoped.filter(
      (version) =>
        parents.get(version.certificateId)?.status !== "archived" &&
        !policies.get(version.policyId)?.deletedAt,
    );
    return await Promise.all(
      visible.map(async (version) => ({
        ...version,
        holder: await ctx.db.get(version.holderId),
        url: version.fileId ? await ctx.storage.getUrl(version.fileId) : null,
      })),
    );
  },
});

export const archive = mutation({
  args: { certificateId: v.id("policyCertificates") },
  handler: async (ctx, args) => {
    const certificate = await ctx.db.get(args.certificateId);
    if (!certificate) throw new Error("Certificate not found.");
    const access = await getOrgAccess(ctx, certificate.orgId);
    assertCanWriteCertificates(access);
    if (certificate.status === "archived") {
      return { status: "archived", cancelledJobs: 0 };
    }

    const now = dayjs().valueOf();
    await ctx.db.patch(args.certificateId, {
      status: "archived",
      archivedAt: now,
      archivedByUserId: access.userId,
      updatedByUserId: access.userId,
      updatedAt: now,
    });

    const jobs = await ctx.db
      .query("certificateWorkflowJobs")
      .withIndex("by_certificateId", (q) => q.eq("certificateId", args.certificateId))
      .collect();
    let cancelledJobs = 0;
    for (const job of jobs) {
      if (!isOpenWorkflowJobStatus(job.status)) continue;
      await ctx.db.patch(job._id, {
        status: "cancelled",
        cancelReason: "Certificate archived",
        cancelledByUserId: access.userId,
        cancelledAt: now,
        updatedAt: now,
      });
      cancelledJobs += 1;
    }

    return { status: "archived", cancelledJobs };
  },
});

export const unarchive = mutation({
  args: { certificateId: v.id("policyCertificates") },
  handler: async (ctx, args) => {
    const certificate = await ctx.db.get(args.certificateId);
    if (!certificate) throw new Error("Certificate not found.");
    const access = await getOrgAccess(ctx, certificate.orgId);
    assertCanWriteCertificates(access);
    if (certificate.status !== "archived") {
      throw new Error("Certificate is not archived.");
    }

    const siblings = await ctx.db
      .query("policyCertificates")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", certificate.dedupeKey))
      .collect();
    const conflict = siblings.find((row) =>
      row._id !== args.certificateId && row.status !== "archived",
    );
    if (conflict) {
      throw new Error("A newer certificate already exists for this holder");
    }

    const now = dayjs().valueOf();
    await ctx.db.patch(args.certificateId, {
      status: "active",
      archivedAt: undefined,
      archivedByUserId: undefined,
      updatedByUserId: access.userId,
      updatedAt: now,
    });

    return { status: "active" };
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
    const existing = (await ctx.db
      .query("policyCertificates")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .collect())
      .find((row) => row.status !== "archived");
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

export const findIssuedCertificateHolderCandidatesInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    requestKind: v.optional(certificateRequestKindValidator),
    requestSignature: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await collectIssuedCertificateCandidates(ctx, args);
  },
});

export const nextVersionNumberInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    certificateId: v.id("policyCertificates"),
  },
  handler: async (ctx, args) => {
    const certificate = await ctx.db.get(args.certificateId);
    if (!certificate || certificate.orgId !== args.orgId) {
      throw new Error("Certificate not found.");
    }
    return await nextCertificateVersionNumber(ctx, args.certificateId);
  },
});

function cleanupGroupHasAddressConflict(rows: Array<{
  identity: ReturnType<typeof candidateIdentity>;
}>) {
  const addressed = rows.filter((row) => row.identity.normalizedAddress);
  for (let index = 0; index < addressed.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < addressed.length; otherIndex += 1) {
      const comparison = compareCertificateHolderAddresses(
        addressed[index]?.identity.normalizedAddress,
        addressed[otherIndex]?.identity.normalizedAddress,
      );
      if (comparison !== "same" && comparison !== "both_missing" && comparison !== "one_missing") {
        return true;
      }
    }
  }
  return false;
}

async function versionsForCertificate(ctx: ReadCtx, certificateId: Id<"policyCertificates">) {
  return await ctx.db
    .query("certificateVersions")
    .withIndex("by_certificateId_versionNumber", (q) => q.eq("certificateId", certificateId))
    .order("asc")
    .collect();
}

async function cleanupDuplicatePolicyCertificates(ctx: MutationCtx, args: {
  policyId: Id<"policies">;
  dryRun?: boolean;
}) {
  const dryRun = args.dryRun ?? true;
  const now = dayjs().valueOf();
  const parents = await ctx.db
    .query("policyCertificates")
    .withIndex("by_policyId_status", (q) =>
      q.eq("policyId", args.policyId).eq("status", "active"),
    )
    .collect();
  const enriched = [];
  for (const parent of parents) {
    const [holder, versions] = await Promise.all([
      ctx.db.get(parent.holderId),
      versionsForCertificate(ctx, parent._id),
    ]);
    if (!holder) continue;
    enriched.push({
      parent,
      holder,
      versions,
      identity: candidateIdentity(holder, versions.find((version) => version._id === parent.latestIssuedVersionId)),
    });
  }

  const byName = new Map<string, typeof enriched>();
  for (const row of enriched) {
    const key = row.identity.normalizedName;
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }

  const mergedGroups = [];
  const ambiguousGroups = [];
  let archivedParents = 0;
  let movedVersions = 0;
  for (const rows of byName.values()) {
    if (rows.length < 2) continue;
    if (cleanupGroupHasAddressConflict(rows)) {
      ambiguousGroups.push({
        normalizedName: rows[0]?.identity.normalizedName,
        policyCertificateIds: rows.map((row) => row.parent._id),
        reason: "Same holder name has conflicting addresses.",
      });
      continue;
    }

    const sortedParents = [...rows].sort((left, right) =>
      Number(left.parent.createdAt ?? 0) - Number(right.parent.createdAt ?? 0),
    );
    const canonical = sortedParents[0];
    if (!canonical) continue;
    const duplicates = sortedParents.slice(1);
    const versions = sortedParents
      .flatMap((row) => row.versions)
      .sort((left, right) =>
        Number(left.issuedAt ?? left.createdAt) - Number(right.issuedAt ?? right.createdAt),
      );
    const latest = versions[versions.length - 1];
    mergedGroups.push({
      normalizedName: canonical.identity.normalizedName,
      canonicalPolicyCertificateId: canonical.parent._id,
      archivedPolicyCertificateIds: duplicates.map((row) => row.parent._id),
      versionIds: versions.map((version) => version._id),
      latestVersionId: latest?._id,
    });
    if (dryRun || !latest) continue;

    for (const [index, version] of versions.entries()) {
      const isLatest = version._id === latest._id;
      await ctx.db.patch(version._id, {
        certificateId: canonical.parent._id,
        holderId: canonical.parent.holderId,
        versionNumber: index + 1,
        status: isLatest ? "issued" : "superseded",
        supersededAt: isLatest ? undefined : version.supersededAt ?? now,
        updatedAt: now,
      });
      if (version.certificateId !== canonical.parent._id) movedVersions += 1;
    }
    for (const duplicate of duplicates) {
      await ctx.db.patch(duplicate.parent._id, {
        status: "archived",
        currentVersionId: undefined,
        latestIssuedVersionId: undefined,
        updatedAt: now,
      });
      archivedParents += 1;
    }
    await ctx.db.patch(canonical.parent._id, {
      currentVersionId: latest._id,
      latestIssuedVersionId: latest._id,
      lastIssuedAt: latest.issuedAt ?? latest.createdAt,
      updatedAt: now,
    });
  }

  return {
    dryRun,
    policyId: args.policyId,
    mergeGroups: mergedGroups,
    ambiguousGroups,
    archivedParents,
    movedVersions,
  };
}

export const cleanupDuplicatePolicyCertificatesForOperator = mutation({
  args: {
    policyId: v.id("policies"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await cleanupDuplicatePolicyCertificates(ctx, args);
  },
});

export const cleanupDuplicatePolicyCertificatesInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await cleanupDuplicatePolicyCertificates(ctx, args);
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
    holderContactName: v.optional(v.string()),
    holderEmail: v.optional(v.string()),
    holderPhone: v.optional(v.string()),
    holderAddress: v.optional(v.any()),
    policySnapshot: v.optional(v.any()),
    policySnapshotHash: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    requestKind: v.optional(certificateRequestKindValidator),
    additionalInsuredName: v.optional(v.string()),
    formCode: v.optional(certificateFormCodeValidator),
    requestSignature: v.optional(v.string()),
    descriptionOfOperations: v.optional(v.string()),
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
        contactName: args.holderContactName,
        email: args.holderEmail,
        phone: args.holderPhone,
        address: args.holderAddress,
      }),
      policySnapshot: args.policySnapshot,
      policySnapshotHash: args.policySnapshotHash,
      source: args.source,
      requestKind: args.requestKind ?? "holder",
      additionalInsuredName: args.additionalInsuredName,
      formCode: args.formCode,
      requestSignature: args.requestSignature,
      descriptionOfOperations: args.descriptionOfOperations,
      issuedAt: now,
      createdByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.certificateId, {
      currentVersionId: versionId,
      latestIssuedVersionId: versionId,
      formCode: args.formCode,
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
