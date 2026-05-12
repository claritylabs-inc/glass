"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateCoiPdf, policyToCoiData } from "../lib/coiGenerator";
import { logAiError } from "../lib/aiUtils";

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
  },
  handler: async (ctx, args): Promise<{ storageId: string; size: number }> => {
    try {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });

      if (!policy) throw new Error("Policy not found");
      if (policy.orgId !== args.orgId) throw new Error("Policy not found for organization");

      const coiData = policyToCoiData(policy);
      if (args.certificateHolder) {
        coiData.certificateHolder = args.certificateHolder;
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

      await ctx.runMutation(internal.certificates.recordGenerated, {
        orgId: args.orgId,
        policyId: args.policyId,
        fileId: storageId,
        fileName: "certificate-of-insurance.pdf",
        certificateHolder: args.certificateHolder,
        certificateHolderName: args.certificateHolderName,
        source: args.source,
        createdByUserId: args.createdByUserId,
      });

      return { storageId: storageId as string, size };
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      throw err;
    }
  },
});
