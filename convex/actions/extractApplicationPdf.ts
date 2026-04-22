"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, Output } from "ai";
import { z } from "zod";
import { haikuModel } from "../lib/ai";
import { getModel } from "../lib/models";
import { APPLICATION_CLASSIFY_PROMPT, buildFieldExtractionPrompt } from "../lib/applicationPrompts";
import { getAcroFormFields } from "../lib/pdfFiller";
import { PDFDocument } from "pdf-lib";
import { mapExtractedFieldsToQuestions } from "../lib/applicationPdfExtraction";
import type { IntentStub } from "../lib/applicationPdfExtraction";
import { stripFences } from "../lib/extraction";

// Infer a friendly application title + line of business from the set of
// extracted question prompts. Returns null for either if the signal is weak.
async function inferApplicationMeta(
  questions: Array<{ prompt: string }>,
): Promise<{ title: string | null; lineOfBusiness: string | null }> {
  if (questions.length === 0) return { title: null, lineOfBusiness: null };
  const sample = questions.slice(0, 60).map((q, i) => `${i + 1}. ${q.prompt}`).join("\n");
  const { output } = await generateText({
    model: getModel("application_authoring"),
    maxOutputTokens: 300,
    output: Output.object({
      schema: z.object({
        title: z.string().nullable(),
        lineOfBusiness: z.string().nullable(),
      }),
    }),
    prompt: `Read the question prompts from an insurance application form and infer:
- title: a short human-readable title the broker will see (e.g. "Commercial General Liability Application", "Workers Comp Renewal"). Keep under 60 chars.
- lineOfBusiness: a short label like "CGL", "Commercial Property", "Workers Comp", "Commercial Auto", "Umbrella", etc.
Return null for either field if the prompts don't clearly indicate it.

QUESTIONS:
${sample}`,
  });
  const out = output as { title: string | null; lineOfBusiness: string | null };
  return {
    title: out.title?.trim() || null,
    lineOfBusiness: out.lineOfBusiness?.trim() || null,
  };
}

async function extractQuestionsFromPdfFile(
  ctx: any,
  fileId: string,
): Promise<Array<{ intentKey: string | null; prompt: string; answerType: string; pdfFieldName?: string }>> {
  // 1. Fetch PDF from storage
  const pdfUrl = await ctx.storage.getUrl(fileId as any);
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
          { type: "file", data: new URL(pdfUrl), mediaType: "application/pdf" },
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
  const pdfBytes = await pdfResponse.arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const acroFields = getAcroFormFields(pdfDoc);

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
    // Flat PDF — use gpt-5.4-mini with structured output for reliable JSON
    const fieldSchema = z.object({
      fields: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          type: z.string().nullable(),
        }),
      ),
    });
    const { experimental_output: object } = await generateText({
      model: getModel("extraction"),
      maxOutputTokens: 16384,
      experimental_output: Output.object({ schema: fieldSchema }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildFieldExtractionPrompt() },
            { type: "file", data: new URL(pdfUrl), mediaType: "application/pdf" },
          ],
        },
      ],
    });
    rawFields = object.fields.map((f) => ({
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
  return mapExtractedFieldsToQuestions(rawFields, intents);
}

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
  handler: async (ctx, args): Promise<{ applicationId: string }> => {
    const mappedQuestions = await extractQuestionsFromPdfFile(ctx, args.fileId);
    if (mappedQuestions.length === 0) {
      throw new Error("No questions could be extracted from the PDF");
    }

    // 7. Create draft applications row (internal — no auth session needed)
    const title = `Extracted Application (${new Date().toLocaleDateString("en-US")})`;
    const applicationId: string = await ctx.runMutation(
      (internal as any).applicationsInternal.createDraftInternal,
      {
        brokerOrgId: args.brokerOrgId,
        clientOrgId: args.clientOrgId,
        createdByUserId: args.uploadedByUserId,
        creationPath: "extracted_pdf",
        title,
        lineOfBusiness: undefined,
      },
    );

    try {
      // 8. Bulk insert applicationQuestions
      await ctx.runMutation(
        (internal as any).applicationQuestionsInternal.bulkInsert,
        { applicationId, questions: mappedQuestions },
      );

      // 8b. Infer title + line of business from the extracted prompts
      try {
        const meta = await inferApplicationMeta(mappedQuestions);
        if (meta.title || meta.lineOfBusiness) {
          await ctx.runMutation(
            (internal as any).applicationsInternal.patchDraftMetaInternal,
            {
              applicationId,
              title: meta.title ?? undefined,
              lineOfBusiness: meta.lineOfBusiness ?? undefined,
            },
          );
        }
      } catch (err) {
        console.error("inferApplicationMeta failed (non-critical):", err);
      }
    } catch (err) {
      await ctx.runMutation(
        (internal as any).applicationsInternal.deleteDraftInternal,
        { applicationId },
      );
      throw err;
    }

    // 9. Run regroupAndOrder (non-fatal — draft is still usable as one group)
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
    const access = await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForClient,
      { clientOrgId: args.clientOrgId },
    );
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

/**
 * extractQuestionsFromPdf (public action)
 *
 * Extracts questions from an uploaded application PDF and adds them to an
 * existing application draft. Used by the "Generate with AI" drawer when
 * the broker uploads an existing paper/PDF application instead of typing a prompt.
 */
export const extractQuestionsFromPdf = action({
  args: {
    applicationId: v.id("applications"),
    fileId: v.id("_storage"),
  },
  returns: v.object({ questionCount: v.number() }),
  handler: async (ctx, args) => {
    // 1. Auth guard — confirm caller is a broker-org member for this application
    await ctx.runQuery(
      (internal as any).applicationsInternal.requireBrokerAccessForApplication,
      { applicationId: args.applicationId },
    );

    // 3. Extract questions from PDF
    const mappedQuestions = await extractQuestionsFromPdfFile(ctx, args.fileId);
    if (mappedQuestions.length === 0) {
      return { questionCount: 0 };
    }

    // 4. Bulk insert into existing application
    await ctx.runMutation(
      (internal as any).applicationQuestionsInternal.bulkInsert,
      {
        applicationId: args.applicationId,
        questions: mappedQuestions,
      },
    );

    // 4b. Infer title + LoB (non-fatal)
    try {
      const meta = await inferApplicationMeta(mappedQuestions);
      if (meta.title || meta.lineOfBusiness) {
        await ctx.runMutation(
          (internal as any).applicationsInternal.patchDraftMetaInternal,
          {
            applicationId: args.applicationId,
            title: meta.title ?? undefined,
            lineOfBusiness: meta.lineOfBusiness ?? undefined,
          },
        );
      }
    } catch (err) {
      console.error("inferApplicationMeta failed (non-critical):", err);
    }

    // 5. Run regroupAndOrder
    try {
      await ctx.runAction(
        (internal as any).actions.applicationAuthoring.regroupAndOrder,
        { applicationId: args.applicationId },
      );
    } catch (err) {
      console.error("regroupAndOrder failed (non-critical):", err);
    }

    return { questionCount: mappedQuestions.length };
  },
});
