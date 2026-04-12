"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { stripFences, buildExtractor, insuranceDocToPolicy } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";

export const retryQuoteExtraction = action({
  args: {
    quoteId: v.id("policies"),
    mode: v.optional(v.union(v.literal("reparse"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const quote = await ctx.runQuery(api.policies.get, { id: args.quoteId });
    if (!quote) return { error: "Quote not found" };

    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, { id: args.quoteId, message });
    };

    const mode = args.mode ?? "auto";

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.quoteId,
      userId: viewer._id,
      action: "re_extraction",
      detail: `Mode: ${mode}`,
    });

    // Reparse mode
    if (mode === "reparse" || mode === "auto") {
      if (quote.rawExtractionResponse) {
        try {
          await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.quoteId });
          await log("Re-parsing saved extraction response...");
          const responseText = stripFences(quote.rawExtractionResponse);
          const parsed = JSON.parse(responseText);

          // Map via insuranceDocToPolicy — ensure type is set for correct mapping
          const doc = { type: "quote" as const, ...parsed };
          const fields = insuranceDocToPolicy(doc);

          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.quoteId,
            fileName: `${(parsed.metadata ?? parsed).quoteNumber || "quote"}.pdf`,
            ...fields,
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

    await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.quoteId });
    await log("Starting full quote re-extraction...");
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.quoteId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      const blob = await ctx.storage.get(quote.fileId);
      if (!blob) throw new Error("Stored PDF not found");
      const pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

      const extractor = buildExtractor({
        log,
        onProgress: async (msg) => { await log(msg); },
      });

      const quoteResult = await extractor.extract(
        pdfBase64,
        args.quoteId as string,
      );
      const doc = quoteResult.document as any;
      const chunks = quoteResult.chunks;
      const tokenUsage = quoteResult.tokenUsage;

      await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);

      const fields = insuranceDocToPolicy(quoteResult.document);
      const docName = doc.type === "quote"
        ? (doc.quoteNumber || "quote")
        : (doc.policyNumber || "policy");

      // Save raw response for future retries
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.quoteId,
        rawExtractionResponse: JSON.stringify(quoteResult.document),
      });

      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.quoteId,
        fileName: `${docName}.pdf`,
        ...fields,
      });

      // Store document chunks for vector search
      const orgId = (quote as any).orgId;
      if (chunks.length > 0 && orgId) {
        // Clear old chunks first
        await ctx.runMutation(internal.documentChunks.deleteByPolicy, { policyId: args.quoteId });
        const embed = makeEmbedText();
        for (const chunk of chunks) {
          try {
            const embedding = await embed(chunk.text);
            await ctx.runMutation(internal.documentChunks.insert, {
              orgId,
              policyId: args.quoteId,
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

      await log("Quote extraction complete");
      return { success: true };
    } catch (error: any) {
      await log(`Failed: ${error.message || "Quote extraction failed"}`);
      await ctx.runMutation(api.policies.updateExtraction, {
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
    mode: v.optional(v.union(v.literal("reparse"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Verify auth
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };
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
          const parsed = JSON.parse(responseText);

          // Map via insuranceDocToPolicy — ensure type is set for correct mapping
          const doc = { type: "policy" as const, ...parsed };
          const fields = insuranceDocToPolicy(doc);

          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            fileName: `${(parsed.metadata ?? parsed).policyNumber || "policy"}.pdf`,
            ...fields,
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

    // Full retry — prefer stored file, fall back to IMAP
    await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
    await log("Starting full re-extraction...");
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.policyId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      let pdfBase64: string;
      let fileId = policy.fileId;

      if (policy.fileId) {
        // Load from Convex storage
        await log("Loading PDF from storage...");
        const blob = await ctx.storage.get(policy.fileId);
        if (!blob) throw new Error("Stored PDF not found");
        pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      } else if (policy.emailId) {
        // Fall back to IMAP download
        const emails = await ctx.runQuery(api.emails.list, {});
        const email = emails.find((e: any) => e._id === policy.emailId);
        if (!email) throw new Error("Linked email not found");

        const connection = await ctx.runQuery(api.connections.get, {
          id: email.connectionId,
        });
        if (!connection) throw new Error("Email connection not found");

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
        const storageBlob = new Blob([new Uint8Array(pdfBuffer)], {
          type: "application/pdf",
        });
        fileId = await ctx.storage.store(storageBlob);
        pdfBase64 = pdfBuffer.toString("base64");
      } else {
        return { error: "No PDF file or linked email — cannot retry" };
      }

      const extractor = buildExtractor({
        log,
        onProgress: async (msg) => { await log(msg); },
      });

      const policyResult = await extractor.extract(
        pdfBase64,
        args.policyId as string,
      );
      const pDoc = policyResult.document as any;
      const chunks = policyResult.chunks;
      const tokenUsage = policyResult.tokenUsage;

      await log(`Extraction complete. Type: ${pDoc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);

      const fields = insuranceDocToPolicy(policyResult.document);
      const docName = pDoc.type === "quote"
        ? (pDoc.quoteNumber || "quote")
        : (pDoc.policyNumber || "policy");

      // Save raw response for future retries
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        rawExtractionResponse: JSON.stringify(policyResult.document),
      });

      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        ...(fileId ? { fileId } : {}),
        fileName: `${docName}.pdf`,
        ...fields,
      });

      // Store document chunks for vector search
      const orgId = (policy as any).orgId;
      if (chunks.length > 0 && orgId) {
        // Clear old chunks first
        await ctx.runMutation(internal.documentChunks.deleteByPolicy, { policyId: args.policyId });
        const embed = makeEmbedText();
        for (const chunk of chunks) {
          try {
            const embedding = await embed(chunk.text);
            await ctx.runMutation(internal.documentChunks.insert, {
              orgId,
              policyId: args.policyId,
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
