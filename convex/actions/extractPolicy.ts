"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { buildExtractor, insuranceDocToPolicy, summarizeExtractionCheckpoint } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";
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

    // Create placeholder policy record (type determined by extraction)
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
      await log(`PDF stored (${sizeKB} KB). Starting extraction pipeline.`);

      // Unified extraction — SDK handles classification, extraction, and assembly
      const extractor = buildExtractor({
        log,
        onProgress: async (msg) => { await log(msg); },
        onCheckpointSave: async (cp) => {
          await ctx.runMutation(api.policies.updateExtraction, {
            id: policyId,
            extractionCheckpoint: cp,
          });
        },
      });

      const result = await extractor.extract(
        pdfBase64,
        policyId as string,
      );
      const doc = result.document as any;
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);
      for (const line of summarizeExtractionCheckpoint(result)) {
        await log(line);
      }

      // Map InsuranceDocument → Prism policy fields
      const fields = insuranceDocToPolicy(result.document);
      const docName = doc.type === "quote"
        ? (doc.quoteNumber || "quote")
        : (doc.policyNumber || "policy");

      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        fileName: `${docName}.pdf`,
        extractionCheckpoint: undefined, // Clear checkpoint on success
        ...fields,
      });

      // Store document chunks for vector search
      if (chunks.length > 0 && args.orgId) {
        const embed = makeEmbedText();
        for (const chunk of chunks) {
          try {
            const embedding = await embed(chunk.text);
            await ctx.runMutation(internal.documentChunks.insert, {
              orgId: args.orgId,
              policyId,
              chunkId: chunk.id,
              chunkType: chunk.type,
              text: chunk.text,
              metadata: chunk.metadata,
              embedding,
              createdAt: Date.now(),
            });
          } catch (err: any) {
            await log(`Warning: failed to embed chunk ${chunk.id}: ${err.message}`);
          }
        }
        await log(`Stored ${chunks.length} chunks for vector search.`);
      }

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
        const priorPolicyNumber = fields.priorPolicyNumber;
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
      console.error("Extraction failed:", error.message);

      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId: args.userId,
        orgId: args.orgId,
        action: "extraction_error",
        detail: error.message || "Extraction failed",
      });

      await incrementExtracted(ctx, args.connectionId);
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
