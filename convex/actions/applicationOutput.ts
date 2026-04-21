"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { fillAcroForm, type FieldMapping } from "../lib/pdfFiller";

export const generateFilledPdf = internalAction({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery((api as any).applications.get, { applicationId: args.applicationId }) as { app: { sourceTemplateId?: string; filledPdfStorageId?: string }; questions: Array<{ _id: string; intentKey?: string }>; answers: Array<{ questionId: string; value: unknown }> } | null;
    if (!data) throw new Error("Application not found");
    const { app, questions, answers } = data;

    if (!app.sourceTemplateId) throw new Error("No source template");
    const template = await ctx.runQuery((internal as any).applicationTemplatesInternal.getById, {
      templateId: app.sourceTemplateId,
    });
    if (!template?.sourcePdfStorageId || !template.sourcePdfFieldMap) {
      console.log("Template has no PDF source — skipping fill");
      return;
    }

    const pdfUrl = await ctx.storage.getUrl(template.sourcePdfStorageId);
    if (!pdfUrl) throw new Error("Could not get PDF URL from storage");

    const pdfResponse = await fetch(pdfUrl);
    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfArrayBuffer);

    const answerByIntentKey: Record<string, unknown> = {};
    const questionById = Object.fromEntries(questions.map((q: { _id: string; intentKey?: string }) => [String(q._id), q]));
    for (const a of answers) {
      const q = questionById[String((a as any).questionId)];
      if (q?.intentKey) answerByIntentKey[q.intentKey] = (a as any).value;
    }

    const fieldMap = template.sourcePdfFieldMap as Record<string, string>;
    const mappings: FieldMapping[] = Object.entries(fieldMap)
      .filter(([intentKey]) => answerByIntentKey[intentKey] !== undefined)
      .map(([intentKey, pdfField]) => ({
        acroFormName: pdfField,
        value: String(answerByIntentKey[intentKey] ?? ""),
      }));

    const filledBytes = await fillAcroForm(pdfBytes, mappings);
    const blob = new Blob([filledBytes as unknown as ArrayBuffer], { type: "application/pdf" });

    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation((internal as any).applicationsInternal.setFilledPdf, {
      applicationId: args.applicationId,
      storageId,
    });
  },
});
