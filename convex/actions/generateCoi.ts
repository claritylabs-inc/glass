"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateCoiPdf, policyToCoiData } from "../lib/coiGenerator";
import { logAiError } from "../lib/aiUtils";

function cleanFilenamePart(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 90).trim();
}

function buildCoiFileName(policy: Record<string, unknown>, certificateHolder?: string, certificateHolderName?: string) {
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
    authorityType: v.optional(v.union(v.literal("non_binding"), v.literal("certified"))),
    certificationStatus: v.optional(
      v.union(
        v.literal("not_applicable"),
        v.literal("pending"),
        v.literal("certified"),
        v.literal("declined"),
      ),
    ),
    partnerOrgId: v.optional(v.id("organizations")),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    standingAuthorizationId: v.optional(v.id("standingAuthorizations")),
    disclaimer: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ storageId: string; size: number; fileName: string; certificateId: string }> => {
    try {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });

      if (!policy) throw new Error("Policy not found");
      if (policy.orgId !== args.orgId) throw new Error("Policy not found for organization");

      const coiData = policyToCoiData(policy);
      if (args.certificateHolder) {
        coiData.certificateHolder = args.certificateHolder;
      }
      coiData.authorityType = args.authorityType ?? "non_binding";
      coiData.certificationStatus = args.certificationStatus ?? "not_applicable";
      coiData.certificationNotice = args.disclaimer;

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
      const fileName = buildCoiFileName(policy, args.certificateHolder, args.certificateHolderName);

      const certificateId = await ctx.runMutation(internal.certificates.recordGenerated, {
        orgId: args.orgId,
        policyId: args.policyId,
        fileId: storageId,
        fileName,
        certificateHolder: args.certificateHolder,
        certificateHolderName: args.certificateHolderName,
        source: args.source,
        createdByUserId: args.createdByUserId,
        authorityType: args.authorityType,
        certificationStatus: args.certificationStatus,
        partnerOrgId: args.partnerOrgId,
        partnerProgramId: args.partnerProgramId,
        templateId: args.templateId,
        standingAuthorizationId: args.standingAuthorizationId,
        disclaimer: args.disclaimer,
      });

      return { storageId: storageId as string, size, fileName, certificateId: String(certificateId) };
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      throw err;
    }
  },
});
