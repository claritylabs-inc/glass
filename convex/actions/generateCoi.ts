"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateCoiPdf, policyToCoiData } from "../lib/coiGenerator";
import { logAiError } from "../lib/aiUtils";

const holderAddressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
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
) {
  const holder = cleanFilenamePart(
    certificateHolderName ?? certificateHolder?.split(/\r?\n/)[0],
    "certificate-holder",
  );
  const policyRef = cleanFilenamePart(
    policy.policyNumber ?? policy.security ?? policy.carrier,
    "policy",
  );
  return `COI - ${holder} - ${policyRef}.pdf`;
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
  }> => {
    try {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });

      if (!policy) throw new Error("Policy not found");
      if (policy.orgId !== args.orgId) throw new Error("Policy not found for organization");

      const coiData = policyToCoiData(policy);
      if (args.certificateHolder) {
        coiData.certificateHolder = args.certificateHolder;
      }
      if (args.requestKind === "additional_insured" && args.additionalInsuredName) {
        coiData.description = [
          coiData.description,
          `Additional Insured: ${args.additionalInsuredName}`,
        ].filter(Boolean).join("\n\n");
      }
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
      };
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      throw err;
    }
  },
});
