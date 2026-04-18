"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getModel } from "../lib/models";
export const triageAndExtract = internalAction({
  args: {
    connectionId: v.id("emailConnections"),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    // Get classified emails that haven't been intelligence-processed yet
    const emails = await ctx.runQuery(internal.emails.listByConnection, {
      connectionId: args.connectionId,
    });
    const candidates = emails.filter(
      (e: { isInsuranceRelated?: unknown; intelligenceStatus?: unknown }) =>
        e.isInsuranceRelated !== undefined && // classified
        !e.intelligenceStatus // not yet triaged for intelligence
    );

    if (candidates.length === 0) return;

    let triaged = 0;
    let scheduled = 0;

    for (const email of candidates) {
      try {
        const result = await generateText({
          model: getModel("triage"),
          maxOutputTokens: 256,
          system: `You are triaging emails for business intelligence extraction. Given email metadata, decide if the full body should be fetched and analyzed. Skip newsletters, automated notifications, OTP codes, marketing emails, and spam. Respond with ONLY valid JSON, no markdown.
Format: { "analyze": true/false, "reason": "..." }`,
          prompt: `Subject: ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}`,
        });

        let triage: { analyze: boolean; reason: string } | null = null;
        try {
          const cleaned = result.text.replace(/```json\n?|```\n?/g, "").trim();
          triage = JSON.parse(cleaned);
        } catch { triage = { analyze: false, reason: "Failed to parse triage response" }; }

        if (triage?.analyze) {
          // Mark as pending and schedule extraction
          await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
            id: email._id,
            intelligenceStatus: "pending" as const,
          });

          if (args.orgId) {
            await ctx.scheduler.runAfter(
              scheduled * 2_000, // stagger by 2s to avoid rate limits
              internal.actions.extractEmailIntelligence.extractSingle,
              {
                emailId: email._id,
                connectionId: args.connectionId,
                orgId: args.orgId,
              }
            );
            scheduled++;
          }
        } else {
          // Skip this email
          await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
            id: email._id,
            intelligenceStatus: "skipped" as const,
          });
        }

        triaged++;
      } catch (error: unknown) {
        console.error(
          `Triage failed for email ${email._id}: ${error instanceof Error ? error.message : String(error)}`
        );
        // On triage failure, skip rather than block the pipeline
        await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
          id: email._id,
          intelligenceStatus: "skipped" as const,
        });
      }
    }

    console.log(
      `Triage complete: ${triaged} emails triaged, ${scheduled} scheduled for extraction`
    );
  },
});
