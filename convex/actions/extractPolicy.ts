"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { applyExtracted, applyExtractedQuote, extractFromPdf, extractQuoteFromPdf, classifyDocumentType, buildExtractionModels } from "../lib/extraction";
import { Id } from "../_generated/dataModel";

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

    const models = buildExtractionModels();

    // Pass 0: Classify document type (SDK trims to first 3 pages internally)
    const { documentType } = await classifyDocumentType(pdfBase64, { models });

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
          onMetadata: async (raw: string) => {
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
          onMetadata: async (raw: string) => {
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

        // Check if metadata says this is actually a quote (Pass 0 misclassified)
        const meta = extracted.metadata ?? extracted;
        if (meta.documentType === "quote") {
          await log("Document is actually a quote — migrating to quotes table.");
          // Create a quote record and delete the policy
          const quoteId = await ctx.runMutation(api.quotes.insert, {
            userId: args.userId,
            orgId: args.orgId,
            emailId: args.emailId,
            fileId,
            carrier: meta.carrier ?? "Unknown",
            quoteNumber: meta.quoteNumber ?? meta.policyNumber ?? "Unknown",
            quoteYear: meta.quoteYear ?? new Date().getFullYear(),
            isRenewal: meta.isRenewal ?? false,
            coverages: meta.coverages ?? [],
            insuredName: meta.insuredName ?? "Unknown",
            extractionStatus: "extracting",
          });
          // Re-extract as quote
          const { rawText: quoteRaw, extracted: quoteExtracted } = await extractQuoteFromPdf(
            pdfBase64, { log, models, concurrency: 1,
              onMetadata: async (raw: string) => {
                await ctx.runMutation(api.quotes.updateExtraction, {
                  id: quoteId,
                  rawMetadataResponse: raw,
                });
              },
            },
          );
          await ctx.runMutation(api.quotes.updateExtraction, {
            id: quoteId,
            rawExtractionResponse: quoteRaw,
          });
          await ctx.runMutation(api.quotes.updateExtraction, {
            id: quoteId,
            ...applyExtractedQuote(quoteExtracted),
          });
          // Remove the mis-classified policy record
          await ctx.runMutation(api.policies.softDelete, { id: policyId });
          await log("Quote extraction complete (migrated from policy).");
          return;
        }

        await ctx.runMutation(api.policies.updateExtraction, {
          id: policyId,
          fileName: `${meta.policyNumber || "policy"}.pdf`,
          ...applyExtracted(extracted),
        });

        await log("Extraction complete");

        await ctx.runMutation(internal.policyAuditLog.append, {
          policyId,
          userId: args.userId,
          orgId: args.orgId,
          action: "extraction_complete",
        });

        // Schedule proactive analysis
        if (args.orgId) {
          await ctx.scheduler.runAfter(
            0,
            internal.actions.proactiveAnalysis.analyzePolicy,
            { policyId, orgId: args.orgId },
          );

          // Schedule portfolio analysis if org has multiple policies
          const orgPolicies = await ctx.runQuery(
            internal.policies.listAllInternal,
            { orgId: args.orgId },
          );
          if (orgPolicies.length >= 2) {
            await ctx.scheduler.runAfter(
              5000,
              internal.actions.proactiveAnalysis.analyzePortfolio,
              { orgId: args.orgId },
            );
          }

          // Check for renewal match via priorPolicyNumber
          const appliedFields = applyExtracted(extracted);
          const priorPolicyNumber = (appliedFields as any).priorPolicyNumber;
          if (priorPolicyNumber) {
            const priorMatch = orgPolicies.find(
              (p: any) =>
                p.policyNumber === priorPolicyNumber &&
                p._id !== policyId,
            );
            if (priorMatch) {
              await ctx.scheduler.runAfter(
                0,
                internal.actions.proactiveAnalysis.compareRenewal,
                {
                  newPolicyId: policyId,
                  priorPolicyId: priorMatch._id,
                  orgId: args.orgId,
                },
              );
            }
          }
        }

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
