"use node";

/**
 * Implements cl-sdk's MemoryStore interface using Convex vector search.
 *
 * - Document chunks: stored in documentChunks table with 1536-dim embeddings
 * - Conversation turns: stored in conversationTurns table with 1536-dim embeddings
 * - Search: Convex native vectorSearch with org-scoped filtering
 *
 * IMPORTANT: vectorSearch only works in actions (not queries/mutations).
 */

import type {
  MemoryStore,
  DocumentChunk,
  ConversationTurn,
  ChunkFilter,
  EmbedText,
} from "@claritylabs/cl-sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/**
 * Create a MemoryStore backed by Convex vector search.
 * Must be called from an action context.
 */
export function createConvexMemoryStore(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  embed: EmbedText,
): MemoryStore {
  return {
    async addChunks(chunks: DocumentChunk[]): Promise<void> {
      for (const chunk of chunks) {
        const embedding = await embed(chunk.text);
        // Extract policyId from chunk.documentId (which is a Convex policy _id)
        const policyId = chunk.documentId as Id<"policies">;
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
      }
    },

    async search(
      query: string,
      options?: { limit?: number; filter?: ChunkFilter },
    ): Promise<DocumentChunk[]> {
      const queryEmbedding = await embed(query);
      const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
        vector: queryEmbedding,
        limit: options?.limit ?? 10,
        filter: (q) => q.eq("orgId", orgId),
      });

      // Hydrate results
      const chunks: DocumentChunk[] = [];
      for (const result of results) {
        const doc = await ctx.runQuery(internal.documentChunks.get, {
          id: result._id,
        });
        if (!doc) continue;

        // Check if the parent policy is excluded from search
        const policy = await ctx.runQuery(internal.policies.getInternal, {
          id: doc.policyId,
        });
        if (!policy || policy.excludeFromSearch) continue;

        // Apply additional filters if specified
        if (options?.filter) {
          if (options.filter.documentId && doc.policyId !== options.filter.documentId) continue;
          if (options.filter.type && doc.chunkType !== options.filter.type) continue;
        }

        chunks.push({
          id: doc.chunkId,
          documentId: doc.policyId as string,
          type: doc.chunkType as DocumentChunk["type"],
          text: doc.text,
          metadata: (doc.metadata as Record<string, string>) ?? {},
        });
      }

      return chunks;
    },

    async addTurn(turn: ConversationTurn): Promise<void> {
      const embedding = await embed(turn.content);
      await ctx.runMutation(internal.conversationTurns.insert, {
        orgId,
        conversationId: turn.conversationId,
        role: turn.role,
        content: turn.content,
        embedding,
        createdAt: turn.timestamp,
      });
    },

    async getHistory(
      conversationId: string,
      options?: { limit?: number },
    ): Promise<ConversationTurn[]> {
      const turns = await ctx.runQuery(
        internal.conversationTurns.listByConversation,
        {
          conversationId,
          limit: options?.limit ?? 50,
        },
      );

      return turns.map((t: any) => ({
        id: t._id as string,
        conversationId: t.conversationId,
        role: t.role as ConversationTurn["role"],
        content: t.content,
        timestamp: t.createdAt,
      }));
    },

    async searchHistory(
      query: string,
      conversationId?: string,
    ): Promise<ConversationTurn[]> {
      const queryEmbedding = await embed(query);
      const results = await ctx.vectorSearch(
        "conversationTurns",
        "by_embedding",
        {
          vector: queryEmbedding,
          limit: 10,
          filter: (q) => q.eq("orgId", orgId),
        },
      );

      const turns: ConversationTurn[] = [];
      for (const result of results) {
        const doc = await ctx.runQuery(internal.conversationTurns.get, {
          id: result._id,
        });
        if (!doc) continue;
        if (conversationId && doc.conversationId !== conversationId) continue;

        turns.push({
          id: doc._id as string,
          conversationId: doc.conversationId,
          role: doc.role as ConversationTurn["role"],
          content: doc.content,
          timestamp: doc.createdAt,
        });
      }

      return turns;
    },
  };
}
