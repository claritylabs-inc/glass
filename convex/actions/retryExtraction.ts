"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { buildExtractor, insuranceDocToPolicy, summarizeExtractionCheckpoint } from "../lib/extraction";
import type { ExtractionState, PdfInput, PipelineCheckpoint } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";

/**
 * Shared extraction runner used by both policy and quote retry actions.
 * Supports resuming from a saved checkpoint or running a full extraction.
 */
async function runExtraction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  opts: {
    policyId: string;
    pdfInput: PdfInput;
    orgId?: string;
    checkpoint?: PipelineCheckpoint<ExtractionState>;
    log: (message: string) => Promise<void>;
  },
) {
  const { policyId, pdfInput, orgId, checkpoint, log } = opts;

  // Track latest checkpoint for persistence on success or failure
  let latestCheckpoint: PipelineCheckpoint<ExtractionState> | undefined = checkpoint;

  const extractor = buildExtractor({
    log,
    onProgress: async (msg) => { await log(msg); },
    onCheckpointSave: async (cp) => {
      latestCheckpoint = cp;
      // Persist checkpoint incrementally so we can resume if the action crashes
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionCheckpoint: cp,
      });
    },
  });

  const extractOptions = checkpoint ? { resumeFrom: checkpoint } : undefined;

  const result = await extractor.extract(
    pdfInput,
    policyId as string,
    extractOptions,
  );
  const doc = result.document as Record<string, unknown>;
  const chunks = result.chunks;
  const tokenUsage = result.tokenUsage;

  await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);
  for (const line of summarizeExtractionCheckpoint(result)) {
    await log(line);
  }

  const fields = insuranceDocToPolicy(result.document);
  const docName = doc.type === "quote"
    ? (doc.quoteNumber || "quote")
    : (doc.policyNumber || "policy");

  // Save raw response for debugging
  await ctx.runMutation(api.policies.updateExtraction, {
    id: policyId,
    rawExtractionResponse: JSON.stringify(result.document),
  });

  await ctx.runMutation(api.policies.updateExtraction, {
    id: policyId,
    fileName: `${docName}.pdf`,
    // Clear checkpoint on success — extraction is complete
    extractionCheckpoint: undefined,
    ...fields,
  });

  // Store document chunks for vector search
  if (chunks.length > 0 && orgId) {
    await ctx.runMutation(internal.documentChunks.deleteByPolicy, { policyId });
    const embed = makeEmbedText();
    for (const chunk of chunks) {
      try {
        const embedding = await embed(chunk.text);
        await ctx.runMutation(internal.documentChunks.insert, {
          orgId,
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

  return { latestCheckpoint } as { latestCheckpoint: PipelineCheckpoint<ExtractionState> | undefined };
}

export const retryQuoteExtraction = action({
  args: {
    quoteId: v.id("policies"),
    mode: v.optional(v.union(v.literal("resume"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: boolean; resumed?: boolean }> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const quote = await ctx.runQuery(api.policies.get, { id: args.quoteId });
    if (!quote) return { error: "Quote not found" };

    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, { id: args.quoteId, message });
    };

    const mode = args.mode ?? "resume";

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.quoteId,
      userId: viewer._id,
      action: "re_extraction",
      detail: `Mode: ${mode}`,
    });

    if (!quote.fileId) return { error: "No PDF file stored — cannot retry" };

    await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.quoteId });
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.quoteId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    // Load checkpoint for resume mode
    const checkpoint = mode === "resume" ? (quote as Record<string, unknown>).extractionCheckpoint as PipelineCheckpoint<ExtractionState> | undefined : undefined;
    if (checkpoint) {
      await log(`Resuming extraction from phase "${checkpoint.phase}"...`);
    } else {
      await log("Starting full extraction...");
    }

    try {
      const url = await ctx.storage.getUrl(quote.fileId);
      if (!url) throw new Error("Stored PDF not found");

      await runExtraction(ctx, {
        policyId: args.quoteId,
        pdfInput: new URL(url),
        orgId: (quote as Record<string, unknown>).orgId as string | undefined,
        checkpoint,
        log,
      });

      await log("Extraction complete");
      return { success: true, resumed: !!checkpoint };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Extraction failed";
      await log(`Failed: ${errMsg}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.quoteId,
        extractionStatus: "error",
        extractionError: errMsg,
      });
      return { error: errMsg };
    }
  },
});

export const retryExtraction = action({
  args: {
    policyId: v.id("policies"),
    mode: v.optional(v.union(v.literal("resume"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: boolean; resumed?: boolean }> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };
    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, { id: args.policyId, message });
    };

    const mode = args.mode ?? "resume";

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.policyId,
      userId: viewer._id,
      action: "re_extraction",
      detail: `Mode: ${mode}`,
    });

    await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.policyId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    // Load checkpoint for resume mode
    const checkpoint = mode === "resume" ? (policy as Record<string, unknown>).extractionCheckpoint as PipelineCheckpoint<ExtractionState> | undefined : undefined;
    if (checkpoint) {
      await log(`Resuming extraction from phase "${checkpoint.phase}"...`);
    } else {
      await log("Starting full re-extraction...");
    }

    try {
      let pdfInput: PdfInput;
      let fileId = policy.fileId;

      if (policy.fileId) {
        await log("Loading PDF from storage...");
        const url = await ctx.storage.getUrl(policy.fileId);
        if (!url) throw new Error("Stored PDF not found");
        pdfInput = new URL(url);
      } else if (policy.emailId) {
        const emails = await ctx.runQuery(api.emails.list, {});
        const email = emails.find((e: Record<string, unknown>) => e._id === policy.emailId);
        if (!email) throw new Error("Linked email not found");

        const connection = await ctx.runQuery(api.connections.get, {
          id: email.connectionId,
        });
        if (!connection) throw new Error("Email connection not found");

        await log("Connecting to email server...");
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

        const sizeKB = Math.round(pdfBuffer.length / 1024);
        await log(`PDF stored (${sizeKB} KB)`);
        const pdfBytes = new Uint8Array(pdfBuffer);
        const storageBlob = new Blob([pdfBytes], { type: "application/pdf" });
        fileId = await ctx.storage.store(storageBlob);
        pdfInput = pdfBytes;
      } else {
        return { error: "No PDF file or linked email — cannot retry" };
      }

      if (fileId && fileId !== policy.fileId) {
        await ctx.runMutation(api.policies.updateExtraction, {
          id: args.policyId,
          fileId,
        });
      }

      await runExtraction(ctx, {
        policyId: args.policyId,
        pdfInput,
        orgId: (policy as Record<string, unknown>).orgId as string | undefined,
        checkpoint,
        log,
      });

      await log("Extraction complete");
      return { success: true, resumed: !!checkpoint };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Extraction failed";
      await log(`Failed: ${errMsg}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "error",
        extractionError: errMsg,
      });
      return { error: errMsg };
    }
  },
});
