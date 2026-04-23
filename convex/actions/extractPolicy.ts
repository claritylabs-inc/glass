"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Email-triggered policy extraction.
 * Downloads the PDF attachment from IMAP and starts the cl-pipelines extraction.
 * Thin wrapper — all logic now lives in policyExtraction.ts.
 */
export const extractPolicy = internalAction({
  args: {
    emailId: v.id("emails"),
    connectionId: v.id("emailConnections"),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    if (!args.orgId) throw new Error("extractPolicy: orgId is required");

    // Create placeholder policy row
    const policyId: Id<"policies"> = await ctx.runMutation(api.policies.insert, {
      userId: args.userId,
      orgId: args.orgId,
      emailId: args.emailId,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      policyTypes: ["other"],
      documentType: "policy",
      policyYear: new Date().getFullYear(),
      effectiveDate: "Extracting...",
      expirationDate: "Extracting...",
      isRenewal: false,
      coverages: [],
      insuredName: "Extracting...",
    });

    // Audit
    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId,
      userId: args.userId,
      orgId: args.orgId,
      action: "extraction_started",
    });

    // Start cl-pipelines pipeline (fire-and-forget inside the action)
    await ctx.runAction(internal.actions.policyExtraction.startPolicyExtractionFromEmail, {
      policyId,
      emailId: args.emailId,
      connectionId: args.connectionId,
      orgId: args.orgId,
      userId: args.userId,
    });
  },
});
