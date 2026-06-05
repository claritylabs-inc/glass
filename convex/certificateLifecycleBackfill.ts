import dayjs from "dayjs";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type AnyId = Id<any>;
type LegacyCertificate = Doc<"certificates"> & Record<string, any>;
type PolicyDoc = Doc<"policies"> & Record<string, any>;

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

type BackfillCounts = {
  scanned: number;
  migrated: number;
  skipped: number;
  ambiguous: number;
  errors: number;
  holdersCreated: number;
  parentsCreated: number;
  versionsCreated: number;
  policyVersionsCreated: number;
};

type ParsedHolder = {
  name: string;
  address?: string;
  normalizedName: string;
  normalizedAddress?: string;
};

function emptyCounts(): BackfillCounts {
  return {
    scanned: 0,
    migrated: 0,
    skipped: 0,
    ambiguous: 0,
    errors: 0,
    holdersCreated: 0,
    parentsCreated: 0,
    versionsCreated: 0,
    policyVersionsCreated: 0,
  };
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

function cleanLine(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text || undefined;
}

function compactAddress(lines: string[]): string | undefined {
  const address = lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return address || undefined;
}

function parseLegacyHolder(certificate: LegacyCertificate): ParsedHolder | null {
  const fullHolderLines = typeof certificate.certificateHolder === "string"
    ? certificate.certificateHolder
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const explicitName = cleanLine(certificate.certificateHolderName);
  const name = explicitName ?? cleanLine(fullHolderLines[0]);
  if (!name) return null;

  const addressLines = fullHolderLines.length > 0
    ? fullHolderLines.slice(explicitName && normalizeText(fullHolderLines[0]) === normalizeText(explicitName) ? 1 : 0)
    : [];
  const address = compactAddress(addressLines);
  const normalizedName = normalizeText(name);
  if (!normalizedName) return null;
  return {
    name,
    address,
    normalizedName,
    normalizedAddress: normalizeText(address),
  };
}

function appendLegacyId(existing: Array<AnyId> | undefined, id: AnyId): Array<AnyId> {
  return existing?.some((item) => item === id) ? existing : [...(existing ?? []), id];
}

function legacyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getCurrentPolicyVersion(ctx: any, policy: PolicyDoc, now: number, dryRun: boolean) {
  const existing = await ctx.db
    .query("policyVersions")
    .withIndex("by_policyId", (q: any) => q.eq("policyId", policy._id))
    .filter((q: any) => q.eq(q.field("status"), "current"))
    .first();
  if (existing) return { policyVersionId: existing._id as AnyId, created: false };

  if (dryRun) return { policyVersionId: undefined, created: true };

  const policyVersionId = await ctx.db.insert("policyVersions", {
    orgId: policy.orgId,
    policyId: policy._id,
    versionNumber: 1,
    status: "current",
    sourceKind: "legacy_backfill",
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    policyNumber: policy.policyNumber,
    snapshot: {
      displayName: policy.displayName,
      policyNumber: policy.policyNumber,
      policyTypes: policy.policyTypes,
      carrier: policy.carrier,
      security: policy.security,
      insuredName: policy.insuredName,
      effectiveDate: policy.effectiveDate,
      expirationDate: policy.expirationDate,
      limits: policy.limits,
      coverages: policy.coverages,
      operationalProfile: policy.operationalProfile,
    },
    createdAt: now,
    updatedAt: now,
  });
  return { policyVersionId: policyVersionId as AnyId, created: true };
}

async function findOrCreateHolder(ctx: any, certificate: LegacyCertificate, holder: ParsedHolder, now: number, dryRun: boolean) {
  const candidates = await ctx.db
    .query("certificateHolders")
    .withIndex("by_orgId_normalizedName", (q: any) =>
      q.eq("orgId", certificate.orgId).eq("normalizedName", holder.normalizedName),
    )
    .collect();
  const existing = candidates.find(
    (candidate: any) => (candidate.normalizedAddress ?? "") === (holder.normalizedAddress ?? ""),
  );
  if (existing) {
    if (!dryRun) {
      await ctx.db.patch(existing._id, {
        legacyCertificateIds: appendLegacyId(existing.legacyCertificateIds, certificate._id),
        updatedAt: now,
      });
    }
    return { holderId: existing._id as AnyId, created: false };
  }

  if (dryRun) return { holderId: undefined, created: true };
  const holderId = await ctx.db.insert("certificateHolders", {
    orgId: certificate.orgId,
    name: holder.name,
    normalizedName: holder.normalizedName,
    address: holder.address,
    normalizedAddress: holder.normalizedAddress,
    source: "legacy_certificate",
    legacyCertificateIds: [certificate._id],
    createdAt: now,
    updatedAt: now,
  });
  return { holderId: holderId as AnyId, created: true };
}

async function findOrCreateParent(
  ctx: any,
  certificate: LegacyCertificate,
  holderId: AnyId | undefined,
  now: number,
  dryRun: boolean,
) {
  if (!holderId) return { parentId: undefined, created: true, existingVersionCount: 0 };
  const existing = await ctx.db
    .query("certificateParents")
    .withIndex("by_orgId_policyId_holderId", (q: any) =>
      q.eq("orgId", certificate.orgId).eq("policyId", certificate.policyId).eq("certificateHolderId", holderId),
    )
    .first();
  if (existing) {
    const versions = await ctx.db
      .query("certificateVersions")
      .withIndex("by_parentId", (q: any) => q.eq("certificateParentId", existing._id))
      .collect();
    if (!dryRun) {
      await ctx.db.patch(existing._id, {
        legacyCertificateIds: appendLegacyId(existing.legacyCertificateIds, certificate._id),
        updatedAt: now,
      });
    }
    return {
      parentId: existing._id as AnyId,
      created: false,
      existingVersionCount: versions.length,
      latestIssuedAt: existing.latestIssuedAt,
    };
  }

  if (dryRun) return { parentId: undefined, created: true, existingVersionCount: 0, latestIssuedAt: undefined };
  const parentId = await ctx.db.insert("certificateParents", {
    orgId: certificate.orgId,
    policyId: certificate.policyId,
    certificateHolderId: holderId,
    status: "active",
    legacyCertificateIds: [certificate._id],
    createdAt: now,
    updatedAt: now,
  });
  return { parentId: parentId as AnyId, created: true, existingVersionCount: 0, latestIssuedAt: undefined };
}

async function markLegacyCertificate(
  ctx: any,
  certificateId: AnyId,
  status: "migrated" | "ambiguous" | "skipped" | "error",
  now: number,
  patch: Record<string, unknown> = {},
  dryRun: boolean,
) {
  if (dryRun) return;
  await ctx.db.patch(certificateId, {
    ...patch,
    lifecycleBackfillStatus: status,
    lifecycleBackfilledAt: now,
  });
}

export const backfillLegacyCertificates = mutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    orgId: v.optional(v.id("organizations")),
    includeAlreadyProcessed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    const dryRun = args.dryRun ?? false;
    const now = dayjs().valueOf();
    const counts = emptyCounts();
    const samples: Array<{ certificateId: AnyId; status: string; reason?: string }> = [];

    const page = await ctx.db
      .query("certificates")
      .paginate({ cursor: args.cursor ?? null, numItems: limit });

    for (const certificate of page.page as Array<LegacyCertificate>) {
      if (args.orgId && certificate.orgId !== args.orgId) continue;
      counts.scanned += 1;
      try {
        if (!args.includeAlreadyProcessed && certificate.certificateVersionId) {
          counts.skipped += 1;
          continue;
        }
        const existingVersion = await ctx.db
          .query("certificateVersions")
          .withIndex("by_legacyCertificateId", (q: any) => q.eq("legacyCertificateId", certificate._id))
          .first();
        if (existingVersion && !args.includeAlreadyProcessed) {
          counts.skipped += 1;
          await markLegacyCertificate(ctx, certificate._id, "skipped", now, {
            certificateHolderId: existingVersion.certificateHolderId,
            certificateParentId: existingVersion.certificateParentId,
            certificateVersionId: existingVersion._id,
          }, dryRun);
          continue;
        }

        const [policy, holder] = await Promise.all([
          ctx.db.get(certificate.policyId) as Promise<PolicyDoc | null>,
          Promise.resolve(parseLegacyHolder(certificate)),
        ]);
        if (!policy) {
          counts.errors += 1;
          samples.push({ certificateId: certificate._id, status: "error", reason: "Policy not found" });
          await markLegacyCertificate(ctx, certificate._id, "error", now, {
            lifecycleBackfillError: "Policy not found",
          }, dryRun);
          continue;
        }
        if (policy.orgId !== certificate.orgId) {
          counts.errors += 1;
          samples.push({ certificateId: certificate._id, status: "error", reason: "Certificate org does not match policy org" });
          await markLegacyCertificate(ctx, certificate._id, "error", now, {
            lifecycleBackfillError: "Certificate org does not match policy org",
          }, dryRun);
          continue;
        }
        if (!holder) {
          counts.ambiguous += 1;
          samples.push({ certificateId: certificate._id, status: "ambiguous", reason: "Missing certificate holder name" });
          await markLegacyCertificate(ctx, certificate._id, "ambiguous", now, {
            lifecycleBackfillError: "Missing certificate holder name; legacy certificate remains visible in activity.",
          }, dryRun);
          continue;
        }

        const policyVersion = await getCurrentPolicyVersion(ctx, policy, now, dryRun);
        if (policyVersion.created) counts.policyVersionsCreated += 1;
        const holderResult = await findOrCreateHolder(ctx, certificate, holder, now, dryRun);
        if (holderResult.created) counts.holdersCreated += 1;
        const parentResult = await findOrCreateParent(ctx, certificate, holderResult.holderId, now, dryRun);
        if (parentResult.created) counts.parentsCreated += 1;

        if (dryRun) {
          counts.migrated += 1;
          counts.versionsCreated += 1;
          continue;
        }
        if (!policyVersion.policyVersionId || !holderResult.holderId || !parentResult.parentId) {
          throw new Error("Lifecycle IDs were not resolved for a non-dry-run migration.");
        }

        const versionId = await ctx.db.insert("certificateVersions", {
          orgId: certificate.orgId,
          policyId: certificate.policyId,
          policyVersionId: policyVersion.policyVersionId,
          certificateParentId: parentResult.parentId,
          certificateHolderId: holderResult.holderId,
          versionNumber: parentResult.existingVersionCount + 1,
          status: "issued",
          fileId: certificate.fileId,
          fileName: certificate.fileName,
          legacyCertificateId: certificate._id,
          source: certificate.source ?? "legacy_backfill",
          authorityType: certificate.authorityType,
          certificationStatus: certificate.certificationStatus,
          partnerOrgId: certificate.partnerOrgId,
          partnerProgramId: certificate.partnerProgramId,
          templateId: certificate.templateId,
          standingAuthorizationId: certificate.standingAuthorizationId,
          approvalId: certificate.approvalId,
          approvalMode: certificate.approvalMode,
          approvalAudit: certificate.approvalAudit,
          disclaimer: certificate.disclaimer,
          issuedAt: certificate.createdAt,
          createdByUserId: certificate.createdByUserId,
          createdAt: now,
        });
        if (parentResult.latestIssuedAt === undefined || certificate.createdAt >= parentResult.latestIssuedAt) {
          await ctx.db.patch(parentResult.parentId, {
            latestVersionId: versionId,
            latestIssuedAt: certificate.createdAt,
            updatedAt: now,
          });
        }
        await markLegacyCertificate(ctx, certificate._id, "migrated", now, {
          certificateHolderId: holderResult.holderId,
          certificateParentId: parentResult.parentId,
          certificateVersionId: versionId,
          lifecycleBackfillError: undefined,
        }, false);
        counts.migrated += 1;
        counts.versionsCreated += 1;
      } catch (error) {
        counts.errors += 1;
        const message = legacyError(error);
        samples.push({ certificateId: certificate._id, status: "error", reason: message });
        await markLegacyCertificate(ctx, certificate._id, "error", now, {
          lifecycleBackfillError: message,
        }, dryRun);
      }
    }

    return {
      dryRun,
      nextCursor: page.continueCursor,
      isDone: page.isDone,
      counts,
      samples,
    };
  },
});

export const verifyLegacyCertificateBackfill = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    const page = await ctx.db
      .query("certificates")
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    const summary = {
      scanned: 0,
      linked: 0,
      ambiguous: 0,
      skipped: 0,
      errors: 0,
      missingLifecycle: 0,
    };
    const missing: Array<{ certificateId: AnyId; reason: string }> = [];

    for (const certificate of page.page as Array<LegacyCertificate>) {
      if (args.orgId && certificate.orgId !== args.orgId) continue;
      summary.scanned += 1;
      if (certificate.lifecycleBackfillStatus === "ambiguous") {
        summary.ambiguous += 1;
        continue;
      }
      if (certificate.lifecycleBackfillStatus === "skipped") {
        summary.skipped += 1;
        continue;
      }
      if (certificate.lifecycleBackfillStatus === "error") {
        summary.errors += 1;
        missing.push({ certificateId: certificate._id, reason: certificate.lifecycleBackfillError ?? "Backfill error" });
        continue;
      }
      if (!certificate.certificateHolderId || !certificate.certificateParentId || !certificate.certificateVersionId) {
        summary.missingLifecycle += 1;
        missing.push({ certificateId: certificate._id, reason: "Missing holder, parent, or version link" });
        continue;
      }
      const version = await ctx.db.get(certificate.certificateVersionId);
      if (!version || version.legacyCertificateId !== certificate._id) {
        summary.missingLifecycle += 1;
        missing.push({ certificateId: certificate._id, reason: "Linked certificate version is missing or not tied to legacy row" });
        continue;
      }
      summary.linked += 1;
    }

    return {
      nextCursor: page.continueCursor,
      isDone: page.isDone,
      summary,
      missing: missing.slice(0, 25),
    };
  },
});
