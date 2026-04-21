"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { buildExtractor, insuranceDocToPolicy, summarizeExtractionCheckpoint } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";
import type { Id } from "../_generated/dataModel";

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
      if (!connection.imapHost || !connection.imapPort || !connection.password) {
        throw new Error("IMAP connection missing host, port, or password");
      }
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
    // Pass bytes directly to the extractor — the email fetch already has them in memory,
    // so we skip the ~1.37× base64 inflation and rely on the AI SDK's file part encoding.
    const pdfBytes = new Uint8Array(pdfBuffer);

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

    // ── Create policyFiles record for this attachment ──
    // We use "unknown" as initial fileType; reconciliation will classify it later
    let policyFileId: Id<"policyFiles"> | undefined;
    if (args.orgId) {
      try {
        policyFileId = await ctx.runMutation(internal.policyFiles.insert, {
          policyId,
          fileId,
          emailId: args.emailId,
          fileName: `attachment.pdf`,
          fileType: "unknown",
          extractionStatus: "extracting",
          orgId: args.orgId,
        });

        // Update the denormalized files array on the policy
        await ctx.runMutation(internal.policies.updateFiles, {
          id: policyId,
          files: [{
            fileId,
            fileName: `attachment.pdf`,
            fileType: "unknown",
            status: "extracting",
          }],
          emailIds: [args.emailId],
        });
      } catch (err: any) {
        // Non-critical — log but don't abort extraction
        console.error("Failed to create policyFiles record:", err.message);
      }
    }

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
        pdfBytes,
        policyId as string,
      );
      const doc = result.document as { type?: string; quoteNumber?: string; policyNumber?: string };
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);
      for (const line of summarizeExtractionCheckpoint(result)) {
        await log(line);
      }

      // Map InsuranceDocument → Glass policy fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: any = insuranceDocToPolicy(result.document);
      const docName = doc.type === "quote"
        ? (doc.quoteNumber || "quote")
        : (doc.policyNumber || "policy");
      const resolvedFileName = `${docName}.pdf`;

      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        fileName: resolvedFileName,
        extractionCheckpoint: undefined, // Clear checkpoint on success
        ...fields,
      });

      // ── Update policyFiles record with extraction result ──
      if (policyFileId && args.orgId) {
        try {
          await ctx.runMutation(internal.policyFiles.updateExtraction, {
            id: policyFileId,
            extractionStatus: "complete",
            extractedData: result.document,
          });

          // Update denormalized files array status to complete
          await ctx.runMutation(internal.policies.updateFiles, {
            id: policyId,
            files: [{
              fileId,
              fileName: resolvedFileName,
              fileType: "unknown",
              status: "complete",
            }],
          });

          // Check if all sibling policyFiles for this policy are done
          const siblingFiles = await ctx.runQuery(internal.policyFiles.listByPolicyInternal, {
            policyId,
          });
          const allDone = siblingFiles.every(
            (f: any) => f.extractionStatus === "complete" || f.extractionStatus === "error" || f.extractionStatus === "not_insurance"
          );
          if (allDone && siblingFiles.length > 1) {
            // Multiple files — schedule reconciliation
            await ctx.scheduler.runAfter(0, internal.actions.reconcilePolicy.reconcilePolicy, {
              policyId,
              orgId: args.orgId,
            });
          } else if (allDone && siblingFiles.length <= 1) {
            // Single file — mark as reconciled immediately
            await ctx.runMutation(internal.policies.updateFiles, {
              id: policyId,
              reconciliationStatus: "reconciled",
            });
          }
        } catch (err: any) {
          // Non-critical — don't fail extraction over policyFiles bookkeeping
          console.error("Failed to update policyFiles record:", err.message);
        }
      }

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
          } catch (err: unknown) {
            await log(`Warning: failed to embed chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        await log(`Stored ${chunks.length} chunks for vector search.`);
      }

      // ── Synthesize key policy facts into orgIntelligence ──
      if (args.orgId) {
        const embed = makeEmbedText();
        const carrier = fields.carrier ?? "Unknown carrier";
        const policyType = fields.policyTypes?.[0] ?? "policy";
        const policyNum = fields.policyNumber ?? "unknown";
        const sourceLabel = `${carrier} ${policyType} #${policyNum}`;
        const sourceRef = policyId as string;

        const entries: Array<{
          content: string;
          category: "coverage" | "financial" | "relationship" | "company_info";
        }> = [];

        // Coverage summary from each coverage
        if (fields.coverages?.length) {
          for (const cov of fields.coverages) {
            const parts = [cov.name];
            if (cov.limit) parts.push(`limit ${cov.limit}`);
            if (cov.deductible) parts.push(`deductible ${cov.deductible}`);
            entries.push({
              content: `Coverage: ${parts.join(", ")} (${carrier} ${policyType})`,
              category: "coverage",
            });
          }
        }

        // Premium as financial entry
        if (fields.premium) {
          entries.push({
            content: `Premium: ${fields.premium} for ${carrier} ${policyType} #${policyNum}`,
            category: "financial",
          });
        }

        // Carrier relationship
        entries.push({
          content: `Carrier relationship: ${carrier} — ${policyType} policy #${policyNum}, effective ${fields.effectiveDate ?? "unknown"}`,
          category: "relationship",
        });

        // Insured name/address as company_info
        if (fields.insuredName) {
          const addrPart = fields.insuredAddress ? `, address: ${fields.insuredAddress}` : "";
          entries.push({
            content: `Insured: ${fields.insuredName}${addrPart}`,
            category: "company_info",
          });
        }

        for (const entry of entries) {
          try {
            const embedding = await embed(entry.content);
            // Dedup via vector search — skip if near-duplicate exists
            const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
              vector: embedding,
              limit: 3,
              filter: (q) => q.eq("orgId", args.orgId!),
            });
            if (similar.some((s: { _score?: number }) => (s._score ?? 0) > 0.95)) continue;

            await ctx.runMutation(internal.intelligence.insert, {
              orgId: args.orgId!,
              content: entry.content,
              category: entry.category,
              confidence: "confirmed",
              source: "extraction",
              sourceRef,
              sourceLabel,
              asOfDate: fields.effectiveDate,
              documentDate: fields.effectiveDate,
              embedding,
            });
          } catch (err: unknown) {
            await log(`Warning: failed to write intelligence entry: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        await log(`Synthesized ${entries.length} intelligence entries from policy.`);
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
            (p: { policyNumber?: string; _id: string }) =>
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

        // Schedule duplicate policy detection
        await ctx.scheduler.runAfter(
          2000,
          (internal as any).actions.detectDuplicatePolicies.detectDuplicates,
          { policyId, orgId: args.orgId },
        );
      }

      await incrementExtracted(ctx, args.connectionId);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Extraction failed";
      await log(`Failed: ${errMsg}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionStatus: "error",
        extractionError: errMsg,
      });
      console.error("Extraction failed:", errMsg);

      // Mark policyFiles record as error too
      if (policyFileId) {
        try {
          await ctx.runMutation(internal.policyFiles.updateExtraction, {
            id: policyFileId,
            extractionStatus: "error",
            extractionError: (error instanceof Error ? error.message : String(error)) || "Extraction failed",
          });
          if (args.orgId) {
            await ctx.runMutation(internal.policies.updateFiles, {
              id: policyId,
              files: [{
                fileId,
                fileName: `attachment.pdf`,
                fileType: "unknown",
                status: "error",
              }],
            });
          }
        } catch {
          // Non-critical
        }
      }

      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId: args.userId,
        orgId: args.orgId,
        action: "extraction_error",
        detail: errMsg,
      });

      await incrementExtracted(ctx, args.connectionId);
    }
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function incrementExtracted(ctx: any, connectionId: string) {
  try {
    await ctx.runMutation(internal.connections.incrementExtracted, {
      id: connectionId,
    });
  } catch {
    // Non-critical — don't fail extraction over progress tracking
  }
}
