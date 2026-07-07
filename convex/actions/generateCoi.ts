"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateCoiPdf, policyToCoiData } from "../lib/coiGenerator";
import { logAiError } from "../lib/aiUtils";
import { generateObjectForOrg } from "../lib/models";
import {
  CERTIFICATE_FORM_FILE_SLUGS,
  CERTIFICATE_FORM_LABELS,
  type CertificateFormCode,
} from "../lib/acordForms/types";
import { selectCertificateForm } from "../lib/acordForms/select";
import {
  applyEndorsementsToCertificateData,
  type EndorsementCitation,
} from "../lib/certificateEndorsements";
import {
  CertificateDescriptionSchema,
  buildCertificateDescriptionContext,
  buildCertificateDescriptionFallback,
  buildCertificateDescriptionPrompt,
  certificateDescriptionSystemPrompt,
  hasCertificateDescriptionContext,
  isUsableCertificateDescription,
  normalizeCertificateDescription,
} from "../lib/certificateDescription";

const holderAddressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const certificateFormValidator = v.union(
  v.literal("acord25"),
  v.literal("acord24"),
  v.literal("acord27"),
  v.literal("acord28"),
  v.literal("acord29"),
  v.literal("acord30"),
  v.literal("acord31"),
);

const endorsementCitationValidator = v.object({
  kind: v.union(
    v.literal("additional_insured"),
    v.literal("named_insured"),
    v.literal("waiver_of_subrogation"),
    v.literal("primary_non_contributory"),
    v.literal("loss_payee"),
    v.literal("mortgagee"),
    v.literal("special_wording"),
    v.literal("policy_change"),
  ),
  formNumbers: v.array(v.string()),
  requiresWrittenContract: v.optional(v.boolean()),
});

function firstCertificateHolderLine(certificateHolder?: string, fallback = "Certificate holder") {
  return certificateHolder?.split(/\r?\n/)[0]?.trim() || fallback;
}

async function ensureCertificateLifecycleContext(
  ctx: any,
  args: {
    orgId: Id<"organizations">;
    policyId: Id<"policies">;
    certificateHolder?: string;
    certificateHolderName?: string;
    certificateHolderId?: Id<"certificateHolders">;
    policyCertificateId?: Id<"policyCertificates">;
    policyVersionId?: Id<"policyVersions">;
    holderEmail?: string;
    holderPhone?: string;
    holderContactName?: string;
    holderAddress?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      formatted?: string;
    };
    source?: string;
    createdByUserId?: Id<"users">;
  },
) {
  const holderId = args.certificateHolderId ?? await ctx.runMutation(
    (internal as any).certificateHolders.upsertInternal,
    {
      orgId: args.orgId,
      displayName: args.certificateHolderName?.trim() || firstCertificateHolderLine(args.certificateHolder),
      contactName: args.holderContactName,
      email: args.holderEmail,
      phone: args.holderPhone,
      address: args.holderAddress,
      source: "certificate_generation",
      sourceRef: String(args.policyId),
      createdByUserId: args.createdByUserId,
      updatedByUserId: args.createdByUserId,
    },
  );
  const policyVersionId = args.policyVersionId ?? await ctx.runMutation(
    (internal as any).policyVersions.ensureInitialInternal,
    {
      policyId: args.policyId,
      createdByUserId: args.createdByUserId,
    },
  );
  const policyVersion = args.policyVersionId
    ? await ctx.runQuery(
        (internal as any).policyVersions.getByIdInternal,
        { id: args.policyVersionId },
      ).catch(() => null)
    : await ctx.runQuery(
        (internal as any).policyVersions.getCurrentInternal,
        { policyId: args.policyId },
      ).catch(() => null);
  const policyCertificateId = args.policyCertificateId ?? await ctx.runMutation(
    (internal as any).certificateLifecycle.getOrCreateParentInternal,
    {
      orgId: args.orgId,
      policyId: args.policyId,
      holderId,
      source: args.source ?? "unknown",
      createdByUserId: args.createdByUserId,
    },
  );

  return {
    holderId: holderId as Id<"certificateHolders">,
    policyCertificateId: policyCertificateId as Id<"policyCertificates">,
    policyVersionId: policyVersionId as Id<"policyVersions">,
    policySnapshot: policyVersion?.snapshot,
  };
}

function cleanFilenamePart(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 90).trim();
}

function buildCoiFileName(
  policy: Record<string, unknown>,
  certificateHolder?: string,
  certificateHolderName?: string,
  formCode: CertificateFormCode = "acord25",
) {
  const holder = cleanFilenamePart(
    certificateHolderName ?? certificateHolder?.split(/\r?\n/)[0],
    "certificate-holder",
  );
  const policyRef = cleanFilenamePart(
    policy.policyNumber ?? policy.security ?? policy.carrier,
    "policy",
  );
  const form = CERTIFICATE_FORM_FILE_SLUGS[formCode] ?? "certificate";
  return `${form} - ${holder} - ${policyRef}.pdf`;
}

function linesOfBusinessForCertificate(policy: Record<string, any>) {
  const profileLines = Array.isArray(policy.operationalProfile?.linesOfBusiness)
    ? policy.operationalProfile.linesOfBusiness
    : [];
  const policyLines = Array.isArray(policy.linesOfBusiness) ? policy.linesOfBusiness : [];
  const legacyPolicyTypes = Array.isArray(policy.policyTypes) ? policy.policyTypes : [];
  return [...profileLines, ...policyLines, ...legacyPolicyTypes].filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { value?: unknown }).value === "string" &&
      (value as { value: string }).value.trim()
    ) {
      return (value as { value: string }).value.trim();
    }
  }
  return undefined;
}

function certificatePropertyExtras(policy: Record<string, any>) {
  const profile = policy.operationalProfile ?? {};
  const locations = Array.isArray(profile.locations) ? profile.locations : [];
  const firstLocation = locations.find((location: unknown) =>
    location && typeof location === "object" && !Array.isArray(location),
  ) as Record<string, unknown> | undefined;
  const declarationFields = Array.isArray(policy.declarations?.fields)
    ? policy.declarations.fields
    : [];
  const declarationMap = new Map<string, string>();
  for (const field of declarationFields) {
    if (typeof field?.field === "string" && typeof field?.value === "string") {
      declarationMap.set(field.field, field.value);
    }
  }
  return {
    propertyDescription: firstText(
      profile.propertyDescription,
      profile.describedProperty,
      declarationMap.get("describedProperty"),
      declarationMap.get("propertyDescription"),
      policy.summary,
    ),
    propertyLocation: firstText(
      firstLocation?.address,
      firstLocation?.location,
      declarationMap.get("premisesAddress"),
      declarationMap.get("propertyLocation"),
      declarationMap.get("insuredLocation"),
    ),
    floodZone: firstText(
      profile.floodZone,
      declarationMap.get("floodZone"),
      declarationMap.get("floodZoneDetermination"),
    ),
    floodProgram: firstText(
      profile.floodProgram,
      declarationMap.get("floodProgram"),
      declarationMap.get("nfipProgram"),
    ),
  };
}

type GenerateCoiDescriptionArgs = {
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  certificateHolder?: string;
  certificateHolderName?: string;
  requestKind?: "holder" | "additional_insured";
  additionalInsuredName?: string;
  holderRelationship?: string;
  endorsements?: EndorsementCitation[];
};

async function fillCertificateDescription(
  ctx: ActionCtx,
  args: GenerateCoiDescriptionArgs,
  policy: Record<string, any>,
  coiData: ReturnType<typeof policyToCoiData>,
) {
  const context = buildCertificateDescriptionContext(policy, coiData, {
    certificateHolder: args.certificateHolder,
    certificateHolderName: args.certificateHolderName,
    requestKind: args.requestKind,
    additionalInsuredName: args.additionalInsuredName,
    holderRelationship: args.holderRelationship,
    endorsements: args.endorsements,
  });
  const fallback = buildCertificateDescriptionFallback(context, coiData.description);
  if (!hasCertificateDescriptionContext(context)) {
    return {
      ...coiData,
      description: fallback || (
        coiData.description && isUsableCertificateDescription(coiData.description)
          ? coiData.description
          : undefined
      ),
    };
  }

  try {
    const result = await generateObjectForOrg(
      ctx,
      args.orgId,
      "summary",
      {
        schema: CertificateDescriptionSchema,
        system: certificateDescriptionSystemPrompt(),
        prompt: buildCertificateDescriptionPrompt({
          context,
          existingDescription: coiData.description,
        }),
      },
    );
    const description = normalizeCertificateDescription(result.object.description);
    return {
      ...coiData,
      description: description && isUsableCertificateDescription(description)
        ? description
        : fallback || undefined,
    };
  } catch (err) {
    logAiError("generateCoi.description", err, {
      policyId: args.policyId,
      orgId: args.orgId,
    });
    return {
      ...coiData,
      description: fallback || undefined,
    };
  }
}

/**
 * Generate a COI PDF for a policy and store it in file storage.
 * Returns the storage ID and byte size for download/attachment metadata.
 */
export const run = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    source: v.optional(v.union(
      v.literal("policy_page"),
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("sms"),
      v.literal("api"),
      v.literal("mcp"),
      v.literal("agent"),
      v.literal("unknown"),
    )),
    createdByUserId: v.optional(v.id("users")),
    requestKind: v.optional(v.union(
      v.literal("holder"),
      v.literal("additional_insured"),
    )),
    additionalInsuredName: v.optional(v.string()),
    formCode: v.optional(certificateFormValidator),
    holderRelationship: v.optional(v.string()),
    endorsements: v.optional(v.array(endorsementCitationValidator)),
    requestSignature: v.optional(v.string()),
    certificateHolderId: v.optional(v.id("certificateHolders")),
    policyCertificateId: v.optional(v.id("policyCertificates")),
    policyVersionId: v.optional(v.id("policyVersions")),
    holderEmail: v.optional(v.string()),
    holderPhone: v.optional(v.string()),
    holderContactName: v.optional(v.string()),
    holderAddress: v.optional(holderAddressValidator),
  },
  handler: async (ctx, args): Promise<{
    storageId: string;
    size: number;
    fileName: string;
    certificateId: string;
    holderId?: string;
    policyCertificateId?: string;
    certificateVersionId?: string;
    versionNumber?: number;
    formCode: CertificateFormCode;
  }> => {
    try {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });

      if (!policy) throw new Error("Policy not found");
      if (policy.orgId !== args.orgId) throw new Error("Policy not found for organization");

      const formCode = args.formCode ?? selectCertificateForm({
        linesOfBusiness: linesOfBusinessForCertificate(policy as Record<string, any>),
        holderRelationship: args.holderRelationship,
        operationalProfile: (policy as Record<string, unknown>).operationalProfile,
      });
      let coiData = policyToCoiData(policy);
      coiData = {
        ...coiData,
        ...certificatePropertyExtras(policy as Record<string, any>),
        formCode,
        title: CERTIFICATE_FORM_LABELS[formCode] ?? coiData.title,
        certificateHolderRelationship: args.holderRelationship,
        interestHolder: args.certificateHolder,
        interestHolderRelationship: args.holderRelationship,
      };
      if (args.certificateHolder) {
        coiData.certificateHolder = args.certificateHolder;
      }
      if (args.requestKind === "additional_insured" && args.additionalInsuredName) {
        coiData.description = [
          coiData.description,
          `Additional Insured: ${args.additionalInsuredName}`,
        ].filter(Boolean).join("\n\n");
      }
      const endorsements = args.endorsements as EndorsementCitation[] | undefined;
      coiData = applyEndorsementsToCertificateData(coiData, {
        endorsements,
      });
      coiData = await fillCertificateDescription(ctx, {
        orgId: args.orgId,
        policyId: args.policyId,
        certificateHolder: args.certificateHolder,
        certificateHolderName: args.certificateHolderName,
        requestKind: args.requestKind,
        additionalInsuredName: args.additionalInsuredName,
        holderRelationship: args.holderRelationship,
        endorsements,
      }, policy as Record<string, any>, coiData);
      const pdfBuffer = await generateCoiPdf(coiData);

      // Store in Convex file storage
      // Copy to a plain ArrayBuffer to satisfy strict Blob typing
      const arrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      const storageId = await ctx.storage.store(blob);
      const size = pdfBuffer.byteLength;
      const fileName = buildCoiFileName(
        policy,
        args.certificateHolder,
        args.certificateHolderName,
        formCode,
      );

      const certificateId = await ctx.runMutation(internal.certificates.recordGenerated, {
        orgId: args.orgId,
        policyId: args.policyId,
        fileId: storageId,
        fileName,
        certificateHolder: args.certificateHolder,
        certificateHolderName: args.certificateHolderName,
        source: args.source,
        createdByUserId: args.createdByUserId,
        requestKind: args.requestKind,
        additionalInsuredName: args.additionalInsuredName,
        formCode,
        requestSignature: args.requestSignature,
      });
      const lifecycle = await ensureCertificateLifecycleContext(ctx, args);
      const issuedVersion = await ctx.runMutation(
        (internal as any).certificateLifecycle.recordIssuedVersionInternal,
        {
          orgId: args.orgId,
          certificateId: lifecycle.policyCertificateId,
          holderId: lifecycle.holderId,
          policyId: args.policyId,
          policyVersionId: lifecycle.policyVersionId,
          fileId: storageId,
          fileName,
          fileSize: size,
          certificateHolder: args.certificateHolder,
          certificateHolderName: args.certificateHolderName,
          holderEmail: args.holderEmail,
          holderPhone: args.holderPhone,
          holderContactName: args.holderContactName,
          holderAddress: args.holderAddress,
          policySnapshot: lifecycle.policySnapshot,
          source: args.source,
          requestKind: args.requestKind,
          additionalInsuredName: args.additionalInsuredName,
          formCode,
          requestSignature: args.requestSignature,
          createdByUserId: args.createdByUserId,
        },
      );

      return {
        storageId: storageId as string,
        size,
        fileName,
        certificateId: String(certificateId),
        holderId: String(lifecycle.holderId),
        policyCertificateId: String(lifecycle.policyCertificateId),
        certificateVersionId: String(issuedVersion.versionId),
        versionNumber: issuedVersion.versionNumber,
        formCode,
      };
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      throw err;
    }
  },
});
