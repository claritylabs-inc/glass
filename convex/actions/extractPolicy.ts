"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { applyExtracted, applyExtractedQuote, extractFromPdf, extractQuoteFromPdf, classifyDocumentType, createUniformModelConfig } from "../lib/extraction";
import { sonnetModel } from "../lib/ai";
import { PDFDocument } from "pdf-lib";
import { Id } from "../_generated/dataModel";

/**
 * Extract a page range from a PDF and return as base64.
 * Used to reduce token count by only sending relevant pages to the API.
 */
async function extractPageRange(pdfBase64: string, startPage: number, endPage: number): Promise<string> {
  const srcDoc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
  const totalPages = srcDoc.getPageCount();
  const end = Math.min(endPage, totalPages) - 1; // 0-indexed
  const start = Math.max(startPage - 1, 0); // 0-indexed

  if (start === 0 && end >= totalPages - 1) {
    return pdfBase64; // No point splitting if we want all pages
  }

  const newDoc = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const pages = await newDoc.copyPages(srcDoc, indices);
  pages.forEach((page) => newDoc.addPage(page));
  const bytes = await newDoc.save();
  return Buffer.from(bytes).toString("base64");
}

export const extractPolicy = internalAction({
  args: {
    emailId: v.id("emails"),
    connectionId: v.id("emailConnections"),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const thisEmail = await ctx.runQuery(internal.emails.getInternal, {
      id: args.emailId,
    });
    if (!thisEmail) throw new Error("Email not found");

    const connection = await ctx.runQuery(internal.connections.getInternal, {
      id: args.connectionId,
    });
    if (!connection) throw new Error("Connection not found");

    // Download PDF attachment via IMAP
    let pdfBuffer: Buffer;
    {
      const client = new ImapFlow({
        host: connection.imapHost,
        port: connection.imapPort,
        secure: true,
        auth: { user: connection.email, pass: connection.password },
        logger: false,
      });

      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          const { content } = await client.download(
            String(thisEmail.uid ?? 0),
            "2",
            { uid: true }
          );
          const chunks: Buffer[] = [];
          for await (const chunk of content) {
            chunks.push(Buffer.from(chunk));
          }
          pdfBuffer = Buffer.concat(chunks);
        } finally {
          lock.release();
        }
        await client.logout();
      } catch (error) {
        try {
          await client.logout();
        } catch {
          /* ignore */
        }
        throw error;
      }
    }

    // Store in Convex file storage
    const sizeKB = Math.round(pdfBuffer.length / 1024);
    const blob = new Blob([new Uint8Array(pdfBuffer)], {
      type: "application/pdf",
    });
    const fileId = await ctx.storage.store(blob);
    const pdfBase64 = pdfBuffer.toString("base64");

    // Use all-Sonnet — Haiku hits rate limits more easily
    const models = createUniformModelConfig(sonnetModel);

    // Pass 0: Classify document type (only send first 3 pages to save tokens)
    const classifyPdf = await extractPageRange(pdfBase64, 1, 3);
    const { documentType } = await classifyDocumentType(classifyPdf, { models });

    if (documentType === "quote") {
      // === QUOTE EXTRACTION PATH ===
      const quoteId = await ctx.runMutation(api.quotes.insert, {
        userId: args.userId,
        orgId: args.orgId,
        emailId: args.emailId,
        fileId,
        carrier: "Extracting...",
        quoteNumber: "Extracting...",
        quoteYear: new Date().getFullYear(),
        isRenewal: false,
        coverages: [],
        insuredName: "Extracting...",
        extractionStatus: "extracting",
      });

      const log = async (message: string) => {
        await ctx.runMutation(internal.quotes.appendExtractionLog, { id: quoteId, message });
      };

      await ctx.runMutation(internal.policyAuditLog.append, {
        quoteId,
        userId: args.userId,
        orgId: args.orgId,
        action: "extraction_started",
      });

      try {
        await ctx.runMutation(internal.quotes.clearExtractionLog, { id: quoteId });
        await log(`PDF stored (${sizeKB} KB). Classified as quote.`);

        const { rawText, extracted } = await extractQuoteFromPdf(
          pdfBase64, {
          log,
          models,
          concurrency: 1,
          onMetadata: async (raw) => {
            await ctx.runMutation(api.quotes.updateExtraction, {
              id: quoteId,
              rawMetadataResponse: raw,
            });
          },
        });

        await ctx.runMutation(api.quotes.updateExtraction, {
          id: quoteId,
          rawExtractionResponse: rawText,
        });

        await ctx.runMutation(api.quotes.updateExtraction, {
          id: quoteId,
          fileName: `${(extracted.metadata ?? extracted).quoteNumber || (extracted.metadata ?? extracted).policyNumber || "quote"}.pdf`,
          ...applyExtractedQuote(extracted),
        });

        await log("Quote extraction complete");

        await ctx.runMutation(internal.policyAuditLog.append, {
          quoteId,
          userId: args.userId,
          orgId: args.orgId,
          action: "extraction_complete",
        });

        await incrementExtracted(ctx, args.connectionId);
      } catch (error: any) {
        await log(`Failed: ${error.message || "Extraction failed"}`);
        await ctx.runMutation(api.quotes.updateExtraction, {
          id: quoteId,
          extractionStatus: "error",
          extractionError: error.message || "Extraction failed",
        });
        console.error("Quote extraction failed:", error.message);

        await ctx.runMutation(internal.policyAuditLog.append, {
          quoteId,
          userId: args.userId,
          orgId: args.orgId,
          action: "extraction_error",
          detail: error.message || "Extraction failed",
        });

        await incrementExtracted(ctx, args.connectionId);
      }
    } else {
      // === POLICY EXTRACTION PATH ===
      const policyId = await ctx.runMutation(api.policies.insert, {
        userId: args.userId,
        orgId: args.orgId,
        emailId: args.emailId,
        fileId,
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
        extractionStatus: "extracting",
      });

      const log = async (message: string) => {
        await ctx.runMutation(internal.policies.appendExtractionLog, { id: policyId, message });
      };

      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId: args.userId,
        orgId: args.orgId,
        action: "extraction_started",
      });

      try {
        await ctx.runMutation(internal.policies.clearExtractionLog, { id: policyId });
        await log(`PDF stored (${sizeKB} KB). Classified as policy.`);

        const { rawText, extracted } = await extractFromPdf(
          pdfBase64, {
          log,
          models,
          concurrency: 1,
          onMetadata: async (raw) => {
            await ctx.runMutation(api.policies.updateExtraction, {
              id: policyId,
              rawMetadataResponse: raw,
            });
          },
        });

        await ctx.runMutation(api.policies.updateExtraction, {
          id: policyId,
          rawExtractionResponse: rawText,
        });

        await ctx.runMutation(api.policies.updateExtraction, {
          id: policyId,
          fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
          ...applyExtracted(extracted),
        });

        await log("Extraction complete");

        await ctx.runMutation(internal.policyAuditLog.append, {
          policyId,
          userId: args.userId,
          orgId: args.orgId,
          action: "extraction_complete",
        });

        await incrementExtracted(ctx, args.connectionId);
      } catch (error: any) {
        await log(`Failed: ${error.message || "Extraction failed"}`);
        await ctx.runMutation(api.policies.updateExtraction, {
          id: policyId,
          extractionStatus: "error",
          extractionError: error.message || "Extraction failed",
        });
        console.error("Policy extraction failed:", error.message);

        await ctx.runMutation(internal.policyAuditLog.append, {
          policyId,
          userId: args.userId,
          orgId: args.orgId,
          action: "extraction_error",
          detail: error.message || "Extraction failed",
        });

        await incrementExtracted(ctx, args.connectionId);
      }
    }
  },
});

async function incrementExtracted(ctx: any, connectionId: any) {
  try {
    await ctx.runMutation(internal.connections.incrementExtracted, {
      id: connectionId,
    });
  } catch {
    // Non-critical — don't fail extraction over progress tracking
  }
}
