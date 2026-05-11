"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateTextWithFallback, getModelForOrg } from "../lib/models";
import { buildIntelligenceContext } from "../lib/agentPrompts";
import { logAiError } from "../lib/aiUtils";

/**
 * AI-generated email body. Replaces fixed inline body construction
 * with context-aware, natural email writing.
 */
export const run = internalAction({
  args: {
    orgId: v.id("organizations"),
    intent: v.string(),
    policyContext: v.optional(v.any()),
    recipientContext: v.optional(v.string()),
    tone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ subject: string; body: string }> => {
    const org = await ctx.runQuery(internal.orgs.getInternal, { id: args.orgId });
    if (!org) throw new Error("Organization not found");
    const brokerOrg = org.type === "client" && org.brokerOrgId
      ? await ctx.runQuery(internal.orgs.getInternal, { id: org.brokerOrgId })
      : null;
    const brokerContact = brokerOrg?.primaryInsuranceContactId
      ? await ctx.runQuery(internal.users.getInternal, { id: brokerOrg.primaryInsuranceContactId })
      : null;

    const memoryBlock = await buildIntelligenceContext(ctx, args.orgId, args.intent);
    const tone = args.tone ?? "professional";

    const prompt = `Write an email for a commercial insurance context.

Organization: ${org.name}
Industry: ${org.industry ?? "N/A"}
Broker: ${brokerOrg?.name ?? "N/A"} (Contact: ${brokerContact?.name ?? "N/A"})
Tone: ${tone}

Intent: ${args.intent}

${args.recipientContext ? `Recipient context: ${args.recipientContext}` : ""}
${args.policyContext ? `Policy context:\n${JSON.stringify(args.policyContext, null, 2)}` : ""}
${memoryBlock}

Write the email as Glass on behalf of ${org.name}. Be professional and concise.
Do NOT include a sign-off — the "sent with Glass" signature is added automatically.

Respond with JSON:
{
  "subject": "email subject line",
  "body": "email body text"
}`;

    try {
      const { text } = await generateTextWithFallback({
        model: await getModelForOrg(ctx, args.orgId, "email_draft"),
        maxOutputTokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }, {
        task: "email_draft",
      });

      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          subject: parsed.subject ?? "Update from Glass",
          body: parsed.body ?? text,
        };
      }
      return { subject: "Update from Glass", body: text };
    } catch (err) {
      logAiError("generateEmailBody", err, { orgId: args.orgId });
      throw err;
    }
  },
});
