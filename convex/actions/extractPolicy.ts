"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import Anthropic from "@anthropic-ai/sdk";
import { applyExtracted, extractFromPdf } from "../lib/extraction";
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

    const log = async (policyId: Id<"policies">, message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, { id: policyId, message });
    };

    // Create a pending policy record
    const policyId = await ctx.runMutation(api.policies.insert, {
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
      extractionStatus: "extracting",
    });

    // Audit: extraction started
    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId,
      userId: args.userId,
      orgId: args.orgId,
      action: "extraction_started",
    });

    try {
      await ctx.runMutation(internal.policies.clearExtractionLog, { id: policyId });
      await log(policyId, "Connecting to email server...");
      // Download PDF attachment via IMAP
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
        await log(policyId, "Downloading PDF attachment...");
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

      // Store in Convex file storage
      const sizeKB = Math.round(pdfBuffer.length / 1024);
      await log(policyId, `PDF stored (${sizeKB} KB)`);
      const blob = new Blob([new Uint8Array(pdfBuffer)], {
        type: "application/pdf",
      });
      const fileId = await ctx.storage.store(blob);

      // Extract with Claude
      const pdfBase64 = pdfBuffer.toString("base64");
      const anthropic = new Anthropic();
      const { rawText, extracted } = await extractFromPdf(
        anthropic, pdfBase64, (msg) => log(policyId, msg),
        async (raw) => {
          await ctx.runMutation(api.policies.updateExtraction, {
            id: policyId,
            rawMetadataResponse: raw,
          });
        },
      );

      // Save raw response for retries
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        rawExtractionResponse: rawText,
      });

      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        fileId,
        fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
        ...applyExtracted(extracted),
      });

      await log(policyId, "Extraction complete");

      // Audit: extraction complete
      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId: args.userId,
        orgId: args.orgId,
        action: "extraction_complete",
      });

      // Update extraction progress on connection
      await incrementExtracted(ctx, args.connectionId);
    } catch (error: any) {
      await log(policyId, `Failed: ${error.message || "Extraction failed"}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionStatus: "error",
        extractionError: error.message || "Extraction failed",
      });
      console.error("Policy extraction failed:", error.message);

      // Audit: extraction error
      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId: args.userId,
        orgId: args.orgId,
        action: "extraction_error",
        detail: error.message || "Extraction failed",
      });

      // Still increment so progress completes
      await incrementExtracted(ctx, args.connectionId);
    }
  },
});

async function incrementExtracted(ctx: any, connectionId: any) {
  try {
    const conn = await ctx.runQuery(internal.connections.getInternal, { id: connectionId });
    if (!conn?.scanProgress) return;

    const progress = { ...conn.scanProgress };
    progress.extracted = (progress.extracted ?? 0) + 1;

    // If all extractions done, mark complete
    if (progress.extracted >= (progress.extracting ?? 0)) {
      progress.phase = "complete";
    }

    await ctx.runMutation(api.connections.updateScanProgress, {
      id: connectionId,
      scanProgress: progress,
    });
  } catch {
    // Non-critical — don't fail extraction over progress tracking
  }
}
