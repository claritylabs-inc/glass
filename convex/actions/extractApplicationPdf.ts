"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * extractApplicationPdfPublic (public wrapper) — thin wrapper
 *
 * @deprecated Use startExtractionFromPdf directly from the create-drawer.
 *
 * Creates a draft application then delegates extraction to the cl-pipelines
 * pipeline via startExtractionFromPdf. Existing callers (document upload
 * drawer with documentType="application") continue to work unchanged.
 */
export const extractApplicationPdfPublic = action({
  args: {
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Auth guard — confirm caller is a broker for clientOrgId
    const access = await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForClient,
      { clientOrgId: args.clientOrgId },
    );

    const title = `Extracted Application (${new Date().toLocaleDateString("en-US")})`;
    const applicationId: string = await ctx.runMutation(
      (internal as any).applicationsInternal.createDraftInternal,
      {
        brokerOrgId: access.brokerOrgId,
        clientOrgId: args.clientOrgId,
        createdByUserId: access.userId,
        creationPath: "extracted_pdf",
        title,
      },
    );

    // Delegate to cl-pipelines pipeline — runs as background job
    await ctx.runAction(
      (internal as any).actions.applicationExtraction.startExtractionFromPdf,
      {
        applicationId,
        fileId: args.fileId,
      },
    );

    return { applicationId };
  },
});

/**
 * extractQuestionsFromPdf (public action) — thin wrapper
 *
 * @deprecated Use startExtractionFromPdf directly on an existing application.
 *
 * Fire-and-forget variant: starts the cl-pipelines extraction pipeline on an
 * existing application draft and returns immediately.
 */
export const extractQuestionsFromPdf = action({
  args: {
    applicationId: v.id("applications"),
    fileId: v.id("_storage"),
  },
  returns: v.object({ questionCount: v.number() }),
  handler: async (ctx, args) => {
    // Auth guard
    await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId: args.applicationId },
    );

    // Delegate to cl-pipelines pipeline — fire-and-forget (don't await)
    void ctx.runAction(
      (internal as any).actions.applicationExtraction.startExtractionFromPdf,
      {
        applicationId: args.applicationId,
        fileId: args.fileId,
      },
    );

    // Return immediately — extraction runs in background
    return { questionCount: 0 };
  },
});

// NOTE: The old extractApplicationPdf internalAction and extractQuestionsFromPdfFile
// helper have been removed. Their logic now lives in the cl-pipelines phases in
// convex/actions/applicationExtraction.ts (extract_fields → insert_questions → etc.)
