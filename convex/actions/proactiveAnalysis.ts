"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModel, generateTextWithFallback } from "../lib/models";
import { logAiError } from "../lib/aiUtils";
import { buildIntelligenceContext } from "../lib/agentPrompts";
import { makeEmbedText } from "../lib/sdkCallbacks";

const POLICY_TYPE_GUIDANCE: Record<string, string> = {
  general_liability: `GL policy analysis:
- Per-occurrence vs aggregate limits — check if aggregate is at least 2x per-occurrence
- Products/completed operations — should have separate aggregate
- Defense cost treatment: inside vs outside limits (outside is better)
- Additional insured provisions and blanket endorsements
- Personal and advertising injury — check sublimits`,

  workers_comp: `Workers' Compensation analysis:
- Experience modification rate — below 1.0 is favorable
- Employer's liability limits — standard is $100K/$500K/$100K, recommend $1M
- State-specific requirements — verify compliance`,

  commercial_property: `Commercial Property analysis:
- Coinsurance adequacy — 80% or 90% clause, verify insured values
- Business income / extra expense — adequate period of indemnity (12+ months)
- Equipment breakdown — increasingly critical, check inclusion
- Replacement cost vs ACV — replacement cost preferred`,

  professional_liability: `Professional Liability analysis:
- Claims-made vs occurrence — claims-made needs retroactive date review
- Extended reporting period (tail) options and cost
- Prior acts coverage — retroactive date should cover full practice history`,

  cyber: `Cyber Liability analysis:
- First-party vs third-party coverage scope
- Sublimits on specific coverages (ransomware, business interruption, notification)
- Social engineering / funds transfer fraud coverage
- Retroactive date for claims-made trigger`,

  commercial_auto: `Commercial Auto analysis:
- Combined single limit vs split limits — CSL is simpler
- Hired and non-owned auto — essential for businesses using employee vehicles
- Uninsured/underinsured motorist — match liability limits`,

  umbrella: `Umbrella/Excess analysis:
- Following form vs stand-alone — following form is broader
- Drop-down provision when underlying is exhausted
- Scheduling all underlying policies — verify no gaps`,

  directors_officers: `D&O analysis:
- Side A (individual directors) — most critical
- Side B (company reimbursement) and Side C (entity coverage)
- Insured vs Insured exclusion — watch for overly broad version
- Prior acts coverage and retroactive date
- Securities claim definition breadth`,
};

function getGuidance(policyTypes?: string[]): string {
  if (!policyTypes?.length) return "General commercial insurance — check for adequate limits and notable exclusions.";
  const sections: string[] = [];
  for (const pt of policyTypes) {
    if (POLICY_TYPE_GUIDANCE[pt]) sections.push(POLICY_TYPE_GUIDANCE[pt]);
  }
  return sections.length > 0 ? sections.join("\n\n") : "General commercial insurance — check for adequate limits and notable exclusions.";
}

export const analyzePolicy = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });

      if (!policy || policy.extractionStatus !== "complete") return;
      if (policy.analysis) return; // already analyzed

      const guidance = getGuidance(policy.policyTypes);
      const policyDesc = `${policy.security || policy.carrier} ${policy.policyTypes?.join(", ")} policy`;
      const memoryBlock = await buildIntelligenceContext(ctx, args.orgId, policyDesc);

      const prompt = `Analyze this insurance policy and provide a structured health check.

${guidance}

Policy data:
- Insured: ${policy.insuredName}
- Carrier: ${policy.security}
- Type: ${policy.policyTypes?.join(", ")}
- Policy Number: ${policy.policyNumber}
- Effective: ${policy.effectiveDate} to ${policy.expirationDate}
- Premium: ${policy.premium}
- Limits: ${JSON.stringify(policy.limits ?? {})}
- Deductibles: ${JSON.stringify(policy.deductibles ?? {})}
- Summary: ${policy.summary ?? "N/A"}
${memoryBlock}

Respond with a JSON object:
{
  "overallScore": "good" | "adequate" | "needs_attention" | "concerning",
  "strengths": ["...", "..."],
  "gaps": ["...", "..."],
  "recommendations": ["...", "..."],
  "limitAssessment": "brief assessment",
  "deductibleAssessment": "brief assessment",
  "notableExclusions": ["...", "..."]
}`;

      const { text } = await generateTextWithFallback({
        model: getModel("analysis"),
        maxOutputTokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      let analysis: Record<string, unknown>;
      try {
        const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
      } catch {
        analysis = { raw: text };
      }

      await ctx.runMutation(internal.policies.updateAnalysis, {
        id: args.policyId,
        analysis,
      });

      // Save key facts/risk notes to orgIntelligence
      const carrier = policy.security ?? "unknown carrier";
      const policyType = policy.policyTypes?.[0] ?? "policy";
      const sourceLabel = `${carrier} ${policyType} analysis`;
      const sourceRef = args.policyId as string;
      const embed = makeEmbedText();

      const entries: Array<{ content: string; category: "risk" | "coverage" | "observation" }> = [];

      if (analysis.gaps?.length) {
        for (const gap of analysis.gaps.slice(0, 3)) {
          entries.push({
            content: `Coverage gap (${carrier} ${policyType}): ${gap}`,
            category: "risk",
          });
        }
      }
      if (analysis.notableExclusions?.length) {
        for (const excl of analysis.notableExclusions.slice(0, 3)) {
          entries.push({
            content: `Notable exclusion (${carrier} ${policyType}): ${excl}`,
            category: "risk",
          });
        }
      }
      if (analysis.recommendations?.length) {
        for (const rec of analysis.recommendations.slice(0, 3)) {
          entries.push({
            content: `Recommendation (${carrier} ${policyType}): ${rec}`,
            category: "observation",
          });
        }
      }
      if (analysis.strengths?.length) {
        entries.push({
          content: `${carrier} ${policyType}: ${analysis.overallScore} — ${analysis.strengths[0]}`,
          category: "coverage",
        });
      }

      for (const entry of entries) {
        try {
          const embedding = await embed(entry.content);
          const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: embedding,
            limit: 3,
            filter: (q: { eq: (field: string, value: unknown) => unknown }) => q.eq("orgId", args.orgId),
          });
          if (similar.some((s: { _score: number }) => s._score > 0.95)) continue;

          await ctx.runMutation(internal.intelligence.insert, {
            orgId: args.orgId,
            content: entry.content,
            category: entry.category,
            confidence: "confirmed",
            source: "extraction",
            sourceRef,
            sourceLabel,
            embedding,
          });
        } catch {
          // Non-critical — continue with remaining entries
        }
      }
    } catch (err) {
      logAiError("analyzePolicy", err, { policyId: args.policyId });
    }
  },
});

export const analyzePortfolio = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    try {
      const [policies, org] = await Promise.all([
        ctx.runQuery(internal.policies.listAllInternal, { orgId: args.orgId }),
        ctx.runQuery(internal.orgs.getInternal, { id: args.orgId }),
      ]);

      if (policies.length < 2) return;

      const memoryBlock = await buildIntelligenceContext(ctx, args.orgId, "insurance portfolio analysis coverage gaps");
      const policySummaries = policies.map((p: Record<string, unknown>) => ({
        carrier: p.security,
        type: p.policyTypes?.join(", "),
        limits: p.limits,
        premium: p.premium,
        effective: p.effectiveDate,
        expiration: p.expirationDate,
      }));

      const prompt = `Analyze this insurance portfolio for ${org?.name ?? "this organization"}.

Policies (${policies.length}):
${JSON.stringify(policySummaries, null, 2)}
${memoryBlock}

Provide a portfolio-level assessment as JSON:
{
  "overallHealth": "strong" | "adequate" | "gaps_identified" | "needs_review",
  "coverageGaps": ["missing coverage types or inadequate limits"],
  "overlaps": ["areas where coverage overlaps"],
  "recommendations": ["actionable recommendations"],
  "totalPremium": number,
  "keyRisks": ["top risks not adequately addressed"]
}`;

      const { text } = await generateTextWithFallback({
        model: getModel("analysis"),
        maxOutputTokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      let analysis: Record<string, unknown>;
      try {
        const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
      } catch {
        analysis = { raw: text };
      }

      await ctx.runMutation(internal.orgs.updatePortfolioAnalysis, {
        id: args.orgId,
        portfolioAnalysis: analysis,
      });

      // Write portfolio-level findings to orgIntelligence
      const embed = makeEmbedText();
      const portfolioEntries: string[] = [];

      if (analysis.coverageGaps?.length) {
        for (const gap of analysis.coverageGaps.slice(0, 3)) {
          portfolioEntries.push(`Portfolio gap: ${gap}`);
        }
      }
      if (analysis.keyRisks?.length) {
        for (const risk of analysis.keyRisks.slice(0, 3)) {
          portfolioEntries.push(`Portfolio risk: ${risk}`);
        }
      }
      if (analysis.recommendations?.length) {
        for (const rec of analysis.recommendations.slice(0, 3)) {
          portfolioEntries.push(`Portfolio recommendation: ${rec}`);
        }
      }
      if (analysis.overallHealth) {
        portfolioEntries.push(`Portfolio health: ${analysis.overallHealth} (${policies.length} policies, total premium ${analysis.totalPremium ?? "N/A"})`);
      }

      for (const content of portfolioEntries) {
        try {
          const embedding = await embed(content);
          const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: embedding,
            limit: 3,
            filter: (q: { eq: (field: string, value: unknown) => unknown }) => q.eq("orgId", args.orgId),
          });
          if (similar.some((s: { _score: number }) => s._score > 0.95)) continue;

          await ctx.runMutation(internal.intelligence.insert, {
            orgId: args.orgId,
            content,
            category: "observation",
            confidence: "confirmed",
            source: "extraction",
            embedding,
          });
        } catch {
          // Non-critical
        }
      }
    } catch (err) {
      logAiError("analyzePortfolio", err, { orgId: args.orgId });
    }
  },
});

export const compareRenewal = internalAction({
  args: {
    newPolicyId: v.id("policies"),
    priorPolicyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      const [newPolicy, priorPolicy] = await Promise.all([
        ctx.runQuery(internal.policies.getInternal, { id: args.newPolicyId }),
        ctx.runQuery(internal.policies.getInternal, { id: args.priorPolicyId }),
      ]);

      if (!newPolicy || !priorPolicy) return;

      const prompt = `Compare this insurance policy renewal:

PRIOR POLICY:
- Carrier: ${priorPolicy.security}
- Type: ${priorPolicy.policyTypes?.join(", ")}
- Premium: ${priorPolicy.premium}
- Limits: ${JSON.stringify(priorPolicy.limits ?? {})}
- Deductibles: ${JSON.stringify(priorPolicy.deductibles ?? {})}
- Period: ${priorPolicy.effectiveDate} to ${priorPolicy.expirationDate}

RENEWAL POLICY:
- Carrier: ${newPolicy.security}
- Type: ${newPolicy.policyTypes?.join(", ")}
- Premium: ${newPolicy.premium}
- Limits: ${JSON.stringify(newPolicy.limits ?? {})}
- Deductibles: ${JSON.stringify(newPolicy.deductibles ?? {})}
- Period: ${newPolicy.effectiveDate} to ${newPolicy.expirationDate}

Provide a comparison as JSON:
{
  "premiumChange": { "amount": number, "percentage": number, "direction": "increase" | "decrease" | "unchanged" },
  "limitChanges": ["description of each limit change"],
  "deductibleChanges": ["description of each deductible change"],
  "coverageChanges": ["added or removed coverages"],
  "overallAssessment": "brief assessment",
  "actionItems": ["things to review or discuss with the client"]
}`;

      const { text } = await generateTextWithFallback({
        model: getModel("analysis"),
        maxOutputTokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      let comparison: Record<string, unknown>;
      try {
        const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        comparison = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
      } catch {
        comparison = { raw: text };
      }

      const summaryNote = `Renewal comparison: ${newPolicy.security} ${newPolicy.policyTypes?.[0]} — ${comparison.overallAssessment ?? "see analysis"}`;
      const embed = makeEmbedText();
      try {
        const embedding = await embed(summaryNote);
        const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
          vector: embedding,
          limit: 3,
          filter: (q: { eq: (field: string, value: unknown) => unknown }) => q.eq("orgId", args.orgId),
        });
        if (!similar.some((s: { _score: number }) => s._score > 0.95)) {
          await ctx.runMutation(internal.intelligence.insert, {
            orgId: args.orgId,
            content: summaryNote,
            category: "observation",
            confidence: "confirmed",
            source: "extraction",
            sourceRef: args.newPolicyId as string,
            embedding,
          });
        }
      } catch {
        // Non-critical — renewal comparison already saved to policy
      }
    } catch (err) {
      logAiError("compareRenewal", err, { newPolicyId: args.newPolicyId, priorPolicyId: args.priorPolicyId });
    }
  },
});
