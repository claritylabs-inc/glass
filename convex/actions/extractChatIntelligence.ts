"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getModel } from "../lib/models";
import { makeEmbedText } from "../lib/sdkCallbacks";

/**
 * Post-chat intelligence extraction.
 *
 * Runs after each chat response to extract org facts revealed by the USER
 * (not facts stated by the assistant). Most exchanges yield nothing — that's expected.
 * Non-critical: all errors are caught silently.
 */
export const extractFromChat = internalAction({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    userMessage: v.string(),
    agentResponse: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Skip short messages — unlikely to contain extractable facts
      if (args.userMessage.length < 20) return;

      const { text } = await generateText({
        model: getModel("summary"),
        maxOutputTokens: 512,
        system: `You extract business facts from chat conversations. You ONLY extract facts that the USER explicitly provided — never extract things the assistant said or inferred.

Rules:
- Output one fact per line, no bullets or numbering
- Each fact should be a standalone statement (e.g. "Company has 45 employees", "Fleet includes 12 box trucks")
- Only extract concrete, factual information about the organization, its operations, employees, assets, or risk profile
- Do NOT extract questions, opinions, greetings, or conversational filler
- Do NOT extract facts the assistant stated — only what the user provided
- If the user message contains NO extractable business facts, output exactly: NONE

Examples of extractable facts:
- "We just opened a second warehouse in Austin" → "Company has a second warehouse location in Austin"
- "Our revenue was $4.2M last year" → "Annual revenue is approximately $4.2M"
- "We switched to electric forklifts" → "Company uses electric forklifts"

Examples of NON-extractable messages:
- "What does my GL policy cover?" → NONE
- "Thanks, that's helpful" → NONE
- "Can you compare these two quotes?" → NONE`,
        messages: [
          {
            role: "user",
            content: `USER MESSAGE:\n${args.userMessage}\n\nASSISTANT RESPONSE:\n${args.agentResponse.slice(0, 500)}`,
          },
        ],
      });

      const trimmed = text.trim();
      if (!trimmed || trimmed === "NONE") return;

      const facts = trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== "NONE");

      if (facts.length === 0) return;

      const embedText = makeEmbedText();

      for (const fact of facts) {
        // Generate embedding for dedup check
        const embedding = await embedText(fact);

        // Dedup via vector search — skip if cosine > 0.95
        const existing = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
          vector: embedding,
          limit: 1,
          filter: (q: any) => q.eq("orgId", args.orgId),
        });

        if (existing.length > 0 && existing[0]._score > 0.95) {
          continue; // Already have a very similar fact
        }

        await ctx.runMutation(internal.intelligence.insert, {
          orgId: args.orgId,
          content: fact,
          category: "company_info" as any,
          confidence: "inferred" as any,
          source: "chat" as any,
          sourceRef: args.threadId as string,
          sourceLabel: "Chat conversation",
          embedding,
        });
      }
    } catch {
      // Non-critical — silently ignore all errors
    }
  },
});
