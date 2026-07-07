import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { buildCoverageBreakdown } from "./lib/coverageBreakdown";
import { getClientPortalUrl } from "./lib/domains";
import { lobLabel, policyLobCodes } from "./lib/linesOfBusiness";

const appCardKindValidator = v.union(
  v.literal("policy"),
  v.literal("certificate"),
  v.literal("policy_change"),
);

async function sha256Hex(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function policyTitle(policy: Pick<Doc<"policies">, "policyNumber" | "linesOfBusiness" | "policyTypes" | "fileName">) {
  if (policy.policyNumber) return `Policy ${policy.policyNumber}`;
  const lines = policyLobCodes(policy).filter((code) => code !== "UN").map(lobLabel);
  if (lines.length > 0) return lines.join(", ");
  return policy.fileName ?? "Policy details";
}

function policySubtitle(policy: Pick<Doc<"policies">, "insuredName" | "security" | "carrier">) {
  return [policy.insuredName, policy.security ?? policy.carrier]
    .filter(Boolean)
    .join(" - ");
}

function formatCoverage(coverage: Doc<"policies">["coverages"][number]) {
  return {
    name: coverage.name,
    limit: coverage.limit,
    deductible: coverage.deductible,
  };
}

function publicPolicy(policy: Doc<"policies">) {
  return {
    id: policy._id,
    title: policyTitle(policy),
    insuredName: policy.insuredName,
    carrier: policy.security ?? policy.carrier,
    policyNumber: policy.policyNumber,
    linesOfBusiness: policyLobCodes(policy),
    policyTypes: policyLobCodes(policy),
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    dataStage: policy.extractionDataStage ?? (
      policy.pipelineStatus === "complete" ? "final" : "placeholder"
    ),
    coverageBreakdown: buildCoverageBreakdown(policy),
    coverages: policy.coverages.slice(0, 12).map(formatCoverage),
  };
}

function publicPolicyChange(changeCase: Doc<"policyChangeCases">) {
  const pendingQuestions = Array.isArray(changeCase.pendingQuestions)
    ? changeCase.pendingQuestions.filter((item): item is string => typeof item === "string")
    : [];
  const missingInfoQuestions = Array.isArray(changeCase.missingInfoQuestions)
    ? changeCase.missingInfoQuestions.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: changeCase._id,
    status: changeCase.status,
    requestText: truncate(changeCase.requestText, 1200),
    summary: truncate(changeCase.summary, 800),
    pendingQuestions: [...pendingQuestions, ...missingInfoQuestions].slice(0, 8),
    createdAt: changeCase.createdAt,
    updatedAt: changeCase.updatedAt,
  };
}

async function getPolicyForLink(
  ctx: QueryCtx,
  policyId: Id<"policies"> | undefined,
  orgId: Id<"organizations">,
) {
  if (!policyId) return null;
  const policy = await ctx.db.get(policyId);
  if (!policy || String(policy.orgId) !== String(orgId)) return null;
  return policy;
}

async function buildCertificateView(
  ctx: QueryCtx,
  link: Doc<"appCardAccessLinks">,
) {
  let certificate: {
    id: Id<"certificates"> | Id<"certificateVersions">;
    policyId: Id<"policies">;
    fileName: string;
    certificateHolder?: string;
    certificateHolderName?: string;
    fileUrl?: string | null;
    versionNumber?: number;
    createdAt: number;
  } | null = null;
  let policyCertificate: Doc<"policyCertificates"> | null = null;
  let certificateVersion: Doc<"certificateVersions"> | null = null;

  if (link.certificateId) {
    const legacyCertificate = await ctx.db.get(link.certificateId);
    if (!legacyCertificate || String(legacyCertificate.orgId) !== String(link.orgId)) {
      return null;
    }
    certificate = {
      id: legacyCertificate._id,
      policyId: legacyCertificate.policyId,
      fileName: legacyCertificate.fileName,
      certificateHolder: legacyCertificate.certificateHolder,
      certificateHolderName: legacyCertificate.certificateHolderName,
      fileUrl: await ctx.storage.getUrl(legacyCertificate.fileId),
      createdAt: legacyCertificate.createdAt,
    };
  }

  if (link.certificateVersionId) {
    certificateVersion = await ctx.db.get(link.certificateVersionId);
  }
  if (!certificateVersion && link.policyCertificateId) {
    policyCertificate = await ctx.db.get(link.policyCertificateId);
    const versionId =
      policyCertificate?.currentVersionId ??
      policyCertificate?.latestIssuedVersionId;
    certificateVersion = versionId ? await ctx.db.get(versionId) : null;
  }
  if (certificateVersion) {
    if (String(certificateVersion.orgId) !== String(link.orgId)) return null;
    policyCertificate =
      policyCertificate ?? (await ctx.db.get(certificateVersion.certificateId));
    certificate = {
      id: certificateVersion._id,
      policyId: certificateVersion.policyId,
      fileName: certificateVersion.fileName ?? "certificate-of-insurance.pdf",
      certificateHolder: certificateVersion.certificateHolder,
      certificateHolderName: certificateVersion.certificateHolderName,
      fileUrl: certificateVersion.fileId
        ? await ctx.storage.getUrl(certificateVersion.fileId)
        : null,
      versionNumber: certificateVersion.versionNumber,
      createdAt: certificateVersion.createdAt,
    };
  }

  if (!certificate) return null;
  const policy = await getPolicyForLink(ctx, certificate.policyId, link.orgId);
  if (!policy) return null;

  const holderName =
    certificate.certificateHolderName ??
    certificate.certificateHolder?.split(/\r?\n/)[0]?.trim() ??
    "Certificate holder";
  return {
    title: `Certificate for ${holderName}`,
    subtitle: policyTitle(policy),
    certificate: {
      id: certificate.id,
      holderName,
      fileName: certificate.fileName,
      fileUrl: certificate.fileUrl ?? null,
      versionNumber: certificate.versionNumber,
      policyCertificateId: policyCertificate?._id,
      createdAt: certificate.createdAt,
    },
    policy: publicPolicy(policy),
  };
}

async function resolveOrgIdForCreate(
  ctx: MutationCtx,
  args: {
    kind: "policy" | "certificate" | "policy_change";
    orgId?: Id<"organizations">;
    policyId?: Id<"policies">;
    certificateId?: Id<"certificates">;
    policyCertificateId?: Id<"policyCertificates">;
    certificateVersionId?: Id<"certificateVersions">;
    policyChangeCaseId?: Id<"policyChangeCases">;
  },
) {
  if (args.kind === "policy") {
    if (!args.policyId) throw new Error("policyId is required for policy app cards.");
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) throw new Error("Policy not found.");
    return policy.orgId;
  }
  if (args.kind === "certificate") {
    if (args.certificateId) {
      const certificate = await ctx.db.get(args.certificateId);
      if (!certificate) throw new Error("Certificate not found.");
      return certificate.orgId;
    }
    if (args.certificateVersionId) {
      const version = await ctx.db.get(args.certificateVersionId);
      if (!version) throw new Error("Certificate version not found.");
      return version.orgId;
    }
    if (args.policyCertificateId) {
      const certificate = await ctx.db.get(args.policyCertificateId);
      if (!certificate) throw new Error("Policy certificate not found.");
      return certificate.orgId;
    }
    throw new Error("certificateId, policyCertificateId, or certificateVersionId is required.");
  }
  if (!args.policyChangeCaseId) {
    throw new Error("policyChangeCaseId is required for policy change app cards.");
  }
  const changeCase = await ctx.db.get(args.policyChangeCaseId);
  if (!changeCase) throw new Error("Policy change case not found.");
  return changeCase.orgId;
}

export const createInternal = internalMutation({
  args: {
    kind: appCardKindValidator,
    orgId: v.optional(v.id("organizations")),
    policyId: v.optional(v.id("policies")),
    certificateId: v.optional(v.id("certificates")),
    policyCertificateId: v.optional(v.id("policyCertificates")),
    certificateVersionId: v.optional(v.id("certificateVersions")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    label: v.optional(v.string()),
    sourceThreadId: v.optional(v.id("threads")),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const resolvedOrgId = await resolveOrgIdForCreate(ctx, args);
    if (args.orgId && String(args.orgId) !== String(resolvedOrgId)) {
      throw new Error("App card resource does not belong to the requested organization.");
    }

    const token = randomToken();
    const now = dayjs().valueOf();
    await ctx.db.insert("appCardAccessLinks", {
      orgId: resolvedOrgId,
      tokenHash: await sha256Hex(token),
      kind: args.kind,
      policyId: args.policyId,
      certificateId: args.certificateId,
      policyCertificateId: args.policyCertificateId,
      certificateVersionId: args.certificateVersionId,
      policyChangeCaseId: args.policyChangeCaseId,
      label: args.label,
      sourceThreadId: args.sourceThreadId,
      sourceThreadMessageId: args.sourceThreadMessageId,
      createdByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });

    const url = `${getClientPortalUrl()}/share/imessage/${token}`;
    return { url, token, kind: args.kind, label: args.label };
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) return null;
    const tokenHash = await sha256Hex(token);
    const link = await ctx.db
      .query("appCardAccessLinks")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!link) return null;

    const org = await ctx.db.get(link.orgId);
    if (!org) return null;

    if (link.kind === "policy") {
      const policy = await getPolicyForLink(ctx, link.policyId, link.orgId);
      if (!policy) return null;
      return {
        kind: link.kind,
        orgName: org.name,
        title: policyTitle(policy),
        subtitle: policySubtitle(policy),
        label: link.label,
        policy: publicPolicy(policy),
      };
    }

    if (link.kind === "certificate") {
      const certificateView = await buildCertificateView(ctx, link);
      if (!certificateView) return null;
      return {
        kind: link.kind,
        orgName: org.name,
        label: link.label,
        ...certificateView,
      };
    }

    if (!link.policyChangeCaseId) return null;
    const changeCase = await ctx.db.get(link.policyChangeCaseId);
    if (!changeCase || String(changeCase.orgId) !== String(link.orgId)) {
      return null;
    }
    const policy =
      changeCase.policyId
        ? await getPolicyForLink(ctx, changeCase.policyId, link.orgId)
        : null;
    return {
      kind: link.kind,
      orgName: org.name,
      title: "Broker follow-up",
      subtitle: policy ? policyTitle(policy) : undefined,
      label: link.label,
      policyChange: publicPolicyChange(changeCase),
      policy: policy ? publicPolicy(policy) : null,
    };
  },
});
