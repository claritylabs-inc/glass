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

Respond with ONLY valid JSON, no markdown:
{ "entries": [{ "content": "...", "category": "company_info" | "products_services" | "operations" | "employees" | "financial" | "risk" | "clients" | "insurance" | "investors" | "vendors" | "partners" | "observation" }] }

Rules:
- Each fact should be a standalone statement (e.g. "Company has 45 employees", "Fleet includes 12 box trucks")
- Only extract concrete, factual information about the organization
- Do NOT extract questions, opinions, greetings, or conversational filler
- Do NOT extract facts the assistant stated — only what the user provided
- If the user message contains NO extractable business facts, return { "entries": [] }
- Include temporal context when dates or time periods are mentioned

Category guide (INTERNAL = about this org itself, EXTERNAL = about other parties):
INTERNAL categories:
- company_info: the org's own entity details, legal name, addresses, structure, founding date
- products_services: this org's own products/services — specs, features, pricing, service standards, SLAs
- operations: this org's internal processes, equipment, fleet, facilities
- employees: this org's headcount, roles, departments, HR details
- financial: this org's revenue, payroll, assets, budgets, expenses
- risk: claims, incidents, hazards, compliance issues affecting this org

EXTERNAL relationship categories (about OTHER companies/people, not this org):
- clients: companies or people who BUY FROM this org
- insurance: brokers, carriers, underwriters who INSURE this org
- investors: investors, shareholders, funds who INVEST IN this org
- vendors: companies who SELL TO or PROVIDE SERVICES to this org
- partners: joint ventures, affiliates, or uncertain external relationships

- observation: general business changes, plans, or anything that doesn't fit above`,
        messages: [
          {
            role: "user",
            content: `USER MESSAGE:\n${args.userMessage}\n\nASSISTANT RESPONSE:\n${args.agentResponse.slice(0, 500)}`,
          },
        ],
      });

      let entries: Array<{ content: string; category: string }>;
      try {
        const cleaned = text.trim().replace(/```json\n?|```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      } catch {
        return;
      }

      if (entries.length === 0) return;

      const embedText = makeEmbedText();

      for (const entry of entries) {
        if (!entry.content?.trim()) continue;

        const embedding = await embedText(entry.content);

        // Dedup via vector search — skip if cosine > 0.95
        const existing = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
          vector: embedding,
          limit: 1,
          filter: (q: { eq: (field: string, value: unknown) => unknown }) => q.eq("orgId", args.orgId),
        });

        if (existing.length > 0 && existing[0]._score > 0.95) {
          continue;
        }

        await ctx.runMutation(internal.intelligence.insert, {
          orgId: args.orgId,
          content: entry.content,
          category: entry.category as string,
          confidence: "inferred" as const,
          source: "chat" as const,
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
