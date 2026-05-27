"use node";

import { generateObject } from "ai";
import { z } from "zod";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModelForOrg } from "../lib/models";

type OpenDiscrepancyForCopy = {
  _id: string;
  fieldGroup: string;
  likelyCurrentValue?: string;
  conflictingValues: Array<{
    displayValue?: string;
    policyIds?: string[];
  }>;
};

const discrepancyCopySchema = z.object({
  question: z.string().min(1),
  plainLanguageSummary: z.string().min(1),
  recommendedAction: z.string().min(1),
});

function labelForFieldGroup(fieldGroup: string) {
  const [group, detail] = fieldGroup.split(":", 2);
  const labels: Record<string, string> = {
    insured_identity: "named insured",
    policy_number: "policy number",
    carrier: "insurance company",
    insurer: "insurer",
    producer: "producer",
    dba: "DBA",
    entity_type: "entity type",
    fein: "FEIN",
    mailing_address: "mailing address",
    scheduled_location: "location",
    additional_named_insured: "additional named insured",
  };
  const base =
    labels[group] ??
    group
      .split("_")
      .filter(Boolean)
      .join(" ");
  return detail ? `${base}: ${detail}` : base;
}

function cleanValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "not shown";
  return text
    .replace(/: null$/i, ": not shown")
    .replace(/\bnull\b/gi, "not shown")
    .replace(/\bunknown\b/gi, "unknown");
}

function fallbackCopy(discrepancy: {
  fieldGroup: string;
  likelyCurrentValue?: string;
  conflictingValues: Array<{ displayValue?: string; policyIds?: string[] }>;
}) {
  const field = labelForFieldGroup(discrepancy.fieldGroup);
  const values = discrepancy.conflictingValues
    .map((value) => cleanValue(value.displayValue))
    .filter(Boolean);
  const uniqueValues = Array.from(new Set(values));
  const valueList = uniqueValues.length > 0 ? uniqueValues.join(" / ") : "different values";
  return {
    question: `Which ${field} should Glass use?`,
    plainLanguageSummary: `Glass found more than one ${field} across active policies: ${valueList}.`,
    recommendedAction: "Confirm the correct value before using it on certificates, renewals, or policy changes.",
  };
}

export const phraseOpenInternal = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<{ phrased: number }> => {
    const rows = await ctx.runQuery((internal as any).declarationFacts.listOpenForCopyInternal, {
      orgId: args.orgId,
    }) as OpenDiscrepancyForCopy[];

    for (const row of rows) {
      const fallback = fallbackCopy(row as {
        fieldGroup: string;
        likelyCurrentValue?: string;
        conflictingValues: Array<{ displayValue?: string; policyIds?: string[] }>;
      });

      let copy = fallback;
      try {
        const values = (row.conflictingValues as Array<{
          displayValue?: string;
          policyIds?: string[];
        }>).map((value) => ({
          value: cleanValue(value.displayValue),
          policyCount: Array.isArray(value.policyIds) ? value.policyIds.length : 0,
        }));

        const result = await generateObject({
          model: await getModelForOrg(ctx, args.orgId, "summary"),
          schema: discrepancyCopySchema,
          system:
            "You write plain-language commercial insurance product copy. Make conflicts understandable to non-technical broker and client users. Do not mention JSON, extraction, normalized values, field groups, databases, or implementation details.",
          prompt: `Write concise display copy for a policy detail conflict.

Field users care about: ${labelForFieldGroup(row.fieldGroup)}
Best guess from the system: ${cleanValue(row.likelyCurrentValue)}
Values found on active policies:
${values.map((value) => `- ${value.value} (${value.policyCount} active policy${value.policyCount === 1 ? "" : "ies"})`).join("\n")}

Rules:
- The question should ask what the user needs to confirm.
- The summary should explain what differs in one sentence.
- The recommended action should say what to do before using this value.
- Use normal insurance words like "named insured", "policy number", or "insurance company".
- Never show raw labels like insured_identity, coverage_limit, null, referential, or normalized value.`,
        });
        copy = result.object;
      } catch (error) {
        console.warn(
          "Failed to generate declaration discrepancy copy",
          error instanceof Error ? error.message : String(error),
        );
      }

      await ctx.runMutation((internal as any).declarationFacts.updateCopyInternal, {
        discrepancyId: row._id,
        question: copy.question,
        plainLanguageSummary: copy.plainLanguageSummary,
        recommendedAction: copy.recommendedAction,
      });
    }

    return { phrased: rows.length };
  },
});
