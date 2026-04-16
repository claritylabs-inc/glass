"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { INSURANCE_KEYWORDS, INSURANCE_SENDER_PATTERNS } from "../lib/policyTypes";
import { generateText } from "ai";
import { haikuModel } from "../lib/ai";

async function updateClassificationProgress(
  ctx: any,
  connectionId: any,
  total: number,
  processed: number,
  policiesFound: number,
) {
  await ctx.runMutation(api.connections.updateScanProgress, {
    id: connectionId,
    scanProgress: {
      phase: "classifying",
      totalEmails: total,
      processedEmails: processed,
      insuranceFound: policiesFound,
    },
  });
}

export const classifyEmails = internalAction({
  args: {
    connectionId: v.id("emailConnections"),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.emails.repairProcessedForConnection, {
      connectionId: args.connectionId,
    });

    // Get unprocessed emails for this connection (internal query — no auth needed)
    const emails = await ctx.runQuery(internal.emails.listByConnection, {
      connectionId: args.connectionId,
    });
    const unprocessed = emails.filter((e: any) => !e.processed);

    if (unprocessed.length === 0) {
      // All emails already processed — mark scan complete so UI doesn't stay stuck
      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "complete", totalEmails: emails.length, processedEmails: emails.length },
      });
      return;
    }

    // Get email IDs that already have policies so we can skip them
    const emailIdsWithPolicies = new Set(
      args.orgId
        ? await ctx.runQuery(internal.policies.emailIdsWithPoliciesInternal, {
            orgId: args.orgId,
          })
        : []
    );

    // Include user-specified broker domains as additional sender patterns
    const connection = await ctx.runQuery(internal.connections.getInternal, {
      id: args.connectionId,
    });
    const brokerDomains = (connection?.lastScanParams?.senderDomains ?? [])
      .map((d: string) => d.replace(/^@/, "").toLowerCase())
      .filter(Boolean);

    let policiesFound = 0;
    let processed = 0;
    const total = unprocessed.length;

    // Update progress
    await updateClassificationProgress(ctx, args.connectionId, total, 0, policiesFound);

    try {
      for (const email of unprocessed) {
        // Skip emails that already produced policies
        if (emailIdsWithPolicies.has(email._id)) {
          await ctx.runMutation(api.emails.markProcessed, { id: email._id });
          processed++;
          await updateClassificationProgress(ctx, args.connectionId, total, processed, policiesFound);
          continue;
        }
        const subjectLower = email.subject.toLowerCase();
        const fromLower = email.from.toLowerCase();

        // Skip internal emails from claritylabs.inc — never insurance
        if (fromLower.includes("@claritylabs.inc") || fromLower.includes("claritylabs.inc>")) {
          await ctx.runMutation(api.emails.markClassified, {
            id: email._id,
            isInsuranceRelated: false,
            classificationReason: "Internal claritylabs.inc email",
            classificationConfidence: 1.0,
          });
          await ctx.runMutation(api.emails.markProcessed, { id: email._id });
          processed++;
          await updateClassificationProgress(ctx, args.connectionId, total, processed, policiesFound);
          continue;
        }

        // Fast path: keyword heuristics
        const keywordMatch = INSURANCE_KEYWORDS.some(
          (kw) => subjectLower.includes(kw.toLowerCase())
        );
        const senderMatch = INSURANCE_SENDER_PATTERNS.some(
          (pat) => fromLower.includes(pat.toLowerCase())
        ) || brokerDomains.some(
          (domain: string) => fromLower.includes(domain)
        );

        let isInsurance = false;
        let reason = "";
        let confidence = 0;

        if (keywordMatch && senderMatch) {
          isInsurance = true;
          reason = "Keyword + sender match";
          confidence = 0.95;
        } else if (keywordMatch || senderMatch) {
          // One signal matched — use AI to confirm, but bias toward insurance
          try {
            const { text: rawText } = await generateText({
              model: haikuModel,
              maxOutputTokens: 256,
              messages: [
                {
                  role: "user",
                  content: `You are classifying emails for an insurance brokerage platform. Determine if this email is related to insurance (policies, quotes, certificates, renewals, endorsements, binders, premium notices, claims, proposals, or any insurance documents).

IMPORTANT: When in doubt, classify as insurance-related. Missing a real insurance email is much worse than a false positive. Words like "policy", "coverage", "certificate", "renewal" in a business email context almost always refer to insurance. An email with PDF attachments mentioning "policy" is very likely an insurance document, not a "company policy".

This email's subject already matched an insurance keyword or its sender matched an insurance pattern — only override this if you are very confident it is NOT about insurance.

Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Has attachments: ${email.hasAttachments ? "Yes" : "No"}

Respond with JSON only: {"isInsurance": boolean, "reason": "brief explanation", "confidence": number 0-1}`,
                },
              ],
            });

            const text = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
            const parsed = JSON.parse(text);
            isInsurance = parsed.isInsurance;
            reason = parsed.reason;
            confidence = parsed.confidence;
          } catch {
            // AI failed — heuristic already matched, so default to insurance
            isInsurance = true;
            reason = "AI classification failed, heuristic match used";
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
        // Stagger by 30s per extraction to avoid Anthropic API rate limits
        if (isInsurance && email.hasAttachments) {
          const staggerDelay = policiesFound * 60_000; // 60s between extractions (Tier 1: 30K input tokens/min for Sonnet)
          await ctx.scheduler.runAfter(staggerDelay, internal.actions.extractPolicy.extractPolicy, {
            emailId: email._id,
            connectionId: args.connectionId,
            userId: args.userId,
            orgId: args.orgId,
          });
          policiesFound++;
        }

        // Mark as processed
        await ctx.runMutation(api.emails.markProcessed, { id: email._id });
        processed++;

        await updateClassificationProgress(ctx, args.connectionId, total, processed, policiesFound);
      }
    } catch (error: any) {
      console.error("Classification failed:", error.message);
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
      const connection = await ctx.runQuery(internal.connections.getInternal, {
        id: args.connectionId,
      });
      await ctx.runMutation(api.connections.updateScanStatus, {
        id: args.connectionId,
        lastScanStatus: "success",
        policiesExtracted: (connection?.policiesExtracted ?? 0) + policiesFound,
      });
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

    // Schedule intelligence extraction (triage → extract context from all classified emails)
    await ctx.scheduler.runAfter(0, internal.actions.triageEmails.triageAndExtract, {
      connectionId: args.connectionId,
      userId: args.userId,
      orgId: args.orgId,
    });
  },
});
