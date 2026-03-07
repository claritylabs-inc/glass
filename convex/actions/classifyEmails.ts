"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { INSURANCE_KEYWORDS, INSURANCE_SENDER_PATTERNS } from "../lib/policyTypes";
import Anthropic from "@anthropic-ai/sdk";

export const classifyEmails = internalAction({
  args: {
    connectionId: v.id("emailConnections"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get unprocessed emails for this connection (internal query — no auth needed)
    const emails = await ctx.runQuery(internal.emails.listByConnection, {
      connectionId: args.connectionId,
    });
    const unprocessed = emails.filter((e: any) => !e.processed);

    if (unprocessed.length === 0) return;

    // Get email IDs that already have policies so we can skip them
    const emailIdsWithPolicies = new Set(
      await ctx.runQuery(api.policies.emailIdsWithPolicies)
    );

    const anthropic = new Anthropic();
    let policiesFound = 0;
    let processed = 0;
    const total = unprocessed.length;

    // Update progress
    await ctx.runMutation(api.connections.updateScanProgress, {
      id: args.connectionId,
      scanProgress: { phase: "classifying", totalEmails: total, processedEmails: 0 },
    });

    try {
      for (const email of unprocessed) {
        // Skip emails that already produced policies
        if (emailIdsWithPolicies.has(email._id)) {
          await ctx.runMutation(api.emails.markProcessed, { id: email._id });
          processed++;
          continue;
        }
        const subjectLower = email.subject.toLowerCase();
        const fromLower = email.from.toLowerCase();

        // Fast path: keyword heuristics
        const keywordMatch = INSURANCE_KEYWORDS.some(
          (kw) => subjectLower.includes(kw.toLowerCase())
        );
        const senderMatch = INSURANCE_SENDER_PATTERNS.some(
          (pat) => fromLower.includes(pat.toLowerCase())
        );

        let isInsurance = false;
        let reason = "";
        let confidence = 0;

        if (keywordMatch && senderMatch) {
          // High confidence keyword match — skip AI
          isInsurance = true;
          reason = "Keyword + sender match";
          confidence = 0.95;
        } else if (keywordMatch || senderMatch) {
          // Ambiguous — use Claude Haiku
          try {
            const response = await anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 256,
              messages: [
                {
                  role: "user",
                  content: `Is this email about insurance policies? Respond with JSON only: {"isInsurance": boolean, "reason": "brief explanation", "confidence": number 0-1}

Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}`,
                },
              ],
            });

            const rawText =
              response.content[0].type === "text" ? response.content[0].text : "";
            const text = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
            const parsed = JSON.parse(text);
            isInsurance = parsed.isInsurance;
            reason = parsed.reason;
            confidence = parsed.confidence;
          } catch {
            // Fallback to keyword match
            isInsurance = keywordMatch || senderMatch;
            reason = "AI classification failed, using heuristic";
            confidence = 0.6;
          }
        } else {
          isInsurance = false;
          reason = "No insurance keywords or sender patterns";
          confidence = 0.9;
        }

        // Update classification
        await ctx.runMutation(api.emails.markClassified, {
          id: email._id,
          isInsuranceRelated: isInsurance,
          classificationReason: reason,
          classificationConfidence: confidence,
        });

        // If insurance email with attachments, schedule extraction
        if (isInsurance && email.hasAttachments) {
          await ctx.scheduler.runAfter(0, internal.actions.extractPolicy.extractPolicy, {
            emailId: email._id,
            connectionId: args.connectionId,
            userId: args.userId,
          });
          policiesFound++;
        }

        // Mark as processed
        await ctx.runMutation(api.emails.markProcessed, { id: email._id });
        processed++;

        // Update progress every email
        await ctx.runMutation(api.connections.updateScanProgress, {
          id: args.connectionId,
          scanProgress: {
            phase: "classifying",
            totalEmails: total,
            processedEmails: processed,
            insuranceFound: policiesFound,
            extracting: policiesFound,
            extracted: 0,
          },
        });
      }
    } catch (error: any) {
      console.error("Classification failed:", error.message);
      // Don't leave progress stuck — mark complete on error
      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: {
          phase: "complete",
          totalEmails: total,
          processedEmails: processed,
          insuranceFound: policiesFound,
        },
      });
      return;
    }

    // Update connection with policy count
    if (policiesFound > 0) {
      const connection = await ctx.runQuery(api.connections.get, {
        id: args.connectionId,
      });
      await ctx.runMutation(api.connections.updateScanStatus, {
        id: args.connectionId,
        lastScanStatus: "success",
        policiesExtracted: (connection?.policiesExtracted ?? 0) + policiesFound,
      });
      // Set extracting phase — extractPolicy actions will update as they complete
      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: {
          phase: "extracting",
          totalEmails: total,
          processedEmails: total,
          insuranceFound: policiesFound,
          extracting: policiesFound,
          extracted: 0,
        },
      });
    } else {
      // No policies to extract — mark complete
      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: {
          phase: "complete",
          totalEmails: total,
          processedEmails: total,
          insuranceFound: 0,
        },
      });
    }
  },
});
