import dayjs from "dayjs";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  holderSnapshot,
  normalizeCertificateHolderAddress,
  normalizeCertificateHolderName,
  policyCertificateDedupeKey,
  type CertificateHolderAddressInput,
} from "./lib/certificateIdentity";
import { buildPolicyVersionSnapshot, policyVersionSummary } from "./lib/policyVersioning";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type Counts = {
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

function emptyCounts(): Counts {
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

function cleanLine(value: unknown) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text || undefined;
}

function parseLegacyHolder(certificate: Doc<"certificates">) {
  const lines = typeof certificate.certificateHolder === "string"
    ? certificate.certificateHolder.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const displayName = cleanLine(certificate.certificateHolderName) ?? cleanLine(lines[0]);
  if (!displayName) return null;
  const addressLines = lines.slice(
    cleanLine(certificate.certificateHolderName) && normalizeCertificateHolderName(lines[0] ?? "") === normalizeCertificateHolderName(certificate.certificateHolderName ?? "")
      ? 1
      : 0,
  );
  const formatted = addressLines.join("\n").trim() || undefined;
  const address = formatted ? { formatted } : undefined;
  return { displayName, address };
}

async function ensurePolicyVersion(ctx: MutationCtx, policy: Doc<"policies">, now: number, dryRun: boolean) {
  if (policy.currentPolicyVersionId) {
    const current = await ctx.db.get(policy.currentPolicyVersionId);
    if (current) return { id: current._id as Id<"policyVersions">, created: false };
  }
  const existing = await ctx.db
    .query("policyVersions")
    .withIndex("by_policyId_versionNumber", (q) => q.eq("policyId", policy._id))
    .order("desc")
    .first();
  if (existing) return { id: existing._id as Id<"policyVersions">, created: false };
  if (dryRun) return { id: undefined, created: true };
  if (!policy.orgId) throw new Error("Policy is missing orgId");

  const snapshot = buildPolicyVersionSnapshot(policy as unknown as Record<string, unknown>);
  const id = await ctx.db.insert("policyVersions", {
    orgId: policy.orgId,
    policyId: policy._id,
    versionNumber: 1,
    versionKind: "new_policy",
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    policyNumber: policy.policyNumber,
    sourceFileIds: policy.fileId ? [policy.fileId] : undefined,
    snapshot,
    fieldDiffs: [],
    summary: policyVersionSummary(policy as unknown as Record<string, unknown>, "Initial policy"),
    createdAt: now,
  });
  await ctx.db.patch(policy._id, { currentPolicyVersionId: id });
  return { id: id as Id<"policyVersions">, created: true };
}

async function ensureHolder(ctx: MutationCtx, args: {
  orgId: Id<"organizations">;
  displayName: string;
  address?: CertificateHolderAddressInput;
  now: number;
  dryRun: boolean;
}) {
  const normalizedName = normalizeCertificateHolderName(args.displayName);
  const normalizedAddressKey = normalizeCertificateHolderAddress(args.address);
  const existing = await ctx.db
    .query("certificateHolders")
    .withIndex("by_orgId_normalizedName", (q) =>
      q.eq("orgId", args.orgId).eq("normalizedName", normalizedName),
    )
    .collect()
    .then((holders: Array<Doc<"certificateHolders">>) =>
      holders.find((holder) => (holder.normalizedAddressKey ?? "") === (normalizedAddressKey ?? "")),
    );
  if (existing) return { id: existing._id as Id<"certificateHolders">, created: false };
  if (args.dryRun) return { id: undefined, created: true };
  const id = await ctx.db.insert("certificateHolders", {
    orgId: args.orgId,
    displayName: args.displayName,
    normalizedName,
    address: args.address,
    normalizedAddressKey,
    source: "migration",
    createdAt: args.now,
    updatedAt: args.now,
  });
  return { id: id as Id<"certificateHolders">, created: true };
}

async function ensureParent(ctx: MutationCtx, args: {
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  holderId?: Id<"certificateHolders">;
  now: number;
  dryRun: boolean;
}) {
  if (!args.holderId) return { id: undefined, created: true, parent: null };
  const dedupeKey = policyCertificateDedupeKey({
    orgId: String(args.orgId),
    policyId: String(args.policyId),
    holderId: String(args.holderId),
  });
  const existing = await ctx.db
    .query("policyCertificates")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .first();
  if (existing) return { id: existing._id as Id<"policyCertificates">, created: false, parent: existing };
  if (args.dryRun) return { id: undefined, created: true, parent: null };
  const id = await ctx.db.insert("policyCertificates", {
    orgId: args.orgId,
    policyId: args.policyId,
    holderId: args.holderId,
    status: "active",
    dedupeKey,
    source: "unknown",
    createdAt: args.now,
    updatedAt: args.now,
  });
  return { id: id as Id<"policyCertificates">, created: true, parent: null };
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
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const dryRun = args.dryRun ?? true;
    const page = await ctx.db
      .query("certificates")
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    const counts = emptyCounts();
    const samples: Array<{ certificateId: Id<"certificates">; status: string; reason?: string }> = [];
    const now = dayjs().valueOf();

    for (const certificate of page.page) {
      if (args.orgId && certificate.orgId !== args.orgId) continue;
      counts.scanned += 1;
      try {
        const existingVersion = await ctx.db
          .query("certificateVersions")
          .withIndex("by_legacyCertificateId", (q) => q.eq("legacyCertificateId", certificate._id))
          .first();
        if (existingVersion && !args.includeAlreadyProcessed) {
          counts.skipped += 1;
          continue;
        }
        const [policy, parsedHolder] = await Promise.all([
          ctx.db.get(certificate.policyId),
          Promise.resolve(parseLegacyHolder(certificate)),
        ]);
        if (!policy || policy.orgId !== certificate.orgId) {
          counts.errors += 1;
          samples.push({ certificateId: certificate._id, status: "error", reason: "Policy missing or org mismatch" });
          continue;
        }
        if (!parsedHolder) {
          counts.ambiguous += 1;
          samples.push({ certificateId: certificate._id, status: "ambiguous", reason: "Missing certificate holder name" });
          continue;
        }

        const policyVersion = await ensurePolicyVersion(ctx, policy, now, dryRun);
        const holder = await ensureHolder(ctx, {
          orgId: certificate.orgId,
          displayName: parsedHolder.displayName,
          address: parsedHolder.address,
          now,
          dryRun,
        });
        const parent = await ensureParent(ctx, {
          orgId: certificate.orgId,
          policyId: certificate.policyId,
          holderId: holder.id,
          now,
          dryRun,
        });
        if (policyVersion.created) counts.policyVersionsCreated += 1;
        if (holder.created) counts.holdersCreated += 1;
        if (parent.created) counts.parentsCreated += 1;

        if (dryRun) {
          counts.migrated += 1;
          counts.versionsCreated += 1;
          continue;
        }
        if (!policyVersion.id || !holder.id || !parent.id) {
          throw new Error("Backfill did not resolve required lifecycle ids");
        }

        const lastIssuedAt = parent.parent?.lastIssuedAt ?? 0;
        const willBeLatest = certificate.createdAt >= lastIssuedAt;
        if (willBeLatest) {
          const issuedVersions = await ctx.db
            .query("certificateVersions")
            .withIndex("by_certificateId", (q) => q.eq("certificateId", parent.id))
            .filter((q) => q.eq(q.field("status"), "issued"))
            .collect();
          for (const version of issuedVersions) {
            await ctx.db.patch(version._id, {
              status: "superseded",
              supersededAt: now,
              updatedAt: now,
            });
          }
        }
        const latestVersion = await ctx.db
          .query("certificateVersions")
          .withIndex("by_certificateId_versionNumber", (q) => q.eq("certificateId", parent.id))
          .order("desc")
          .first();
        const versionId = await ctx.db.insert("certificateVersions", {
          orgId: certificate.orgId,
          certificateId: parent.id,
          holderId: holder.id,
          policyId: certificate.policyId,
          policyVersionId: policyVersion.id,
          versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
          status: willBeLatest ? "issued" : "superseded",
          fileId: certificate.fileId,
          fileName: certificate.fileName,
          certificateHolder: certificate.certificateHolder,
          certificateHolderName: certificate.certificateHolderName,
          holderSnapshot: holderSnapshot({
            displayName: parsedHolder.displayName,
            address: parsedHolder.address,
          }),
          policySnapshot: buildPolicyVersionSnapshot(policy as unknown as Record<string, unknown>),
          source: certificate.source ?? "unknown",
          authorityType: certificate.authorityType ?? "non_binding",
          certificationStatus: certificate.certificationStatus ?? "not_applicable",
          partnerOrgId: certificate.partnerOrgId,
          partnerProgramId: certificate.partnerProgramId,
          templateId: certificate.templateId,
          standingAuthorizationId: certificate.standingAuthorizationId,
          approvalMode: certificate.approvalMode,
          approvalAudit: certificate.approvalAudit,
          disclaimer: certificate.disclaimer,
          legacyCertificateId: certificate._id,
          issuedAt: certificate.createdAt,
          supersededAt: willBeLatest ? undefined : now,
          createdByUserId: certificate.createdByUserId,
          createdAt: now,
          updatedAt: now,
        });
        if (willBeLatest) {
          await ctx.db.patch(parent.id, {
            currentVersionId: versionId,
            latestIssuedVersionId: versionId,
            lastIssuedAt: certificate.createdAt,
            updatedAt: now,
          });
        }
        counts.migrated += 1;
        counts.versionsCreated += 1;
      } catch (error) {
        counts.errors += 1;
        samples.push({
          certificateId: certificate._id,
          status: "error",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      dryRun,
      nextCursor: page.continueCursor,
      isDone: page.isDone,
      counts,
      samples: samples.slice(0, 25),
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
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = await ctx.db
      .query("certificates")
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    const summary = {
      scanned: 0,
      linked: 0,
      ambiguous: 0,
      missingLifecycle: 0,
    };
    const missing: Array<{ certificateId: Id<"certificates">; reason: string }> = [];
    for (const certificate of page.page) {
      if (args.orgId && certificate.orgId !== args.orgId) continue;
      summary.scanned += 1;
      const holder = parseLegacyHolder(certificate);
      if (!holder) {
        summary.ambiguous += 1;
        continue;
      }
      const version = await ctx.db
        .query("certificateVersions")
        .withIndex("by_legacyCertificateId", (q) => q.eq("legacyCertificateId", certificate._id))
        .first();
      if (!version) {
        summary.missingLifecycle += 1;
        missing.push({ certificateId: certificate._id, reason: "Missing certificate version" });
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
