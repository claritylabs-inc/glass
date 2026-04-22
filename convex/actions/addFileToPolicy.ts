"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { buildExtractor } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";
import type { Id } from "../_generated/dataModel";

/**
 * Attach an additional file (extra pages, endorsements, schedules, etc.)
 * to an existing policy. Extracts chunks for vector search and appends them
 * to the policy's existing chunks. Does not modify parent policy fields.
 *
 * NOTE: This is intentionally kept synchronous (not on cl-pipelines) because:
 * - It's a chunks-only supplementary operation that runs quickly
 * - It does not modify the parent policy's extraction status
 * - It always runs within a single action invocation lifetime
 * TODO: migrate to cl-pipelines on policyFiles table in a follow-up.
 */
export const addFileToPolicy = action({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: true }> => {
    const viewer = (await ctx.runQuery(api.users.viewer)) as { _id: string } | null;
    if (!viewer) return { error: "Not authenticated" };

    const policy = (await ctx.runQuery(api.policies.get, { id: args.policyId })) as
      | (Record<string, unknown> & { _id: Id<"policies">; orgId?: Id<"organizations"> })
      | null;
    if (!policy) return { error: "Policy not found" };

    const orgId = policy.orgId as Id<"organizations"> | undefined;
    if (!orgId) return { error: "Policy has no organization" };

    const policyFileId: Id<"policyFiles"> = await ctx.runMutation(
      (internal as any).policyFiles.insert,
      {
        policyId: args.policyId,
        fileId: args.fileId,
        fileName: args.fileName,
        fileType: "unknown" as const,
        extractionStatus: "extracting" as const,
        orgId,
      },
    );

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.policyId,
      userId: viewer._id as Id<"users">,
      orgId,
      action: "pdf_uploaded",
    });

    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, {
        id: args.policyId,
        message,
      });
    };

    try {
      const url = await ctx.storage.getUrl(args.fileId);
      if (!url) throw new Error("File not found in storage");

      await log(`Added supplemental file: ${args.fileName}. Extracting chunks...`);

      const extractor = buildExtractor({
        log,
        onProgress: async (msg) => {
          await log(msg);
        },
      });

      const result = await extractor.extract(new URL(url), args.policyId as string);
      const chunks = result.chunks;

      if (chunks.length > 0) {
        const embed = makeEmbedText();
        for (const chunk of chunks) {
          try {
            const embedding = await embed(chunk.text);
            await ctx.runMutation(internal.documentChunks.insert, {
              orgId,
              policyId: args.policyId,
              chunkId: `${policyFileId}-${chunk.id}`,
              chunkType: chunk.type,
              text: chunk.text,
              metadata: chunk.metadata,
              embedding,
              createdAt: Date.now(),
            });
          } catch (err: unknown) {
            await log(
              `Warning: failed to embed chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        await log(`Appended ${chunks.length} chunks from ${args.fileName}.`);
      }

      await ctx.runMutation(
        (internal as any).policyFiles.updateExtraction,
        {
          id: policyFileId,
          extractionStatus: "complete",
          extractedData: result.document,
        },
      );

      return { success: true };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Extraction failed";
      await log(`Failed to process ${args.fileName}: ${errMsg}`);
      try {
        await ctx.runMutation(
          (internal as any).policyFiles.updateExtraction,
          {
            id: policyFileId,
            extractionStatus: "error",
            extractionError: errMsg,
          },
        );
      } catch {
        /* non-critical */
      }
      return { error: errMsg };
    }
  },
});
