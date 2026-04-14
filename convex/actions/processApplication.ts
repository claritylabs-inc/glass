"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { generateText } from "ai";
import { haikuModel, sonnetModel } from "../lib/ai";
import { stripFences } from "../lib/extraction";
import {
  APPLICATION_CLASSIFY_PROMPT,
  buildFieldExtractionPrompt,
  buildAutoFillPrompt,
  buildQuestionBatchPrompt,
  buildAnswerParsingPrompt,
  buildConfirmationSummaryPrompt,
  buildBatchEmailGenerationPrompt,
  buildReplyIntentClassificationPrompt,
  buildFieldExplanationPrompt,
  buildLookupFillPrompt,
  buildAcroFormMappingPrompt,
  buildFlatPdfMappingPrompt,
} from "../lib/applicationPrompts";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getAcroFormFields, fillAcroForm, overlayTextOnPdf } from "../lib/pdfFiller";
import type { FormField, QuestionBatch } from "../lib/applicationTypes";
import { makeEmbedText } from "../lib/sdkCallbacks";

/** Detect if a value contains a relative date reference. */
const RELATIVE_DATE_PATTERN = /\b(today|tomorrow|yesterday|next\s+\w+|last\s+\w+|this\s+\w+|in\s+\d+\s+\w+|\d+\s+\w+\s+(?:from|ago)|end\s+of\s+\w+|beginning\s+of\s+\w+|now|current\s+date|today'?s?\s+date)\b/i;

/** Resolve relative date references in parsed answers using a Haiku call. */
async function resolveRelativeDates(
  answers: { fieldId: string; value: string; explanation?: string }[],
  fields: FormField[],
): Promise<void> {
  // Find answers that are date fields with relative references
  const dateAnswers = answers.filter((a) => {
    const field = fields.find((f) => f.id === a.fieldId);
    if (!field) return false;
    const isDateField = field.fieldType === "date" ||
      /date|when|effective|expir/i.test(a.fieldId) ||
      /date|when|effective|expir/i.test(getFieldLabel(field));
    return isDateField && RELATIVE_DATE_PATTERN.test(a.value);
  });

  if (dateAnswers.length === 0) return;

  const today = new Date();
  const dateList = dateAnswers
    .map((a, i) => `${i + 1}. field="${a.fieldId}" value="${a.value}"`)
    .join("\n");

  const { text } = await generateText({
    model: haikuModel,
    maxOutputTokens: 256,
    messages: [{
      role: "user",
      content: `Today is ${today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${today.toISOString().slice(0, 10)}).

Resolve these relative date references to actual dates in MM/DD/YYYY format:

${dateList}

Respond with JSON only:
{
  "dates": [
    { "fieldId": "field_id", "resolved": "MM/DD/YYYY" }
  ]
}`,
    }],
  });
  try {
    const { dates } = JSON.parse(stripFences(text));
    for (const d of dates ?? []) {
      const answer = answers.find((a) => a.fieldId === d.fieldId);
      if (answer && d.resolved) {
        answer.value = d.resolved;
      }
    }
  } catch {
    console.warn("Failed to resolve relative dates");
  }
}

const DEFAULT_AGENT_DOMAIN = "prism.claritylabs.inc";
function getAgentDomain(): string {
  return process.env.AGENT_DOMAIN ?? DEFAULT_AGENT_DOMAIN;
}
function getAppUrl(): string {
  return process.env.SITE_URL ?? "https://prism.claritylabs.inc";
}
/**
 * Resolve the unified thread for a legacy conversation and return a helper
 * to dual-write agent email messages into the unified thread.
 */
async function createThreadWriter(
  ctx: any,
  conversationId: any,
  orgId: any,
  agentAddress: string,
) {
  let unifiedThreadId: any = null;
  try {
    const thread = await ctx.runQuery(internal.threads.findByLegacyId, {
      legacyConversationId: conversationId,
    });
    if (thread) unifiedThreadId = thread._id;
  } catch {
    // Non-critical — thread may not exist yet
  }

  return async (content: string, responseMessageId?: string) => {
    if (!unifiedThreadId) return;
    try {
      await ctx.runMutation(internal.threads.insertEmailMessage, {
        threadId: unifiedThreadId,
        orgId,
        role: "agent" as const,
        fromEmail: agentAddress,
        content,
        responseMessageId,
        legacyConversationId: conversationId,
      });
    } catch (err) {
      console.warn("Application thread dual-write failed:", err);
    }
  };
}

/** Type for the thread writer function */
type ThreadWriter = (content: string, responseMessageId?: string) => Promise<void>;

/**
 * Attempt to parse a truncated JSON array by finding the last complete object.
 * Returns parsed array of complete objects, or throws if nothing salvageable.
 */
function salvageTruncatedJsonArray(text: string): any[] {
  // Find the last complete object boundary: "},\n  {" or "}\n]"
  // Walk backwards to find the last "}," or "}" that closes a complete object
  let lastGoodEnd = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") {
      depth--;
      // At depth 1, we just closed a top-level array element
      if (depth === 1 && ch === "}") {
        lastGoodEnd = i;
      }
    }
  }

  if (lastGoodEnd === -1) {
    throw new Error("No complete objects found in truncated JSON");
  }

  // Slice up to and including the last complete object, then close the array
  const salvaged = text.slice(0, lastGoodEnd + 1) + "\n]";
  return JSON.parse(salvaged);
}

// ── Public: Retry failed application ──

export const retryApplication = action({
  args: { sessionId: v.id("applicationSessions") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const session = await ctx.runQuery(api.applicationSessions.get, { id: args.sessionId });
    if (!session) return { error: "Session not found" };
    if (!session.error && session.status !== "extracting_fields") {
      return { error: "Session is not in an error state" };
    }

    // Download the stored PDF for re-processing
    const pdfUrl = await ctx.runQuery(api.applicationSessions.getSourceFileUrl, { id: args.sessionId });
    if (!pdfUrl) return { error: "Source PDF not found" };

    const pdfResponse = await fetch(pdfUrl);
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    const pdfBase64 = pdfBuffer.toString("base64");

    // Get fromEmail from the conversation record
    const conversation = await ctx.runQuery(internal.agentConversations.getInternal, { id: session.conversationId });
    const fromEmail = conversation?.fromEmail ?? "";

    // Get agent handle from the org
    const org = await ctx.runQuery(internal.orgs.getInternal, { id: session.orgId });
    const agentHandle = org?.agentHandle ?? "agent";
    const agentAddress = `${agentHandle}@${getAgentDomain()}`;

    // Reset session and clear conversation error
    await ctx.runMutation(internal.applicationSessions.resetForRetry, { id: args.sessionId });
    await ctx.runMutation(internal.agentConversations.clearError, { id: session.conversationId });

    // Re-schedule the application processing, reusing the existing session
    await ctx.scheduler.runAfter(0, internal.actions.processApplication.startApplicationSession, {
      conversationId: session.conversationId,
      orgId: session.orgId,
      userId: session.userId,
      fileId: session.sourceFileId,
      fileName: session.sourceFileName,
      pdfBase64,
      fromEmail,
      subject: session.applicationTitle ?? "Application Retry",
      agentAddress,
      threadId: session.threadId,
      applicationTitle: session.applicationTitle,
      messageId: session.originalMessageId ?? undefined,
      existingSessionId: args.sessionId,
    });

    return { success: true };
  },
});

export const fillApplicationPdf = action({
  args: { sessionId: v.id("applicationSessions") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const session = await ctx.runQuery(api.applicationSessions.get, { id: args.sessionId });
    if (!session) return { error: "Session not found" };
    if (!["complete", "confirmed"].includes(session.status)) {
      return { error: "Application must be complete or confirmed before filling" };
    }
    if (session.filledFileId) {
      return { error: "Filled PDF already exists" };
    }

    // Download source PDF
    const pdfUrl = await ctx.runQuery(api.applicationSessions.getSourceFileUrl, { id: args.sessionId });
    if (!pdfUrl) return { error: "Source PDF not found" };

    const pdfResponse = await fetch(pdfUrl);
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());

    // Get extracted fields with values
    const fields = session.parsedFields ?? [];
    const fieldsWithValues = fields.filter((f: any) => f.value);
    if (fieldsWithValues.length === 0) {
      return { error: "No filled field values to map" };
    }

    // Load and check for AcroForm fields
    let pdfCompatible = true;
    let acroFields: ReturnType<typeof getAcroFormFields> = [];
    let overlayBytes = pdfBytes; // bytes used for overlay path (may be flattened)
    try {
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      // Test page access upfront — some PDFs load but have broken page trees
      pdfDoc.getPageCount();
      acroFields = getAcroFormFields(pdfDoc);
    } catch {
      // pdf-lib can't handle this PDF — try flattening via mupdf API route
      const flattenApiKey = process.env.FLATTEN_API_KEY;
      if (flattenApiKey) {
        try {
          console.log("pdf-lib failed, attempting PDF flattening via API route...");
          const flattenUrl = `${getAppUrl()}/api/flatten-pdf`;
          const flattenResp = await fetch(flattenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${flattenApiKey}`,
            },
            body: JSON.stringify({ pdfBase64: Buffer.from(pdfBytes).toString("base64") }),
          });
          if (flattenResp.ok) {
            const { pdfBase64 } = await flattenResp.json();
            const flattenedBytes = new Uint8Array(Buffer.from(pdfBase64, "base64"));
            // Verify flattened PDF loads in pdf-lib
            const flatDoc = await PDFDocument.load(flattenedBytes, { ignoreEncryption: true });
            flatDoc.getPageCount();
            overlayBytes = flattenedBytes;
            pdfCompatible = true;
            console.log("PDF flattened successfully, proceeding with overlay path");
          } else {
            const errBody = await flattenResp.text();
            console.warn("Flatten API returned error:", flattenResp.status, errBody);
          }
        } catch (flattenErr) {
          console.warn("PDF flattening failed:", flattenErr instanceof Error ? flattenErr.message : flattenErr);
        }
      }
      if (!pdfCompatible) {
        console.log("PDF incompatible with pdf-lib, using standalone fallback");
      }
    }
    let filledBytes: Uint8Array;
    let fieldsMapped: number;
    let mode: "acroform" | "overlay" | "standalone";

    if (acroFields.length > 0) {
      // ── AcroForm path: map extracted fields to form field names ──
      mode = "acroform";
      const mappingPrompt = buildAcroFormMappingPrompt(
        fieldsWithValues.map((f: any) => ({ id: f.id, label: f.label ?? f.text, value: f.value })),
        acroFields,
      );

      const { text: responseText } = await generateText({
        model: haikuModel,
        maxOutputTokens: 4096,
        messages: [{ role: "user", content: mappingPrompt }],
      });
      const parsed = JSON.parse(stripFences(responseText));
      const mappings: { acroFormName: string; value: string }[] = (parsed.mappings ?? []).map(
        (m: any) => ({ acroFormName: m.acroFormName, value: m.value }),
      );

      if (mappings.length === 0) {
        return { error: "Could not map any fields to the PDF form. The form field names may not match the extracted data." };
      }

      filledBytes = await fillAcroForm(pdfBytes, mappings);
      fieldsMapped = mappings.length;
    } else if (pdfCompatible) {
      // ── Flat PDF path: use Claude Vision to locate fields and overlay text ──
      mode = "overlay";
      // Always send original PDF to Vision (better quality for field detection)
      const pdfBase64 = Buffer.from(pdfBytes).toString("base64");
      const mappingPrompt = buildFlatPdfMappingPrompt(
        fieldsWithValues.map((f: any) => ({
          id: f.id,
          label: f.label ?? f.text,
          value: f.value,
          fieldType: f.fieldType,
        })),
      );

      const { text: responseText } = await generateText({
        model: haikuModel,
        maxOutputTokens: 16384,
        messages: [{
          role: "user",
          content: [
            {
              type: "file",
              data: pdfBase64,
              mediaType: "application/pdf",
            },
            { type: "text", text: mappingPrompt },
          ],
        }],
      });
      const parsed = JSON.parse(stripFences(responseText));
      const placements = parsed.placements ?? [];

      if (placements.length === 0) {
        return { error: "Could not locate any field positions on the PDF." };
      }

      const overlays = placements.map((p: any) => ({
        page: p.page,
        x: p.x,
        y: p.y,
        text: p.text,
        fontSize: p.fontSize ?? 10,
        isCheckmark: p.isCheckmark ?? false,
      }));

      filledBytes = await overlayTextOnPdf(overlayBytes, overlays);
      fieldsMapped = placements.length;
    } else {
      // ── Standalone path: generate a new PDF with filled values using pdf-lib ──
      // pdf-lib embeds fonts from its own bundle (no filesystem access needed)
      mode = "standalone";
      const standalonePdf = await PDFDocument.create();
      const font = await standalonePdf.embedFont(StandardFonts.Helvetica);
      const boldFont = await standalonePdf.embedFont(StandardFonts.HelveticaBold);

      const PAGE_WIDTH = 612; // Letter width in points
      const PAGE_HEIGHT = 792; // Letter height
      const MARGIN = 50;
      const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
      let page = standalonePdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let yPos = PAGE_HEIGHT - MARGIN;

      // Helper to add a new page when near bottom
      const ensureSpace = (needed: number) => {
        if (yPos - needed < MARGIN) {
          page = standalonePdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          yPos = PAGE_HEIGHT - MARGIN;
        }
      };

      // Helper to wrap long text across multiple lines
      const drawWrappedText = (text: string, size: number, f: typeof font, color: { r: number; g: number; b: number }) => {
        const words = text.split(" ");
        let line = "";
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          const testWidth = f.widthOfTextAtSize(testLine, size);
          if (testWidth > CONTENT_WIDTH && line) {
            ensureSpace(size + 4);
            page.drawText(line, { x: MARGIN, y: yPos, size, font: f, color: rgb(color.r, color.g, color.b) });
            yPos -= size + 4;
            line = word;
          } else {
            line = testLine;
          }
        }
        if (line) {
          ensureSpace(size + 4);
          page.drawText(line, { x: MARGIN, y: yPos, size, font: f, color: rgb(color.r, color.g, color.b) });
          yPos -= size + 4;
        }
      };

      // Title
      const title = "Filled Application Values";
      const titleWidth = boldFont.widthOfTextAtSize(title, 18);
      page.drawText(title, {
        x: (PAGE_WIDTH - titleWidth) / 2, y: yPos, size: 18, font: boldFont, color: rgb(0, 0, 0),
      });
      yPos -= 28;

      const subtitle = `Generated ${new Date().toLocaleDateString()} — source PDF could not be modified directly`;
      const subWidth = font.widthOfTextAtSize(subtitle, 9);
      page.drawText(subtitle, {
        x: (PAGE_WIDTH - subWidth) / 2, y: yPos, size: 9, font, color: rgb(0.4, 0.4, 0.4),
      });
      yPos -= 24;

      // Group fields by section
      const sections = new Map<string, typeof fieldsWithValues>();
      for (const field of fieldsWithValues) {
        const section = (field as any).section ?? "General";
        if (!sections.has(section)) sections.set(section, []);
        sections.get(section)!.push(field);
      }

      for (const [section, sectionFields] of sections) {
        ensureSpace(30);
        page.drawText(section, {
          x: MARGIN, y: yPos, size: 13, font: boldFont, color: rgb(0.1, 0.34, 0.86),
        });
        yPos -= 20;

        for (const field of sectionFields) {
          const label = (field as any).label ?? (field as any).text ?? (field as any).id;
          const value = String((field as any).value);

          ensureSpace(28);
          drawWrappedText(label, 9, font, { r: 0.4, g: 0.4, b: 0.4 });
          drawWrappedText(value, 10, font, { r: 0, g: 0, b: 0 });
          yPos -= 4;
        }
        yPos -= 8;
      }

      filledBytes = await standalonePdf.save();
      fieldsMapped = fieldsWithValues.length;
    }

    // Store in Convex
    const blob = new Blob([Buffer.from(filledBytes)], { type: "application/pdf" });
    const fileId = await ctx.storage.store(blob);

    // Update session
    await ctx.runMutation(internal.applicationSessions.setFilledFileId, {
      id: args.sessionId,
      filledFileId: fileId,
    });

    return { success: true, fieldsMapped, mode };
  },
});

// ── Email helpers ──

function buildSignature(
  agentEmail: string,
  companyName?: string,
): { text: string; html: string } {
  const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";
  const linkText = `Sent by Prism${companyName ? ` from ${companyName}` : ""}`;
  const text = [
    "",
    "—",
    `Prism${companyName ? ` for ${companyName}` : ""}`,
    agentEmail,
    `${linkText} - ${siteUrl}`,
  ].join("\n");

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">—</p>`,
    `<p style="font-size:13px;margin:4px 0 2px"><span style="color:#A0D2FA;font-size:13px;font-family:'Segoe UI Symbol','Apple Symbols',sans-serif">&#x2733;&#xFE0E;</span> <strong>Prism${companyName ? ` for ${companyName}` : ""}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
    `<p style="font-size:12px;margin:12px 0 0"><a href="${siteUrl}" style="color:#A0D2FA;text-decoration:none">${linkText}</a></p>`,
  ].join("\n");

  return { text, html };
}

function markdownToHtml(text: string): string {
  let result = text;
  // Convert markdown headers to bold (emails don't render # syntax)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" style="color:#2563eb;text-decoration:underline">$1</a>',
  );
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return result;
}

function textToHtml(text: string): string {
  return text
    .split("\n\n")
    .map(
      (p) =>
        `<p style="margin:0 0 12px;line-height:1.5">${markdownToHtml(p.replace(/\n/g, "<br>"))}</p>`,
    )
    .join("\n");
}

function stripMarkdown(text: string): string {
  let result = text;
  // Strip header markers, keep text
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/\*(.+?)\*/g, "$1");
  return result;
}

async function sendEmail(
  agentAddress: string,
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml: string,
  headers?: Record<string, string>,
): Promise<string | undefined> {
  const emailPayload: Record<string, unknown> = {
    from: `Prism <${agentAddress}>`,
    to,
    subject,
    text: bodyText,
    html: bodyHtml,
  };
  if (headers && Object.keys(headers).length > 0) {
    emailPayload.headers = headers;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  const resBody = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to send email: ${resBody}`);
  }

  try {
    return JSON.parse(resBody).id;
  } catch {
    return undefined;
  }
}

function getFieldLabel(field: FormField): string {
  if (field.fieldType === "declaration") {
    return (field as any).text ?? field.id;
  }
  return (field as any).label ?? field.id;
}

async function generateBatchEmail(
  fields: FormField[],
  batchFieldIds: string[],
  batchIndex: number,
  totalBatches: number,
  appTitle: string | undefined,
  totalFieldCount: number,
  filledFieldCount: number,
  previousBatchSummary?: string,
  companyName?: string,
): Promise<{ text: string; html: string }> {
  const batchFields = batchFieldIds
    .map((id) => fields.find((f) => f.id === id))
    .filter(Boolean) as FormField[];

  const fieldMeta = batchFields.map((f) => ({
    id: f.id,
    label: getFieldLabel(f),
    fieldType: f.fieldType,
    options: (f as any).options as string[] | undefined,
    condition: (f as any).condition as { dependsOn: string; whenValue: string } | undefined,
  }));

  const { text: body } = await generateText({
    model: haikuModel,
    maxOutputTokens: 2048,
    messages: [
      {
        role: "user",
        content: buildBatchEmailGenerationPrompt(
          fieldMeta,
          batchIndex,
          totalBatches,
          appTitle,
          totalFieldCount,
          filledFieldCount,
          previousBatchSummary,
          companyName,
        ),
      },
    ],
  });
  return {
    text: stripMarkdown(body),
    html: textToHtml(body),
  };
}

function buildPreviousBatchSummary(
  fields: FormField[],
  answeredFieldIds: string[],
): string {
  return answeredFieldIds
    .map((id) => {
      const field = fields.find((f) => f.id === id);
      if (!field) return null;
      const label = getFieldLabel(field);
      const value = (field as any).value ?? (field as any).explanation ?? "(provided)";
      return `- ${label}: ${value}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildAutoFillSummary(
  fields: FormField[],
  fills: AutoFillResult[],
): string {
  return fills
    .map((fill) => {
      const field = fields.find((f) => f.id === fill.fieldId);
      const label = field ? getFieldLabel(field) : fill.fieldId;
      return `- ${label}: ${fill.value} (from ${fill.source})`;
    })
    .join("\n");
}

type AutoFillResult = { fieldId: string; value: string; source: string };

/** Pre-fill coverage/policy fields from existing policy data before sending a batch.
 *  Returns fills with source attribution. */
async function preFillFromPolicies(
  ctx: any,
  fields: FormField[],
  batchFieldIds: string[],
  orgId: any,
  userId: any,
): Promise<AutoFillResult[]> {
  // Identify unfilled batch fields that look coverage/policy-related
  const coverageKeywords = ["policy", "carrier", "insurer", "coverage", "limit", "deductible", "premium", "currently carry", "current insurance", "expir", "effective date"];
  const candidateFields = batchFieldIds
    .map((id) => fields.find((f) => f.id === id))
    .filter((f): f is FormField => !!f && !(f as any).value)
    .filter((f) => {
      const label = getFieldLabel(f).toLowerCase();
      const id = f.id.toLowerCase();
      return coverageKeywords.some((kw) => label.includes(kw) || id.includes(kw));
    });

  if (candidateFields.length === 0) return [];

  // Load policy + business context data
  const lookupData = await loadLookupContext(ctx, orgId, userId, ["policy", "business_context"]);
  if (!lookupData) return [];

  const { text } = await generateText({
    model: haikuModel,
    maxOutputTokens: 2048,
    messages: [
      {
        role: "user",
        content: buildLookupFillPrompt(
          [{ type: "policy", description: "Fill coverage/policy fields from existing policy records", targetFieldIds: candidateFields.map((f) => f.id) }],
          candidateFields.map((f) => ({ id: f.id, label: getFieldLabel(f), fieldType: f.fieldType })),
          lookupData,
        ),
      },
    ],
  });
  const fills: AutoFillResult[] = [];
  try {
    const result = JSON.parse(stripFences(text));
    for (const fill of result.fills ?? []) {
      const field = fields.find((f) => f.id === fill.fieldId);
      if (field) {
        (field as any).value = fill.value;
        (field as any).source = "org_context";
        (field as any).sourceDetail = fill.source; // e.g. "Cyber Policy #ABC123"
        (field as any).confidence = "confirmed";
        fills.push({ fieldId: fill.fieldId, value: fill.value, source: fill.source ?? "existing records" });
      }
    }
  } catch {
    // Non-critical
  }
  return fills;
}

async function loadLookupContext(
  ctx: any,
  orgId: any,
  userId: any,
  requestTypes: string[],
  webUrls?: string[],
): Promise<string> {
  const sections: string[] = [];

  if (requestTypes.includes("policy") || requestTypes.includes("quote")) {
    const policies = await ctx.runQuery(
      internal.policies.listAllInternal,
      { orgId },
    );

    if (requestTypes.includes("policy")) {
      const policyLines = policies
        .filter((p: any) => p.documentType !== "quote")
        .map((p: any) => {
          const types = (p.policyTypes ?? []).join(", ") || p.policyType || "Unknown";
          const covs = (p.coverages ?? [])
            .map((c: any) => `${c.name}: limit ${c.limit}${c.deductible ? `, deductible ${c.deductible}` : ""}`)
            .join("; ");
          return `Policy: ${p.security ?? p.carrier} #${p.policyNumber} (${types}) | Effective: ${p.effectiveDate} - ${p.expirationDate}${p.premium ? ` | Premium: ${p.premium}` : ""}${covs ? ` | Coverages: ${covs}` : ""}`;
        });
      if (policyLines.length > 0) {
        sections.push("POLICIES:\n" + policyLines.join("\n"));
      }
    }

    if (requestTypes.includes("quote")) {
      const quoteLines = policies
        .filter((p: any) => p.documentType === "quote")
        .map((p: any) => {
          const types = (p.policyTypes ?? []).join(", ") || p.policyType || "Unknown";
          const covs = (p.coverages ?? [])
            .map((c: any) => `${c.name}: limit ${c.limit}`)
            .join("; ");
          return `Quote: ${p.security ?? p.carrier} (${types})${p.premium ? ` | Premium: ${p.premium}` : ""}${covs ? ` | Coverages: ${covs}` : ""}`;
        });
      if (quoteLines.length > 0) {
        sections.push("QUOTES:\n" + quoteLines.join("\n"));
      }
    }
  }

  if (requestTypes.includes("profile")) {
    const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
    const user = await ctx.runQuery(internal.users.getInternal, { id: userId });
    const profileLines: string[] = [];
    if (user?.name) profileLines.push(`Contact Name: ${user.name}`);
    if (user?.email) profileLines.push(`Contact Email: ${user.email}`);
    if (user?.phone) profileLines.push(`Contact Phone: ${user.phone}`);
    if (user?.title) profileLines.push(`Title: ${user.title}`);
    if (org?.name) profileLines.push(`Organization: ${org.name}`);
    if (org?.industry) profileLines.push(`Industry: ${org.industry}`);
    if (org?.website) profileLines.push(`Website: ${org.website}`);
    if (profileLines.length > 0) {
      sections.push("PROFILE:\n" + profileLines.join("\n"));
    }
  }

  if (requestTypes.includes("business_context")) {
    const intelEntries = await ctx.runQuery(
      internal.intelligence.listActiveByOrg,
      { orgId },
    );
    if (intelEntries.length > 0) {
      const grouped = new Map<string, string[]>();
      for (const entry of intelEntries) {
        const cat = grouped.get(entry.category) ?? [];
        cat.push(entry.content);
        grouped.set(entry.category, cat);
      }
      const contextLines = Array.from(grouped.entries())
        .map(([cat, items]) => `[${cat}]\n${items.join("\n")}`)
        .join("\n\n");
      sections.push("BUSINESS CONTEXT:\n" + contextLines);
    }
  }

  // Fetch third-party websites for web lookup requests
  if (requestTypes.includes("web") && webUrls?.length) {
    for (const rawUrl of webUrls) {
      try {
        const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
        const webRes = await fetch(url, {
          headers: { "User-Agent": "Prism/1.0 (Insurance Application Assistant)" },
          signal: AbortSignal.timeout(10000),
        });
        if (webRes.ok) {
          const html = await webRes.text();
          const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 6000);
          if (textContent.length > 50) {
            sections.push(`WEB CONTENT (${rawUrl}):\n${textContent}`);
          }
        }
      } catch (err) {
        console.warn(`Web lookup failed for ${rawUrl}:`, err);
      }
    }
  }

  return sections.join("\n\n---\n\n");
}

function buildConfirmationEmail(
  summaryText: string,
  appTitle?: string,
): { text: string; html: string } {
  const lines: string[] = [];
  if (appTitle) {
    lines.push(`**${appTitle}** — Review & Confirm`);
  } else {
    lines.push("**Application Summary** — Review & Confirm");
  }
  lines.push("");
  lines.push(summaryText);

  const text = stripMarkdown(lines.join("\n"));
  const html = textToHtml(lines.join("\n"));
  return { text, html };
}

// ── 6A: Classify PDF ──

export const classifyApplicationPdf = internalAction({
  args: { pdfBase64: v.string() },
  handler: async (_ctx, args) => {
    const { text } = await generateText({
      model: haikuModel,
      maxOutputTokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: args.pdfBase64,
              mediaType: "application/pdf",
            },
            { type: "text", text: APPLICATION_CLASSIFY_PROMPT },
          ],
        },
      ],
    });
    try {
      return JSON.parse(stripFences(text));
    } catch {
      return { isApplication: false, confidence: 0, applicationType: null };
    }
  },
});

// ── 6B: Start Application Session ──

export const startApplicationSession = internalAction({
  args: {
    conversationId: v.id("agentConversations"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    pdfBase64: v.string(),
    fromEmail: v.string(),
    subject: v.string(),
    agentAddress: v.string(),
    threadId: v.optional(v.id("agentConversations")),
    companyName: v.optional(v.string()),
    applicationTitle: v.optional(v.string()),
    messageId: v.optional(v.string()),
    existingSessionId: v.optional(v.id("applicationSessions")),
  },
  handler: async (ctx, args) => {
    // 1. Create session (or reuse existing one on retry)
    const sessionId = args.existingSessionId ?? await ctx.runMutation(
      internal.applicationSessions.create,
      {
        orgId: args.orgId,
        userId: args.userId,
        conversationId: args.conversationId,
        threadId: args.threadId ?? args.conversationId,
        sourceFileId: args.fileId,
        sourceFileName: args.fileName,
        applicationTitle: args.applicationTitle,
        originalMessageId: args.messageId,
      },
    );

    // Helper to build threading headers from the session's message chain
    const buildThreadHeaders = (lastSentId?: string): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (args.messageId) {
        headers["In-Reply-To"] = lastSentId ?? args.messageId;
        // References should include original + all intermediate IDs
        const refs = [args.messageId];
        if (lastSentId && lastSentId !== args.messageId) refs.push(lastSentId);
        headers["References"] = refs.join(" ");
      }
      return headers;
    };

    // Track latest sent messageId for threading chain
    let lastSentId: string | undefined;

    // Resolve unified thread for dual-writing agent messages
    const writeToThread = await createThreadWriter(ctx, args.conversationId, args.orgId, args.agentAddress);

    try {
      // 1b. Send immediate acknowledgment email
      if (args.fromEmail) {
        const appName = args.applicationTitle ?? args.fileName;
        const ackText = `Got the "${appName}" — I'm reviewing the form now and will start filling in what I can from our records. I'll follow up shortly with any questions I need your help on.`;
        const signature = buildSignature(args.agentAddress, args.companyName);
        const ackHtml = textToHtml(ackText);
        const ackSentId = await sendEmail(
          args.agentAddress,
          args.fromEmail,
          `Re: ${args.subject}`,
          stripMarkdown(ackText) + signature.text,
          ackHtml + signature.html,
          buildThreadHeaders(),
        );

        if (ackSentId) {
          lastSentId = ackSentId;
          await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
            id: sessionId,
            lastSentMessageId: ackSentId,
          });
        }

        await ctx.runMutation(internal.agentConversations.updateResponse, {
          id: args.conversationId,
          responseBody: ackText,
          responseTo: args.fromEmail,
          responseMessageId: ackSentId,
        });

        await writeToThread(ackText, ackSentId);
      }

      // 2. Extract fields from PDF using Sonnet with citations
      const extractionResponse = await generateText({
        model: sonnetModel,
        maxOutputTokens: 16384,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "file",
                data: args.pdfBase64,
                mediaType: "application/pdf",
              },
              {
                type: "text",
                text: buildFieldExtractionPrompt(),
              },
            ],
          },
        ],
      });

      // Parse fields from response
      const fieldsText = extractionResponse.text;
      const rawExtraction = fieldsText;
      const cleaned = stripFences(fieldsText).trim();

      let fields: FormField[];
      try {
        fields = JSON.parse(cleaned);
      } catch {
        // If JSON is truncated (hit max_tokens), try to salvage partial array
        fields = salvageTruncatedJsonArray(cleaned);
      }

      if (!Array.isArray(fields) || fields.length === 0) {
        console.error("Field extraction raw (first 500 chars):", rawExtraction.slice(0, 500));
        throw new Error(
          `Field extraction returned no parseable fields (finishReason: ${extractionResponse.finishReason}, ${rawExtraction.length} chars)`,
        );
      }

      if (extractionResponse.finishReason === "length") {
        console.warn(`Field extraction truncated — salvaged ${fields.length} fields from partial output`);
      }

      const totalFields = fields.length;
      const filledFields = fields.filter(
        (f) => f.fieldType !== "table" ? (f as any).value : (f as any).rows?.length > 0,
      ).length;

      await ctx.runMutation(internal.applicationSessions.updateFields, {
        id: sessionId,
        extractedFields: JSON.stringify(fields),
        totalFields,
        filledFields,
        rawExtractionResponse: rawExtraction,
      });

      // 3. Auto-fill from org context, org details, user info, and web research
      await ctx.runMutation(internal.applicationSessions.updateStatus, {
        id: sessionId,
        status: "filling_known",
      });

      // Gather all available context sources
      const intelligenceEntries = await ctx.runQuery(
        internal.intelligence.listActiveByOrg,
        { orgId: args.orgId },
      );

      const org = await ctx.runQuery(internal.orgs.getInternal, { id: args.orgId });
      const user = await ctx.runQuery(internal.users.getInternal, { id: args.userId });

      // Build enriched context from org details, user info, and orgIntelligence
      const contextEntries: { key: string; value: string; category: string }[] = [];

      // Add org details
      if (org) {
        if (org.name) contextEntries.push({ key: "company_name", value: org.name, category: "company_info" });
        if (org.website) contextEntries.push({ key: "company_website", value: org.website, category: "company_info" });
        if (org.industry) contextEntries.push({ key: "industry", value: org.industry, category: "company_info" });
        if (org.industryVertical) contextEntries.push({ key: "industry_vertical", value: org.industryVertical, category: "company_info" });
        if (org.context) contextEntries.push({ key: "business_description", value: org.context, category: "company_info" });
        if (org.insuranceBroker) contextEntries.push({ key: "insurance_broker", value: org.insuranceBroker, category: "company_info" });
        if (org.brokerContactName) contextEntries.push({ key: "broker_contact_name", value: org.brokerContactName, category: "company_info" });
        if (org.brokerContactEmail) contextEntries.push({ key: "broker_contact_email", value: org.brokerContactEmail, category: "company_info" });
      }

      // Add user contact info
      if (user) {
        if (user.name) contextEntries.push({ key: "contact_name", value: user.name, category: "contact_info" });
        if (user.email) contextEntries.push({ key: "contact_email", value: user.email, category: "contact_info" });
        if (user.title) contextEntries.push({ key: "contact_title", value: user.title, category: "contact_info" });
        if (user.phone) contextEntries.push({ key: "contact_phone", value: user.phone, category: "contact_info" });
      }

      // Add orgIntelligence entries as context
      for (const entry of intelligenceEntries) {
        contextEntries.push({
          key: `intel_${entry._id}`,
          value: entry.content,
          category: entry.category,
        });
      }

      // Web research on org website for additional context
      if (org?.website) {
        try {
          const websiteUrl = org.website.startsWith("http") ? org.website : `https://${org.website}`;
          const webRes = await fetch(websiteUrl, {
            headers: { "User-Agent": "Prism/1.0 (Insurance Application Assistant)" },
            signal: AbortSignal.timeout(10000),
          });
          if (webRes.ok) {
            const html = await webRes.text();
            // Extract useful text content (strip HTML tags, limit size)
            const textContent = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 4000);

            if (textContent.length > 100) {
              // Use Haiku to extract relevant business info from website
              const { text: webInfoText } = await generateText({
                model: haikuModel,
                maxOutputTokens: 1024,
                messages: [
                  {
                    role: "user",
                    content: `Extract key business information from this company website text that would be useful for filling out an insurance application. Focus on: business description, services offered, years in business, number of employees, locations/addresses, revenue indicators, certifications, and any other relevant details.

Website (${org.website}):
${textContent}

Respond with JSON only:
{
  "facts": [
    { "key": "short_key", "value": "extracted value", "category": "company_info|operations|financial" }
  ]
}

Only include facts you are confident about. Do not fabricate.`,
                  },
                ],
              });

              try {
                const { facts } = JSON.parse(stripFences(webInfoText));
                for (const fact of facts ?? []) {
                  if (fact.key && fact.value && !contextEntries.some((e) => e.key === fact.key)) {
                    contextEntries.push({
                      key: String(fact.key),
                      value: String(fact.value),
                      category: String(fact.category ?? "company_info"),
                    });
                  }
                }
              } catch {
                console.warn("Failed to parse web research response");
              }
            }
          }
        } catch (err) {
          console.warn("Web research failed (non-critical):", err);
        }
      }

      // Look up NAICS/SIC codes if any extracted fields need them
      const codeFieldPatterns = /naics|naic|sic[_ ]code|industry[_ ]code|classification[_ ]code/i;
      const hasCodeField = fields.some((f) =>
        codeFieldPatterns.test(f.id) || codeFieldPatterns.test(getFieldLabel(f)),
      );

      if (hasCodeField && (org?.industry || org?.industryVertical || contextEntries.some((e) => e.key === "business_description"))) {
        try {
          const industryDesc = [
            org?.industry,
            org?.industryVertical,
            contextEntries.find((e) => e.key === "business_description")?.value,
          ].filter(Boolean).join(". ");

          const { text: naicsText } = await generateText({
            model: haikuModel,
            maxOutputTokens: 256,
            messages: [{
              role: "user",
              content: `What is the most appropriate NAICS code and SIC code for this business?

Business: ${org?.name ?? ""}
Industry info: ${industryDesc}

Respond with JSON only:
{
  "naics_code": "6-digit NAICS code",
  "naics_description": "official NAICS description",
  "sic_code": "4-digit SIC code",
  "sic_description": "official SIC description"
}

Use the most specific code that applies. Do not guess if the info is insufficient — omit codes you aren't confident about.`,
            }],
          });
          try {
            const codes = JSON.parse(stripFences(naicsText));
            if (codes.naics_code) {
              contextEntries.push({ key: "naics_code", value: String(codes.naics_code), category: "company_info" });
              if (codes.naics_description) contextEntries.push({ key: "naics_description", value: String(codes.naics_description), category: "company_info" });
            }
            if (codes.sic_code) {
              contextEntries.push({ key: "sic_code", value: String(codes.sic_code), category: "company_info" });
              if (codes.sic_description) contextEntries.push({ key: "sic_description", value: String(codes.sic_description), category: "company_info" });
            }
          } catch {
            console.warn("Failed to parse NAICS lookup response");
          }
        } catch (err) {
          console.warn("NAICS lookup failed (non-critical):", err);
        }
      }

      // Load existing policies for current insurance info (carrier, policy number, limits, etc.)
      const existingPolicies = await ctx.runQuery(
        internal.policies.listAllInternal,
        { orgId: args.orgId },
      );

      // Convert policies to context entries
      const policyTypeLabels: Record<string, string> = {
        gl: "General Liability", cgl: "General Liability", general_liability: "General Liability",
        pl: "Professional Liability", professional_liability: "Professional Liability", eando: "Professional Liability",
        wc: "Workers Compensation", workers_comp: "Workers Compensation",
        property: "Commercial Property", commercial_property: "Commercial Property",
        auto: "Commercial Auto", commercial_auto: "Commercial Auto",
        umbrella: "Umbrella", excess: "Excess Liability",
        cyber: "Cyber Liability", epli: "EPLI", dando: "D&O",
      };

      // Track which policy types we have for the "missing policy" note
      const availablePolicyTypes: string[] = [];

      for (const policy of existingPolicies) {
        const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
        const typeLabel = types.map((t: string) => policyTypeLabels[t.toLowerCase()] ?? t).join(", ") || "Insurance";
        const prefix = `current_${types[0]?.toLowerCase()?.replace(/\s+/g, "_") ?? "policy"}`;
        availablePolicyTypes.push(...types.map((t: string) => (policyTypeLabels[t.toLowerCase()] ?? t).toLowerCase()));

        contextEntries.push({ key: `${prefix}_carrier`, value: policy.security ?? policy.carrier, category: "current_insurance" });
        contextEntries.push({ key: `${prefix}_policy_number`, value: policy.policyNumber, category: "current_insurance" });
        contextEntries.push({ key: `${prefix}_effective_date`, value: policy.effectiveDate, category: "current_insurance" });
        contextEntries.push({ key: `${prefix}_expiration_date`, value: policy.expirationDate, category: "current_insurance" });
        if (policy.premium) contextEntries.push({ key: `${prefix}_premium`, value: policy.premium, category: "current_insurance" });
        if (policy.broker) contextEntries.push({ key: `${prefix}_broker`, value: policy.broker, category: "current_insurance" });
        if (policy.insuredName) contextEntries.push({ key: `${prefix}_insured_name`, value: policy.insuredName, category: "current_insurance" });

        // Add coverage limits
        for (const cov of policy.coverages ?? []) {
          const covKey = `${prefix}_${cov.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_limit`;
          if (!contextEntries.some((e) => e.key === covKey)) {
            contextEntries.push({ key: covKey, value: cov.limit ?? "N/A", category: "current_insurance" });
            if (cov.deductible) {
              contextEntries.push({
                key: covKey.replace("_limit", "_deductible"),
                value: cov.deductible,
                category: "current_insurance",
              });
            }
          }
        }
      }

      // Determine the application type being filled
      const appTypeStr = (args.applicationTitle ?? args.fileName ?? "").toLowerCase();

      // Check if we have a matching current policy for this application type
      const hasMatchingPolicy = availablePolicyTypes.some((t) => appTypeStr.includes(t)) || existingPolicies.length > 0;

      // If we don't have a matching policy, add a note so the prompt knows
      if (!hasMatchingPolicy || existingPolicies.length === 0) {
        contextEntries.push({
          key: "NO_CURRENT_POLICY_NOTE",
          value: "No current insurance policies found on file. When asking about current/expiring policy details (carrier, policy number, premium, limits), note that we don't have this information and ask the user if they have a current policy.",
          category: "current_insurance",
        });
      }

      // Run auto-fill with all collected context
      const simpleFields = fields
        .filter((f) => f.fieldType !== "table")
        .map((f) => ({
          id: f.id,
          label: getFieldLabel(f),
          fieldType: f.fieldType,
          section: f.section,
        }));

      let initialAutoFills: AutoFillResult[] = [];
      if (simpleFields.length > 0 && contextEntries.length > 0) {
        const { text: autoFillText } = await generateText({
          model: haikuModel,
          maxOutputTokens: 4096,
          messages: [
            {
              role: "user",
              content: buildAutoFillPrompt(simpleFields, contextEntries),
            },
          ],
        });
        try {
          const { matches } = JSON.parse(stripFences(autoFillText));
          for (const match of matches) {
            const field = fields.find((f) => f.id === match.fieldId);
            if (field && field.fieldType !== "table") {
              (field as any).value = match.value;
              (field as any).source = "org_context";
              (field as any).confidence = match.confidence === "confirmed" ? "confirmed" : "inferred";
              // Map contextKey to a readable source
              const ctx = contextEntries.find((e) => e.key === match.contextKey);
              const sourceLabel = ctx?.category === "current_insurance" ? `existing ${ctx.key.replace(/^current_/, "").replace(/_/g, " ")}` : ctx?.category ?? "business context";
              (field as any).sourceDetail = sourceLabel;
              initialAutoFills.push({ fieldId: match.fieldId, value: match.value, source: sourceLabel });
            }
          }
        } catch {
          console.warn("Failed to parse auto-fill response");
        }
      }

      // Update filled count
      const newFilledFields = fields.filter(
        (f) => f.fieldType !== "table" ? (f as any).value : (f as any).rows?.length > 0,
      ).length;

      await ctx.runMutation(internal.applicationSessions.updateFields, {
        id: sessionId,
        extractedFields: JSON.stringify(fields),
        totalFields,
        filledFields: newFilledFields,
      });

      // 4. Auto-skip conditional fields whose parent condition is not met
      for (const field of fields) {
        if (!("condition" in field) || !(field as any).condition) continue;
        if ((field as any).value) continue; // already has a value
        const cond = (field as any).condition as { dependsOn: string; whenValue: string };
        const parent = fields.find((f) => f.id === cond.dependsOn);
        if (!parent) continue;
        const parentValue = ((parent as any).value ?? "").toString().toLowerCase().trim();
        if (parentValue && parentValue !== cond.whenValue.toLowerCase().trim()) {
          (field as any).value = "N/A";
          (field as any).source = "auto_skipped";
          (field as any).confidence = "confirmed";
        }
      }

      // Recount filled fields after auto-skipping
      const postSkipFilledFields = fields.filter(
        (f) => f.fieldType !== "table" ? (f as any).value : (f as any).rows?.length > 0,
      ).length;

      // Generate question batches for unfilled fields
      const unfilledFields = fields.filter((f) => {
        if (f.fieldType === "table") return !(f as any).rows?.length;
        return !(f as any).value;
      });

      if (unfilledFields.length === 0) {
        // All fields filled — go to confirmation
        await ctx.runMutation(internal.applicationSessions.updateStatus, {
          id: sessionId,
          status: "pending_confirmation",
          extractedFields: JSON.stringify(fields),
          filledFields: totalFields,
        });

        // Send confirmation email (threaded)
        const summary = await generateConfirmationSummary(
          fields,
          args.applicationTitle ?? args.fileName,
        );
        const { text, html } = buildConfirmationEmail(
          summary,
          args.applicationTitle,
        );
        const signature = buildSignature(args.agentAddress, args.companyName);
        const sentMessageId = await sendEmail(
          args.agentAddress,
          args.fromEmail,
          `Re: ${args.subject}`,
          stripMarkdown(text) + signature.text,
          html + signature.html,
          buildThreadHeaders(lastSentId),
        );
        if (sentMessageId) {
          await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
            id: sessionId, lastSentMessageId: sentMessageId,
          });
        }
        await writeToThread(stripMarkdown(text), sentMessageId);
      } else {
        // Generate batches
        await ctx.runMutation(internal.applicationSessions.updateStatus, {
          id: sessionId,
          status: "asking_questions",
          extractedFields: JSON.stringify(fields),
          filledFields: postSkipFilledFields,
        });

        const { text: batchText } = await generateText({
          model: haikuModel,
          maxOutputTokens: 2048,
          messages: [
            {
              role: "user",
              content: buildQuestionBatchPrompt(
                unfilledFields.map((f) => ({
                  id: f.id,
                  label: f.fieldType !== "declaration" ? (f as any).label : undefined,
                  text: f.fieldType === "declaration" ? (f as any).text : undefined,
                  fieldType: f.fieldType,
                  section: f.section,
                  required: (f as any).required ?? false,
                  condition: (f as any).condition,
                })),
              ),
            },
          ],
        });
        let batchGroups: string[][];
        try {
          const parsed = JSON.parse(stripFences(batchText));
          batchGroups = parsed.batches;
        } catch {
          // Fallback: single batch with all unfilled
          batchGroups = [unfilledFields.map((f) => f.id)];
        }

        const batches: QuestionBatch[] = batchGroups.map((fieldIds, i) => ({
          batchIndex: i,
          fieldIds,
          sent: false,
          answeredFieldIds: [],
          complete: false,
        }));

        // Send first batch
        const firstBatch = batches[0];
        firstBatch.sent = true;
        firstBatch.sentAt = Date.now();

        // Build auto-fill summary for the first email
        const initialFillSummary = initialAutoFills.length > 0
          ? `AUTO-FILLED FROM EXISTING RECORDS (tell user what was filled and from where, ask them to correct anything wrong):\n${buildAutoFillSummary(fields, initialAutoFills)}`
          : undefined;

        const { text, html } = await generateBatchEmail(
          fields,
          firstBatch.fieldIds,
          0,
          batches.length,
          args.applicationTitle,
          totalFields,
          postSkipFilledFields,
          initialFillSummary,
          args.companyName,
        );
        const signature = buildSignature(args.agentAddress, args.companyName);
        const sentMessageId = await sendEmail(
          args.agentAddress,
          args.fromEmail,
          `Re: ${args.subject}`,
          stripMarkdown(text) + signature.text,
          html + signature.html,
          buildThreadHeaders(lastSentId),
        );
        if (sentMessageId) {
          await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
            id: sessionId, lastSentMessageId: sentMessageId,
          });
        }
        await writeToThread(stripMarkdown(text), sentMessageId);

        await ctx.runMutation(internal.applicationSessions.updateBatches, {
          id: sessionId,
          questionBatches: JSON.stringify(batches),
          currentBatchIndex: 0,
        });
      }

      // Save new auto-filled values to orgIntelligence (skip transient/date fields)
      const autoFilledFields = fields
        .filter((f) => (f as any).source === "org_context" || (f as any).source === "inferred")
        .filter((f) => (f as any).value)
        .filter((f) => !isTransientField({ id: f.id, label: (f as any).label, text: (f as any).text, fieldType: f.fieldType }));

      if (autoFilledFields.length > 0) {
        const embedText = makeEmbedText();
        const intelEntries = await Promise.all(
          autoFilledFields.map(async (f) => {
            const label = getFieldLabel(f);
            const content = `${label}: ${(f as any).value}`;
            const embedding = await embedText(content);
            return {
              orgId: args.orgId,
              content,
              category: sectionToCategory(f.section),
              confidence: (f as any).confidence === "confirmed" ? "confirmed" : "inferred",
              source: "application",
              sourceRef: sessionId,
              embedding,
            };
          }),
        );
        await ctx.runMutation(internal.intelligence.bulkInsert, {
          entries: intelEntries,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Application session error:", message);
      await ctx.runMutation(internal.applicationSessions.updateError, {
        id: sessionId,
        error: message,
      });
      await ctx.runMutation(internal.agentConversations.updateError, {
        id: args.conversationId,
        error: `Application processing failed: ${message}`,
      });
    }
  },
});

// ── 6C: Process Application Reply ──

export const processApplicationReply = internalAction({
  args: {
    conversationId: v.id("agentConversations"),
    sessionId: v.id("applicationSessions"),
    body: v.string(),
    fromEmail: v.string(),
    agentAddress: v.string(),
    subject: v.string(),
    companyName: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const session = await ctx.runQuery(
        internal.applicationSessions.getInternal,
        { id: args.sessionId },
      );
      if (!session) throw new Error("Session not found");

      const fields: FormField[] = session.parsedFields;
      const batches: QuestionBatch[] = session.parsedBatches;
      const currentBatchIndex = session.currentBatchIndex ?? 0;
      const currentBatch = batches[currentBatchIndex];
      if (!currentBatch) throw new Error("No current batch found");

      // Threading helper using session's stored message IDs
      const origMsgId = session.originalMessageId ?? args.messageId;
      let lastSentId = session.lastSentMessageId;
      const buildThreadHeaders = (): Record<string, string> => {
        const headers: Record<string, string> = {};
        const replyTo = lastSentId ?? origMsgId;
        if (replyTo) {
          headers["In-Reply-To"] = replyTo;
          const refs = [origMsgId, lastSentId].filter(Boolean).join(" ");
          if (refs) headers["References"] = refs;
        }
        return headers;
      };

      // Resolve unified thread for dual-writing
      const writeToThread = await createThreadWriter(ctx, args.conversationId, session.orgId, args.agentAddress);

      const batchFields = currentBatch.fieldIds
        .map((id) => fields.find((f) => f.id === id))
        .filter(Boolean) as FormField[];

      const replySubject = args.subject.startsWith("Re:") ? args.subject : `Re: ${args.subject}`;
      const signature = buildSignature(args.agentAddress, args.companyName);
      const totalFields = session.totalFields ?? fields.length;

      // 1. CLASSIFY INTENT
      const { text: intentText } = await generateText({
        model: haikuModel,
        maxOutputTokens: 512,
        messages: [
          {
            role: "user",
            content: buildReplyIntentClassificationPrompt(
              batchFields.map((f) => ({ id: f.id, label: getFieldLabel(f) })),
              args.body,
            ),
          },
        ],
      });
      let intentResult: {
        primaryIntent: string;
        hasAnswers: boolean;
        questionText?: string | null;
        questionFieldIds?: string[];
        lookupRequests?: { type: string; description: string; targetFieldIds: string[]; url?: string }[];
      } = { primaryIntent: "answers_only", hasAnswers: true };

      try {
        intentResult = JSON.parse(stripFences(intentText));
      } catch {
        // Default to answers_only on parse failure
      }

      let explanationPrefix = "";
      let lookupSummary = "";
      let newlyAnsweredIds: string[] = [];

      // 2. HANDLE ANSWERS (answers_only or mixed)
      if (intentResult.hasAnswers || intentResult.primaryIntent === "answers_only" || intentResult.primaryIntent === "mixed") {
        const { text: parseText } = await generateText({
          model: haikuModel,
          maxOutputTokens: 2048,
          messages: [
            {
              role: "user",
              content: buildAnswerParsingPrompt(
                batchFields.map((f) => ({
                  id: f.id,
                  label: f.fieldType !== "declaration" ? (f as any).label : undefined,
                  text: f.fieldType === "declaration" ? (f as any).text : undefined,
                  fieldType: f.fieldType,
                })),
                args.body,
              ),
            },
          ],
        });
        let answers: { fieldId: string; value: string; explanation?: string }[] = [];

        try {
          const parsed = JSON.parse(stripFences(parseText));
          answers = parsed.answers ?? [];
        } catch {
          console.warn("Failed to parse answer response");
        }

        // Resolve relative date references (e.g. "today", "tomorrow") to actual dates
        await resolveRelativeDates(answers, fields);

        // Apply answers to fields
        for (const answer of answers) {
          const field = fields.find((f) => f.id === answer.fieldId);
          if (field) {
            if (field.fieldType === "declaration") {
              (field as any).value = answer.value;
              if (answer.explanation) (field as any).explanation = answer.explanation;
            } else {
              (field as any).value = answer.value;
            }
            (field as any).source = "user_answer";
            (field as any).confidence = "confirmed";
            if (!currentBatch.answeredFieldIds.includes(answer.fieldId)) {
              currentBatch.answeredFieldIds.push(answer.fieldId);
              newlyAnsweredIds.push(answer.fieldId);
            }
          }
        }

        // Save answers to orgIntelligence (skip transient/date fields)
        const answerFields = answers
          .filter((a) => a.value)
          .filter((a) => {
            const field = fields.find((f) => f.id === a.fieldId);
            return field ? !isTransientField({ id: field.id, label: (field as any).label, text: (field as any).text, fieldType: field.fieldType }) : true;
          });

        if (answerFields.length > 0) {
          const embedText = makeEmbedText();
          const intelEntries = await Promise.all(
            answerFields.map(async (a) => {
              const field = fields.find((f) => f.id === a.fieldId);
              const label = field ? getFieldLabel(field) : a.fieldId;
              const content = `${label}: ${a.value}`;
              const embedding = await embedText(content);
              return {
                orgId: session.orgId,
                content,
                category: field ? sectionToCategory(field.section) : "other",
                confidence: "confirmed",
                source: "application",
                sourceRef: args.sessionId,
                embedding,
              };
            }),
          );
          await ctx.runMutation(internal.intelligence.bulkInsert, {
            entries: intelEntries,
          });
        }
      }

      // 3. HANDLE QUESTION INTENT (only if it's purely a question, not a lookup disguised as one)
      const hasLookups = (intentResult.lookupRequests?.length ?? 0) > 0;
      if ((intentResult.primaryIntent === "question" || (intentResult.primaryIntent === "mixed" && intentResult.questionText)) && !hasLookups) {
        const questionFieldIds = intentResult.questionFieldIds ?? [];
        const questionField = questionFieldIds.length > 0
          ? batchFields.find((f) => f.id === questionFieldIds[0])
          : null;

        // Load policy context if the question seems coverage-related
        let policyContext: string | undefined;
        const questionLower = (intentResult.questionText ?? "").toLowerCase();
        if (questionLower.includes("coverage") || questionLower.includes("limit") || questionLower.includes("policy") || questionLower.includes("deductible")) {
          policyContext = await loadLookupContext(ctx, session.orgId, session.userId, ["policy"]);
        }

        const { text: explanationText } = await generateText({
          model: haikuModel,
          maxOutputTokens: 512,
          messages: [
            {
              role: "user",
              content: buildFieldExplanationPrompt(
                {
                  id: questionField?.id ?? "unknown",
                  label: questionField ? getFieldLabel(questionField) : (intentResult.questionText ?? "this field"),
                  fieldType: questionField?.fieldType ?? "text",
                  options: (questionField as any)?.options,
                },
                intentResult.questionText ?? args.body,
                policyContext || undefined,
              ),
            },
          ],
        });

        explanationPrefix = explanationText;
      }

      // 4. HANDLE LOOKUP REQUEST
      if (intentResult.primaryIntent === "lookup_request" || (intentResult.primaryIntent === "mixed" && hasLookups)) {
        const requests = intentResult.lookupRequests ?? [];
        const requestTypes = [...new Set(requests.map((r) => r.type))];
        const allTargetFieldIds = [...new Set(requests.flatMap((r) => r.targetFieldIds))];

        // Extract web URLs from lookup requests
        const webUrls = requests
          .filter((r) => r.type === "web" && r.url)
          .map((r) => r.url!);

        const targetFields = allTargetFieldIds
          .map((id) => fields.find((f) => f.id === id))
          .filter(Boolean) as FormField[];

        // Also include business_context for web lookups so we have org data for context
        if (requestTypes.includes("web") && !requestTypes.includes("business_context")) {
          requestTypes.push("business_context");
        }

        const lookupData = await loadLookupContext(ctx, session.orgId, session.userId, requestTypes, webUrls.length > 0 ? webUrls : undefined);

        if (lookupData && targetFields.length > 0) {
          const { text: fillText } = await generateText({
            model: haikuModel,
            maxOutputTokens: 2048,
            messages: [
              {
                role: "user",
                content: buildLookupFillPrompt(
                  requests,
                  targetFields.map((f) => ({ id: f.id, label: getFieldLabel(f), fieldType: f.fieldType })),
                  lookupData,
                ),
              },
            ],
          });
          try {
            const fillResult = JSON.parse(stripFences(fillText));

            // Apply fills with source tracking
            const lookupFills: AutoFillResult[] = [];
            for (const fill of fillResult.fills ?? []) {
              const field = fields.find((f) => f.id === fill.fieldId);
              if (field) {
                (field as any).value = fill.value;
                (field as any).source = "org_context";
                (field as any).sourceDetail = fill.source;
                (field as any).confidence = "confirmed";
                lookupFills.push({ fieldId: fill.fieldId, value: fill.value, source: fill.source ?? "existing records" });
                if (!currentBatch.answeredFieldIds.includes(fill.fieldId)) {
                  currentBatch.answeredFieldIds.push(fill.fieldId);
                  newlyAnsweredIds.push(fill.fieldId);
                }
              }
            }

            // Save filled values to orgIntelligence
            const lookupFillFields = (fillResult.fills ?? [])
              .filter((f: any) => f.value)
              .filter((f: any) => {
                const field = fields.find((fd) => fd.id === f.fieldId);
                return field ? !isTransientField({ id: field.id, label: (field as any).label, text: (field as any).text, fieldType: field.fieldType }) : true;
              });

            if (lookupFillFields.length > 0) {
              const embedText = makeEmbedText();
              const lookupIntelEntries = await Promise.all(
                lookupFillFields.map(async (f: any) => {
                  const field = fields.find((fd) => fd.id === f.fieldId);
                  const label = field ? getFieldLabel(field) : f.fieldId;
                  const content = `${label}: ${f.value}`;
                  const embedding = await embedText(content);
                  return {
                    orgId: session.orgId,
                    content,
                    category: field ? sectionToCategory(field.section) : "other",
                    confidence: "confirmed",
                    source: "application",
                    sourceRef: args.sessionId,
                    embedding,
                  };
                }),
              );
              await ctx.runMutation(internal.intelligence.bulkInsert, {
                entries: lookupIntelEntries,
              });
            }

            // Build source-attributed lookup summary with citations
            const sourcesChecked = webUrls.length > 0
              ? `\nSources checked: ${webUrls.join(", ")}`
              : "";
            if (lookupFills.length > 0) {
              lookupSummary = `AUTO-FILLED FROM LOOKUP (cite the specific source for each field — URL, policy number, etc. Ask user to confirm or correct):\n${buildAutoFillSummary(fields, lookupFills)}${sourcesChecked}`;
            } else if (fillResult.explanation) {
              lookupSummary = `${fillResult.explanation}${sourcesChecked}`;
            } else if (sourcesChecked) {
              lookupSummary = `Checked ${webUrls.join(", ")} but couldn't find matching data for the requested fields.`;
            }
          } catch {
            console.warn("Failed to parse lookup fill response");
          }
        }
      }

      // 5. AUTO-SKIP conditional fields whose parent condition is not met
      for (const fieldId of currentBatch.fieldIds) {
        if (currentBatch.answeredFieldIds.includes(fieldId)) continue;
        const field = fields.find((f) => f.id === fieldId);
        if (!field || !("condition" in field) || !field.condition) continue;
        const parent = fields.find((f) => f.id === field.condition!.dependsOn);
        if (!parent) continue;
        const parentValue = ((parent as any).value ?? "").toString().toLowerCase().trim();
        const whenValue = field.condition.whenValue.toLowerCase().trim();
        // Parent has been answered but its value doesn't match the condition → skip this field
        if (parentValue && parentValue !== whenValue) {
          (field as any).value = "N/A";
          (field as any).source = "auto_skipped";
          (field as any).confidence = "confirmed";
          currentBatch.answeredFieldIds.push(fieldId);
        }
      }

      // 6. AFTER ALL HANDLING — determine next step
      let filledFields = fields.filter(
        (f) => f.fieldType !== "table" ? (f as any).value : (f as any).rows?.length > 0,
      ).length;

      const batchUnanswered = currentBatch.fieldIds.filter(
        (id) => !currentBatch.answeredFieldIds.includes(id),
      );

      // Build previous batch summary for conversational context
      let prevSummary = newlyAnsweredIds.length > 0
        ? buildPreviousBatchSummary(fields, newlyAnsweredIds)
        : undefined;
      // Fold lookup explanation into the summary so the email generator incorporates it naturally
      if (lookupSummary) {
        prevSummary = prevSummary
          ? `${prevSummary}\n\nLookup note: ${lookupSummary}`
          : `Lookup note: ${lookupSummary}`;
      }

      // Pre-fill any coverage/policy fields from existing policy data before sending
      const preFilled = await preFillFromPolicies(ctx, fields, batchUnanswered, session.orgId, session.userId);
      if (preFilled.length > 0) {
        for (const fill of preFilled) {
          if (!currentBatch.answeredFieldIds.includes(fill.fieldId)) {
            currentBatch.answeredFieldIds.push(fill.fieldId);
            newlyAnsweredIds.push(fill.fieldId);
          }
        }
        const preFilledIds = preFilled.map((f) => f.fieldId);
        // Recalculate
        const stillUnanswered = batchUnanswered.filter((id) => !preFilledIds.includes(id));
        batchUnanswered.length = 0;
        batchUnanswered.push(...stillUnanswered);
        // Update filled count and summary with source attribution
        filledFields = fields.filter(
          (f) => f.fieldType !== "table" ? (f as any).value : (f as any).rows?.length > 0,
        ).length;
        const preFillSummary = buildAutoFillSummary(fields, preFilled);
        prevSummary = prevSummary
          ? `${prevSummary}\n\nAUTO-FILLED FROM EXISTING RECORDS (tell user what was filled and from where, ask them to correct anything wrong):\n${preFillSummary}`
          : `AUTO-FILLED FROM EXISTING RECORDS (tell user what was filled and from where, ask them to correct anything wrong):\n${preFillSummary}`;
      }

      if (batchUnanswered.length > 0) {
        // Still have unanswered fields in this batch — re-send remaining
        const { text: batchText, html: batchHtml } = await generateBatchEmail(
          fields,
          batchUnanswered,
          currentBatchIndex,
          batches.length,
          session.applicationTitle ?? undefined,
          totalFields,
          filledFields,
          prevSummary,
          args.companyName,
        );

        // Combine explanation + remaining questions into one email
        const combinedText = explanationPrefix
          ? `${explanationPrefix}\n\n---\n\n${batchText}`
          : batchText;
        const combinedHtml = explanationPrefix
          ? `${textToHtml(explanationPrefix)}<hr style="border:none;border-top:1px solid #eee;margin:16px 0">${batchHtml}`
          : batchHtml;

        const sentMessageId = await sendEmail(
          args.agentAddress,
          args.fromEmail,
          replySubject,
          stripMarkdown(combinedText) + signature.text,
          combinedHtml + signature.html,
          buildThreadHeaders(),
        );

        if (sentMessageId) {
          lastSentId = sentMessageId;
          await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
            id: args.sessionId, lastSentMessageId: sentMessageId,
          });
        }
        await writeToThread(stripMarkdown(combinedText), sentMessageId);

        await ctx.runMutation(internal.applicationSessions.updateFields, {
          id: args.sessionId,
          extractedFields: JSON.stringify(fields),
          totalFields,
          filledFields,
        });
        await ctx.runMutation(internal.applicationSessions.updateBatches, {
          id: args.sessionId,
          questionBatches: JSON.stringify(batches),
          currentBatchIndex,
        });

        await ctx.runMutation(internal.agentConversations.updateResponse, {
          id: args.conversationId,
          responseBody: explanationPrefix || `Got ${newlyAnsweredIds.length} answer(s). ${batchUnanswered.length} remaining in this section.`,
          responseTo: args.fromEmail,
          responseMessageId: sentMessageId,
        });
      } else {
        // Batch complete — advance
        currentBatch.complete = true;
        const nextBatchIndex = currentBatchIndex + 1;

        if (nextBatchIndex < batches.length) {
          // Send next batch
          const nextBatch = batches[nextBatchIndex];
          nextBatch.sent = true;
          nextBatch.sentAt = Date.now();

          // Pre-fill coverage/policy fields from existing data before asking
          const nextPreFilled = await preFillFromPolicies(ctx, fields, nextBatch.fieldIds, session.orgId, session.userId);
          let nextBatchFieldIds = nextBatch.fieldIds;
          if (nextPreFilled.length > 0) {
            const nextPreFilledIds = nextPreFilled.map((f) => f.fieldId);
            for (const fill of nextPreFilled) {
              if (!nextBatch.answeredFieldIds.includes(fill.fieldId)) {
                nextBatch.answeredFieldIds.push(fill.fieldId);
              }
            }
            nextBatchFieldIds = nextBatch.fieldIds.filter((id) => !nextPreFilledIds.includes(id));
            filledFields = fields.filter(
              (f) => f.fieldType !== "table" ? (f as any).value : (f as any).rows?.length > 0,
            ).length;
            const nextPreFillSummary = buildAutoFillSummary(fields, nextPreFilled);
            prevSummary = prevSummary
              ? `${prevSummary}\n\nAUTO-FILLED FROM EXISTING RECORDS (tell user what was filled and from where, ask them to correct anything wrong):\n${nextPreFillSummary}`
              : `AUTO-FILLED FROM EXISTING RECORDS (tell user what was filled and from where, ask them to correct anything wrong):\n${nextPreFillSummary}`;
          }

          // If all fields in the batch were pre-filled, skip to next batch or confirmation
          if (nextBatchFieldIds.length === 0) {
            nextBatch.complete = true;
            await ctx.runMutation(internal.applicationSessions.updateFields, {
              id: args.sessionId,
              extractedFields: JSON.stringify(fields),
              totalFields,
              filledFields,
            });
            await ctx.runMutation(internal.applicationSessions.updateBatches, {
              id: args.sessionId,
              questionBatches: JSON.stringify(batches),
              currentBatchIndex: nextBatchIndex,
            });
            // Send acknowledgment listing what was auto-filled
            const fillSummary = buildAutoFillSummary(fields, nextPreFilled);
            const ackText = `I filled in the following from our existing records:\n\n${fillSummary}\n\nLet me know if any of that needs correcting. Otherwise, moving on to the next set of questions.`;
            const sentMessageId = await sendEmail(
              args.agentAddress,
              args.fromEmail,
              replySubject,
              ackText + signature.text,
              textToHtml(ackText) + signature.html,
              buildThreadHeaders(),
            );
            if (sentMessageId) {
              await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
                id: args.sessionId, lastSentMessageId: sentMessageId,
              });
            }
            await writeToThread(ackText, sentMessageId);
            // Recursion not possible here, but we've saved state. Next inbound or scheduled run will advance.
            await ctx.runMutation(internal.agentConversations.updateResponse, {
              id: args.conversationId,
              responseBody: `Auto-filled ${nextPreFilled.length} coverage fields from policies.`,
              responseTo: args.fromEmail,
              responseMessageId: sentMessageId,
            });
            return;
          }

          const { text: batchText, html: batchHtml } = await generateBatchEmail(
            fields,
            nextBatchFieldIds,
            nextBatchIndex,
            batches.length,
            session.applicationTitle ?? undefined,
            totalFields,
            filledFields,
            prevSummary,
            args.companyName,
          );

          // Combine explanation prefix if any
          const combinedText = explanationPrefix
            ? `${explanationPrefix}\n\n---\n\n${batchText}`
            : batchText;
          const combinedHtml = explanationPrefix
            ? `${textToHtml(explanationPrefix)}<hr style="border:none;border-top:1px solid #eee;margin:16px 0">${batchHtml}`
            : batchHtml;

          const sentMessageId = await sendEmail(
            args.agentAddress,
            args.fromEmail,
            replySubject,
            stripMarkdown(combinedText) + signature.text,
            combinedHtml + signature.html,
            buildThreadHeaders(),
          );

          if (sentMessageId) {
            lastSentId = sentMessageId;
            await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
              id: args.sessionId, lastSentMessageId: sentMessageId,
            });
          }
          await writeToThread(stripMarkdown(combinedText), sentMessageId);

          await ctx.runMutation(internal.applicationSessions.updateFields, {
            id: args.sessionId,
            extractedFields: JSON.stringify(fields),
            totalFields,
            filledFields,
          });
          await ctx.runMutation(internal.applicationSessions.updateBatches, {
            id: args.sessionId,
            questionBatches: JSON.stringify(batches),
            currentBatchIndex: nextBatchIndex,
          });

          await ctx.runMutation(internal.agentConversations.updateResponse, {
            id: args.conversationId,
            responseBody: `Section ${currentBatchIndex + 1} complete! Moving to section ${nextBatchIndex + 1} of ${batches.length}.`,
            responseTo: args.fromEmail,
            responseMessageId: sentMessageId,
          });
        } else {
          // All batches done — go to confirmation
          await ctx.runMutation(internal.applicationSessions.updateStatus, {
            id: args.sessionId,
            status: "pending_confirmation",
            extractedFields: JSON.stringify(fields),
            filledFields,
          });

          const summary = await generateConfirmationSummary(
            fields,
            session.applicationTitle ?? session.sourceFileName,
          );
          const { text, html } = buildConfirmationEmail(
            summary,
            session.applicationTitle ?? undefined,
          );

          const combinedText = explanationPrefix
            ? `${explanationPrefix}\n\n---\n\n${text}`
            : text;
          const combinedHtml = explanationPrefix
            ? `${textToHtml(explanationPrefix)}<hr style="border:none;border-top:1px solid #eee;margin:16px 0">${html}`
            : html;

          const sentMessageId = await sendEmail(
            args.agentAddress,
            args.fromEmail,
            replySubject,
            stripMarkdown(combinedText) + signature.text,
            combinedHtml + signature.html,
            buildThreadHeaders(),
          );

          if (sentMessageId) {
            lastSentId = sentMessageId;
            await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
              id: args.sessionId, lastSentMessageId: sentMessageId,
            });
          }
          await writeToThread(stripMarkdown(combinedText), sentMessageId);

          await ctx.runMutation(internal.applicationSessions.updateBatches, {
            id: args.sessionId,
            questionBatches: JSON.stringify(batches),
            currentBatchIndex,
          });

          await ctx.runMutation(internal.agentConversations.updateResponse, {
            id: args.conversationId,
            responseBody: summary,
            responseTo: args.fromEmail,
            responseMessageId: sentMessageId,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Application reply error:", message);
      await ctx.runMutation(internal.applicationSessions.updateError, {
        id: args.sessionId,
        error: message,
      });
      await ctx.runMutation(internal.agentConversations.updateError, {
        id: args.conversationId,
        error: message,
      });
    }
  },
});

// ── 6D: Process Confirmation Reply ──

export const processConfirmationReply = internalAction({
  args: {
    conversationId: v.id("agentConversations"),
    sessionId: v.id("applicationSessions"),
    body: v.string(),
    fromEmail: v.string(),
    agentAddress: v.string(),
    subject: v.string(),
    companyName: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const session = await ctx.runQuery(
        internal.applicationSessions.getInternal,
        { id: args.sessionId },
      );
      if (!session) throw new Error("Session not found");

      const fields: FormField[] = session.parsedFields;

      // Classify the reply
      const { text: classifyText } = await generateText({
        model: haikuModel,
        maxOutputTokens: 256,
        messages: [
          {
            role: "user",
            content: `Classify this email reply to an insurance application confirmation. Is the user confirming, requesting changes, or cancelling?

Reply: "${args.body}"

Respond with JSON only:
{ "intent": "confirmed" | "changes_requested" | "cancelled" }`,
          },
        ],
      });
      let intent: "confirmed" | "changes_requested" | "cancelled" = "confirmed";
      try {
        const parsed = JSON.parse(stripFences(classifyText));
        intent = parsed.intent;
      } catch {
        // Default to confirmed if parsing fails and body looks affirmative
        const bodyLower = args.body.toLowerCase().trim();
        if (bodyLower.includes("cancel")) intent = "cancelled";
        else if (bodyLower.includes("change") || bodyLower.includes("update") || bodyLower.includes("correct"))
          intent = "changes_requested";
      }

      const signature = buildSignature(args.agentAddress, args.companyName);
      const replySubject = args.subject.startsWith("Re:") ? args.subject : `Re: ${args.subject}`;

      // Resolve unified thread for dual-writing
      const writeToThread = await createThreadWriter(ctx, args.conversationId, session.orgId, args.agentAddress);

      // Threading helper using session's stored message IDs
      const origMsgId = session.originalMessageId ?? args.messageId;
      let lastSentId = session.lastSentMessageId;
      const buildThreadHeaders = (): Record<string, string> => {
        const hdrs: Record<string, string> = {};
        const replyTo = lastSentId ?? origMsgId;
        if (replyTo) {
          hdrs["In-Reply-To"] = replyTo;
          const refs = [origMsgId, lastSentId].filter(Boolean).join(" ");
          if (refs) hdrs["References"] = refs;
        }
        return hdrs;
      };

      if (intent === "confirmed") {
        // Generate summary PDF
        let summaryFileId;
        try {
          summaryFileId = await generateAndStoreSummaryPdf(
            ctx,
            fields,
            session.applicationTitle ?? session.sourceFileName,
            session.orgId,
          );
        } catch (err) {
          console.warn("PDF generation failed, completing without PDF:", err);
        }

        await ctx.runMutation(internal.applicationSessions.markComplete, {
          id: args.sessionId,
          summaryFileId,
        });

        const appLink = `${getAppUrl()}/applications/${args.sessionId}`;
        const appTitle = session.applicationTitle ?? session.sourceFileName;
        const responseBody = `Your application "${appTitle}" has been confirmed and saved. ${summaryFileId ? "A summary PDF is available for download." : ""}\n\n[View completed application](${appLink})`;

        const sentMessageId = await sendEmail(
          args.agentAddress,
          args.fromEmail,
          replySubject,
          stripMarkdown(responseBody) + signature.text,
          textToHtml(responseBody) + signature.html,
          buildThreadHeaders(),
        );

        if (sentMessageId) {
          await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
            id: args.sessionId, lastSentMessageId: sentMessageId,
          });
        }
        await writeToThread(stripMarkdown(responseBody), sentMessageId);

        await ctx.runMutation(internal.agentConversations.updateResponse, {
          id: args.conversationId,
          responseBody,
          responseTo: args.fromEmail,
          responseMessageId: sentMessageId,
        });
      } else if (intent === "changes_requested") {
        // Parse changes and re-send confirmation
        const { text: parseText } = await generateText({
          model: haikuModel,
          maxOutputTokens: 2048,
          messages: [
            {
              role: "user",
              content: buildAnswerParsingPrompt(
                fields.map((f) => ({
                  id: f.id,
                  label: f.fieldType !== "declaration" ? (f as any).label : undefined,
                  text: f.fieldType === "declaration" ? (f as any).text : undefined,
                  fieldType: f.fieldType,
                })),
                args.body,
              ),
            },
          ],
        });
        try {
          const parsed = JSON.parse(stripFences(parseText));
          const changeAnswers = parsed.answers ?? [];
          // Resolve relative date references
          await resolveRelativeDates(changeAnswers, fields);
          for (const answer of changeAnswers) {
            const field = fields.find((f) => f.id === answer.fieldId);
            if (field) {
              (field as any).value = answer.value;
              if (answer.explanation) (field as any).explanation = answer.explanation;
              (field as any).source = "user_answer";
              (field as any).confidence = "confirmed";
            }
          }
        } catch {
          console.warn("Failed to parse change request");
        }

        // Re-generate and send updated confirmation
        const summary = await generateConfirmationSummary(
          fields,
          session.applicationTitle ?? session.sourceFileName,
        );
        const { text, html } = buildConfirmationEmail(
          summary,
          session.applicationTitle ?? undefined,
        );

        const filledFields = fields.filter(
          (f) => f.fieldType !== "table" ? (f as any).value : (f as any).rows?.length > 0,
        ).length;

        await ctx.runMutation(internal.applicationSessions.updateStatus, {
          id: args.sessionId,
          status: "pending_confirmation",
          extractedFields: JSON.stringify(fields),
          filledFields,
        });

        const sentMessageId = await sendEmail(
          args.agentAddress,
          args.fromEmail,
          replySubject,
          stripMarkdown(text) + signature.text,
          html + signature.html,
          buildThreadHeaders(),
        );

        if (sentMessageId) {
          lastSentId = sentMessageId;
          await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
            id: args.sessionId, lastSentMessageId: sentMessageId,
          });
        }
        await writeToThread(stripMarkdown(text), sentMessageId);

        await ctx.runMutation(internal.agentConversations.updateResponse, {
          id: args.conversationId,
          responseBody: `I've updated the application with your changes. Please review the updated summary.`,
          responseTo: args.fromEmail,
          responseMessageId: sentMessageId,
        });
      } else {
        // Cancelled
        await ctx.runMutation(internal.applicationSessions.updateStatus, {
          id: args.sessionId,
          status: "cancelled",
        });
        await ctx.runMutation(
          internal.applicationSessions.updateError,
          {
            id: args.sessionId,
            error: "Cancelled by user",
          },
        );

        const responseBody = `Your application "${session.applicationTitle ?? session.sourceFileName}" has been cancelled. You can start a new application anytime by emailing a new application form.`;

        const sentMessageId = await sendEmail(
          args.agentAddress,
          args.fromEmail,
          replySubject,
          stripMarkdown(responseBody) + signature.text,
          textToHtml(responseBody) + signature.html,
          buildThreadHeaders(),
        );

        if (sentMessageId) {
          await ctx.runMutation(internal.applicationSessions.updateLastSentMessageId, {
            id: args.sessionId, lastSentMessageId: sentMessageId,
          });
        }
        await writeToThread(stripMarkdown(responseBody), sentMessageId);

        await ctx.runMutation(internal.agentConversations.updateResponse, {
          id: args.conversationId,
          responseBody,
          responseTo: args.fromEmail,
          responseMessageId: sentMessageId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Confirmation reply error:", message);
      await ctx.runMutation(internal.applicationSessions.updateError, {
        id: args.sessionId,
        error: message,
      });
      await ctx.runMutation(internal.agentConversations.updateError, {
        id: args.conversationId,
        error: message,
      });
    }
  },
});

// ── Helpers ──

/** Fields that are application/time-specific and should NOT be saved to persistent business context. */
const TRANSIENT_FIELD_PATTERNS = [
  /date/i, /effective/i, /expir/i, /inception/i, /cancel/i,
  /quote.*required/i, /required.*by/i, /requested.*date/i,
  /proposed.*date/i, /renewal/i, /term/i,
  /signature/i, /signed/i,
  /audit.*period/i, /retroactive/i,
];

const TRANSIENT_FIELD_TYPES = new Set(["date"]);

function isTransientField(field: { id: string; label?: string; text?: string; fieldType: string }): boolean {
  if (TRANSIENT_FIELD_TYPES.has(field.fieldType)) return true;
  const text = `${field.id} ${field.label ?? ""} ${field.text ?? ""}`.toLowerCase();
  return TRANSIENT_FIELD_PATTERNS.some((p) => p.test(text));
}

function sectionToCategory(section: string): string {
  const s = section.toLowerCase();
  if (s.includes("general") || s.includes("applicant") || s.includes("company"))
    return "company_info";
  if (s.includes("operation") || s.includes("business") || s.includes("employee"))
    return "operations";
  if (s.includes("financial") || s.includes("revenue") || s.includes("payroll"))
    return "financial";
  if (s.includes("coverage") || s.includes("limit") || s.includes("deductible"))
    return "coverage";
  if (s.includes("loss") || s.includes("claim") || s.includes("history"))
    return "loss_history";
  if (s.includes("declaration")) return "declarations";
  return "other";
}

async function generateConfirmationSummary(
  fields: FormField[],
  applicationTitle: string,
): Promise<string> {
  const { text } = await generateText({
    model: haikuModel,
    maxOutputTokens: 4096,
    messages: [
      {
        role: "user",
        content: buildConfirmationSummaryPrompt(
          fields.map((f) => ({
            id: f.id,
            label: f.fieldType !== "declaration" ? (f as any).label : undefined,
            text: f.fieldType === "declaration" ? (f as any).text : undefined,
            section: f.section,
            fieldType: f.fieldType,
            value: (f as any).value,
          })),
          applicationTitle,
        ),
      },
    ],
  });

  return text;
}

async function generateAndStoreSummaryPdf(
  ctx: any,
  fields: FormField[],
  title: string,
  _orgId: any,
): Promise<any> {
  // Generate a simple text-based summary as PDF using basic PDF generation
  // For v1, we generate a formatted text document stored as a file
  const PDFDocument = (await import("pdfkit")).default;

  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Title page
  doc.fontSize(20).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown();
  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
  doc.moveDown(2);

  // Group fields by section
  const sections = new Map<string, FormField[]>();
  for (const field of fields) {
    const existing = sections.get(field.section) ?? [];
    existing.push(field);
    sections.set(field.section, existing);
  }

  for (const [sectionName, sectionFields] of sections) {
    doc.fontSize(14).font("Helvetica-Bold").text(sectionName);
    doc.moveDown(0.5);

    for (const field of sectionFields) {
      const label = getFieldLabel(field);
      const value = (field as any).value ?? "(not provided)";

      if (field.fieldType === "declaration") {
        doc.fontSize(10).font("Helvetica-Bold").text(`Q: ${label}`);
        doc.font("Helvetica").text(`A: ${value}`);
        if ((field as any).explanation) {
          doc.text(`   Explanation: ${(field as any).explanation}`);
        }
      } else if (field.fieldType === "table") {
        doc.fontSize(10).font("Helvetica-Bold").text(`${label}:`);
        const rows = (field as any).rows ?? [];
        if (rows.length > 0) {
          for (const row of rows) {
            doc
              .font("Helvetica")
              .text(
                `  ${Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
              );
          }
        } else {
          doc.font("Helvetica").text("  (no data provided)");
        }
      } else {
        doc.fontSize(10).font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value);
      }
      doc.moveDown(0.3);
    }

    doc.moveDown();
  }

  doc.end();

  await new Promise<void>((resolve) => doc.on("end", resolve));

  const pdfBuffer = Buffer.concat(chunks);
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  const fileId = await ctx.storage.store(blob);
  return fileId;
}
