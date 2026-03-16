"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { stripFences, applyExtracted, applyExtractedQuote, extractFromPdf, extractQuoteFromPdf, extractSectionsOnly, enrichSupplementaryFields, sanitizeNulls } from "../lib/extraction";
import { buildQuoteSectionsPrompt } from "../lib/prompts";

export const retryQuoteExtraction = action({
  args: {
    quoteId: v.id("quotes"),
    mode: v.optional(v.union(v.literal("reparse"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const quote = await ctx.runQuery(api.quotes.get, { id: args.quoteId });
    if (!quote) return { error: "Quote not found" };

    const log = async (message: string) => {
      await ctx.runMutation(internal.quotes.appendExtractionLog, { id: args.quoteId, message });
    };

    const mode = args.mode ?? "auto";

    await ctx.runMutation(internal.policyAuditLog.append, {
      quoteId: args.quoteId,
      userId: viewer._id,
      action: "re_extraction",
      detail: `Mode: ${mode}`,
    });

    // Reparse mode
    if (mode === "reparse" || mode === "auto") {
      if (quote.rawExtractionResponse) {
        try {
          await ctx.runMutation(internal.quotes.clearExtractionLog, { id: args.quoteId });
          await log("Re-parsing saved extraction response...");
          const responseText = stripFences(quote.rawExtractionResponse);
          const extracted = JSON.parse(responseText);

          await ctx.runMutation(api.quotes.updateExtraction, {
            id: args.quoteId,
            fileName: `${(extracted.metadata ?? extracted).quoteNumber || "quote"}.pdf`,
            ...applyExtractedQuote(extracted),
          });

          await log("Extraction complete");
          return { success: true, reused: true };
        } catch {
          if (mode === "reparse") {
            await log("Failed: Could not parse saved AI response");
            return { error: "Could not parse saved AI response" };
          }
        }
      } else if (mode === "reparse") {
        return { error: "No saved AI response to re-parse" };
      }
    }

    // Full retry — need PDF from storage
    if (!quote.fileId) return { error: "No PDF file stored — cannot retry" };

    await ctx.runMutation(internal.quotes.clearExtractionLog, { id: args.quoteId });
    await log("Starting full quote re-extraction...");
    await ctx.runMutation(api.quotes.updateExtraction, {
      id: args.quoteId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      const blob = await ctx.storage.get(quote.fileId);
      if (!blob) throw new Error("Stored PDF not found");
      const pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

      const { rawText, extracted } = await extractQuoteFromPdf(
        pdfBase64, {
        log,
        onMetadata: async (raw) => {
          await ctx.runMutation(api.quotes.updateExtraction, {
            id: args.quoteId,
            rawMetadataResponse: raw,
          });
        },
      });

      await ctx.runMutation(api.quotes.updateExtraction, {
        id: args.quoteId,
        rawExtractionResponse: rawText,
      });
      await ctx.runMutation(api.quotes.updateExtraction, {
        id: args.quoteId,
        fileName: `${(extracted.metadata ?? extracted).quoteNumber || "quote"}.pdf`,
        ...applyExtractedQuote(extracted),
      });
      await log("Quote extraction complete");
      return { success: true };
    } catch (error: any) {
      await log(`Failed: ${error.message || "Quote extraction failed"}`);
      await ctx.runMutation(api.quotes.updateExtraction, {
        id: args.quoteId,
        extractionStatus: "error",
        extractionError: error.message || "Quote extraction failed",
      });
      return { error: error.message || "Quote extraction failed" };
    }
  },
});

export const retryExtraction = action({
  args: {
    policyId: v.id("policies"),
    mode: v.optional(v.union(v.literal("reparse"), v.literal("enrich_only"), v.literal("sections_only"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Verify auth
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };
    if (!policy.emailId) return { error: "No linked email — cannot retry" };

    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, { id: args.policyId, message });
    };

    const mode = args.mode ?? "auto";

    // Audit: re-extraction triggered
    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.policyId,
      userId: viewer._id,
      action: "re_extraction",
      detail: `Mode: ${mode}`,
    });

    // Reparse mode: only re-parse the saved raw response
    if (mode === "reparse" || mode === "auto") {
      if (policy.rawExtractionResponse) {
        try {
          await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
          await log("Re-parsing saved extraction response...");
          const responseText = stripFences(policy.rawExtractionResponse);
          const extracted = JSON.parse(responseText);

          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
            ...applyExtracted(extracted),
          });

          await log("Extraction complete");
          return { success: true, reused: true };
        } catch {
          if (mode === "reparse") {
            await log("Failed: Could not parse saved AI response");
            return { error: "Could not parse saved AI response" };
          }
          // auto mode: fall through to full retry
        }
      } else if (mode === "reparse") {
        return { error: "No saved AI response to re-parse" };
      }
    }

    // Enrich-only mode: re-run pass 3 on existing document data
    if (mode === "enrich_only") {
      const document = (policy as any).document;
      if (!document) return { error: "No document data to enrich" };

      await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
      await log("Starting supplementary enrichment (pass 3 only)...");

      try {
        const enriched = await enrichSupplementaryFields(document, undefined, log);

        await ctx.runMutation(api.policies.updateExtraction, {
          id: args.policyId,
          document: sanitizeNulls(enriched),
        });
        await log("Enrichment complete");
        return { success: true };
      } catch (error: any) {
        await log(`Failed: ${error.message || "Enrichment failed"}`);
        return { error: error.message || "Enrichment failed" };
      }
    }

    // Sections-only mode: re-run pass 2 using saved metadata
    if (mode === "sections_only" && policy.rawMetadataResponse) {
      await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
      await log("Starting sections-only re-extraction...");
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "extracting",
        extractionError: "",
      });

      try {
        // Need PDF — download from storage or IMAP
        let pdfBase64: string;
        if (policy.fileId) {
          const blob = await ctx.storage.get(policy.fileId);
          if (!blob) throw new Error("Stored PDF not found");
          pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
        } else {
          // Fall back to IMAP download
          const emails = await ctx.runQuery(api.emails.list, {});
          const email = emails.find((e: any) => e._id === policy.emailId);
          if (!email) throw new Error("Linked email not found");
          const connection = await ctx.runQuery(api.connections.get, { id: email.connectionId });
          if (!connection) throw new Error("Email connection not found");

          const { ImapFlow } = await import("imapflow");
          const client = new ImapFlow({
            host: connection.imapHost, port: connection.imapPort, secure: true,
            auth: { user: connection.email, pass: connection.password }, logger: false,
          });
          await client.connect();
          const lock = await client.getMailboxLock("INBOX");
          try {
            const { content } = await client.download(String(email.uid ?? 0), "2", { uid: true });
            const chunks: Buffer[] = [];
            for await (const chunk of content) chunks.push(Buffer.from(chunk));
            pdfBase64 = Buffer.concat(chunks).toString("base64");
          } finally { lock.release(); }
          await client.logout();
        }

        const { rawText, extracted } = await extractSectionsOnly(
          pdfBase64, policy.rawMetadataResponse, { log },
        );

        await ctx.runMutation(api.policies.updateExtraction, {
          id: args.policyId,
          rawExtractionResponse: rawText,
        });
        await ctx.runMutation(api.policies.updateExtraction, {
          id: args.policyId,
          fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
          ...applyExtracted(extracted),
        });
        await log("Extraction complete");
        return { success: true };
      } catch (error: any) {
        await log(`Failed: ${error.message || "Sections-only extraction failed"}`);
        await ctx.runMutation(api.policies.updateExtraction, {
          id: args.policyId,
          extractionStatus: "error",
          extractionError: error.message || "Sections-only extraction failed",
        });
        return { error: error.message || "Sections-only extraction failed" };
      }
    }

    // Full retry with API call
    const emails = await ctx.runQuery(api.emails.list, {});
    const email = emails.find((e: any) => e._id === policy.emailId);
    if (!email) return { error: "Linked email not found" };

    const connection = await ctx.runQuery(api.connections.get, {
      id: email.connectionId,
    });
    if (!connection) return { error: "Email connection not found" };

    // Reset status to extracting
    await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
    await log("Starting full re-extraction...");
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.policyId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      // Download PDF attachment via IMAP
      await log("Connecting to email server...");
      const client = new ImapFlow({
        host: connection.imapHost,
        port: connection.imapPort,
        secure: true,
        auth: { user: connection.email, pass: connection.password },
        logger: false,
      });

      let pdfBuffer: Buffer;
      try {
        await client.connect();
        await log("Downloading PDF attachment...");
        const lock = await client.getMailboxLock("INBOX");
        try {
          const { content } = await client.download(
            String(email.uid ?? 0),
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

      // Store in Convex file storage
      const sizeKB = Math.round(pdfBuffer.length / 1024);
      await log(`PDF stored (${sizeKB} KB)`);
      const blob = new Blob([new Uint8Array(pdfBuffer)], {
        type: "application/pdf",
      });
      const fileId = await ctx.storage.store(blob);

      // Extract with Claude
      const pdfBase64 = pdfBuffer.toString("base64");
      const { rawText, extracted } = await extractFromPdf(
        pdfBase64, {
        log,
        onMetadata: async (raw) => {
          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            rawMetadataResponse: raw,
          });
        },
      });

      // Save raw response for future retries
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        rawExtractionResponse: rawText,
      });

      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        fileId,
        fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
        ...applyExtracted(extracted),
      });

      await log("Extraction complete");
      return { success: true };
    } catch (error: any) {
      await log(`Failed: ${error.message || "Extraction failed"}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "error",
        extractionError: error.message || "Extraction failed",
      });
      return { error: error.message || "Extraction failed" };
    }
  },
});
