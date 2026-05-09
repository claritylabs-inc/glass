"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateCoiPdf, policyToCoiData } from "../lib/coiGenerator";
import { logAiError } from "../lib/aiUtils";

/**
 * Generate a COI PDF for a policy and store it in file storage.
 * Returns the storage ID for download.
 */
export const run = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    certificateHolder: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string | null> => {
    try {
      const [policy, org] = await Promise.all([
        ctx.runQuery(internal.policies.getInternal, { id: args.policyId }),
        ctx.runQuery(internal.orgs.getInternal, { id: args.orgId }),
      ]);

      if (!policy) throw new Error("Policy not found");

      let broker: { name?: string; contactName?: string; contactEmail?: string } | undefined;
      if (org?.type === "client" && org.brokerOrgId) {
        const brokerOrg = await ctx.runQuery(internal.orgs.getInternal, { id: org.brokerOrgId });
        if (brokerOrg) {
          broker = { name: brokerOrg.name };
          if (brokerOrg.primaryInsuranceContactId) {
            const contact = await ctx.runQuery(internal.users.getInternal, {
              id: brokerOrg.primaryInsuranceContactId,
            });
            if (contact) {
              broker.contactName = contact.name;
              broker.contactEmail = contact.email;
            }
          }
        }
      }
      const coiData = policyToCoiData(policy, { ...(org ?? {}), broker });
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

      return storageId as string;
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      throw err;
    }
  },
});
