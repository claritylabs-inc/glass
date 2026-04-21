"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { haikuModel } from "../lib/ai";
import { APPLICATION_CLASSIFY_PROMPT, buildFieldExtractionPrompt } from "../lib/applicationPrompts";
import { getAcroFormFields } from "../lib/pdfFiller";
import { mapExtractedFieldsToQuestions } from "../lib/applicationPdfExtraction";
import type { IntentStub } from "../lib/applicationPdfExtraction";
import { stripFences } from "../lib/extraction";
import { requireBrokerAccessToClient } from "../lib/access";

/**
 * extractApplicationPdf (internal)
 *
 * Converts a broker-uploaded application-form PDF into a digital-first
 * `applications` row (creationPath="extracted_pdf") with fully populated
 * `applicationQuestions`. The caller (broker upload UI) schedules this
 * after createBrokerUpload returns when documentType="application".
 *
 * On completion, emits brokerActivity.application_extracted (as document_uploaded)
 * and the resulting applicationId is opened in the standard broker application editor.
 */
export const extractApplicationPdf = internalAction({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
    uploadedByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // 1. Fetch PDF from storage
    const pdfUrl = await ctx.storage.getUrl(args.fileId);
    if (!pdfUrl) throw new Error("File not found in storage");

    // 2. Classify — confirm this looks like an application form
    const classifyResp = await generateText({
      model: haikuModel,
      maxOutputTokens: 64,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: APPLICATION_CLASSIFY_PROMPT },
            { type: "file", data: new URL(pdfUrl), mimeType: "application/pdf" },
          ],
        },
      ],
    });
    const classifyText = classifyResp.text.trim().toLowerCase();
    if (!classifyText.includes("application")) {
      throw new Error(
        `PDF does not appear to be an application form (classifier: ${classifyText})`,
      );
    }

    // 3. Extract AcroForm fields (fillable PDF widgets)
    const pdfResponse = await fetch(pdfUrl);
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const acroFields = await getAcroFormFields(pdfBytes);

    // 4. If no AcroForm fields, run LLM field extraction
    let rawFields: Array<{ pdfFieldName: string; label: string; widgetType: string }>;
    if (acroFields.length > 0) {
      rawFields = acroFields.map((f: { name: string; type?: string }) => ({
        pdfFieldName: f.name,
        label: f.name
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        widgetType: f.type ?? "text",
      }));
    } else {
      // Flat PDF — use LLM to enumerate visible form fields
      const extractResp = await generateText({
        model: haikuModel,
        maxOutputTokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildFieldExtractionPrompt() },
              { type: "file", data: new URL(pdfUrl), mimeType: "application/pdf" },
            ],
          },
        ],
      });
      const parsed = JSON.parse(stripFences(extractResp.text)) as Array<{
        name: string;
        label: string;
        type?: string;
      }>;
      rawFields = parsed.map((f) => ({
        pdfFieldName: f.name,
        label: f.label,
        widgetType: f.type ?? "text",
      }));
    }

    // 5. Load questionIntents for matching
    const intents: IntentStub[] = await ctx.runQuery(
      (internal as any).questionIntents.listAll,
      {},
    );

    // 6. Map extracted fields to MappedQuestion[]
    const mappedQuestions = mapExtractedFieldsToQuestions(rawFields, intents);

    // 7. Create draft applications row (internal — no auth session needed)
    const title = `Extracted Application (${new Date().toLocaleDateString("en-US")})`;
    const applicationId = await ctx.runMutation(
      (internal as any).applicationsInternal.createDraftInternal,
      {
        brokerOrgId: args.brokerOrgId,
        clientOrgId: args.clientOrgId,
        createdByUserId: args.uploadedByUserId,
        creationPath: "extracted_pdf",
        sourceTemplateId: undefined,
        title,
        lineOfBusiness: undefined,
      },
    );

    // 8. Bulk insert applicationQuestions
    await ctx.runMutation(
      (internal as any).applicationQuestionsInternal.bulkInsert,
      {
        applicationId,
        questions: mappedQuestions,
      },
    );

    // 9. Run regroupAndOrder
    try {
      await ctx.runAction(
        (internal as any).actions.applicationAuthoring.regroupAndOrder,
        { applicationId },
      );
    } catch (err) {
      console.error("regroupAndOrder failed (non-critical):", err);
    }

    // 10. Emit broker activity
    try {
      await ctx.runMutation((internal as any).brokerActivity.record, {
        brokerOrgId: args.brokerOrgId,
        clientOrgId: args.clientOrgId,
        type: "document_uploaded" as const,
        actorUserId: args.uploadedByUserId,
        actorSide: "broker" as const,
        payload: { applicationId, sourcePdfFileId: args.fileId },
        summary: "Broker uploaded an application PDF — draft created",
      });
    } catch (err) {
      console.error("brokerActivity record failed (non-critical):", err);
    }

    return { applicationId };
  },
});

/**
 * extractApplicationPdfPublic (public wrapper)
 *
 * Validates broker-of-client access before dispatching to the internal action.
 * Called from the broker upload drawer when documentType="application".
 */
export const extractApplicationPdfPublic = action({
  args: {
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Auth guard — confirm caller is a broker for clientOrgId
    const access = await requireBrokerAccessToClient(ctx as any, args.clientOrgId);
    await ctx.runAction(
      (internal as any).actions.extractApplicationPdf.extractApplicationPdf,
      {
        brokerOrgId: access.brokerOrgId,
        clientOrgId: args.clientOrgId,
        fileId: args.fileId,
        uploadedByUserId: access.userId,
      },
    );
  },
});
