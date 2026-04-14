"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, Output } from "ai";
import { getModel } from "../lib/models";
import { z } from "zod";

const triageSchema = z.object({
  analyze: z.boolean(),
  reason: z.string(),
});

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
      (e: any) =>
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
          output: Output.object({ schema: triageSchema }),
          prompt: `You are triaging emails for business intelligence extraction. Given this email metadata, should we fetch and analyze the full body? Skip newsletters, automated notifications, OTP codes, marketing emails, and spam. Respond with JSON: { analyze: boolean, reason: string }

Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}`,
        });

        const triage = result.output;

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
      } catch (error: any) {
        console.error(
          `Triage failed for email ${email._id}: ${error.message || error}`
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
