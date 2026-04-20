"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { generateText } from "ai";
import { haikuModel } from "../lib/ai";
import { INDUSTRIES } from "../lib/industries";

// Build a compact reference of valid industry/vertical values for the prompt
const INDUSTRY_REF = INDUSTRIES.map(
  (i) =>
    `${i.value}: [${i.verticals.map((v) => v.value).join(", ")}]`
).join("\n");

export const extractCompanyInfo = action({
  args: { url: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const viewerOrg = await ctx.runQuery(api.orgs.viewerOrg);

    // Fetch the URL
    const response = await fetch(args.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CellEmail/1.0)",
      },
    });
    if (!response.ok) {
      return { error: `Failed to fetch website: ${response.status}` };
    }

    let html = await response.text();

    // Strip HTML tags, scripts, styles
    html = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Truncate to ~8000 chars
    if (html.length > 8000) {
      html = html.slice(0, 8000);
    }

    const { text } = await generateText({
      model: haikuModel,
      maxOutputTokens: 1024,
      messages: [
        {
          role: "user",
          content: `Based on this website content, extract company information and return a JSON object with these fields:

1. "companyContext": A 2-4 sentence description of the company. Include their industry, what they do, approximate size if mentioned, location, and key products/services. Be concise and factual.
2. "industry": The best-matching industry value from the list below.
3. "industryVertical": The best-matching vertical value for that industry from the list below.
4. "clientsContext": Who are the company's typical clients/customers? (e.g. "Small to mid-size restaurants in the Bay Area", "Enterprise SaaS companies"). Leave empty if not clear from the website.
5. "vendorsContext": Key vendors, suppliers, or service providers mentioned or implied. (e.g. "AWS for cloud hosting, Stripe for payments"). Leave empty if not clear.
6. "insuranceContext": Any insurance brokers, carriers, or insurance relationships mentioned. Leave empty if not found.
7. "investorsContext": Any investors, funding sources, or shareholders mentioned. Leave empty if not found.
8. "partnersContext": Any business partners, affiliates, or joint ventures mentioned. Leave empty if not found.

Valid industry values and their verticals:
${INDUSTRY_REF}

Return ONLY valid JSON, no other text.

Website content:
${html}`,
        },
      ],
    });

    // Parse JSON response
    let companyContext = text;
    let industry: string | undefined;
    let industryVertical: string | undefined;

    try {
      const parsed = JSON.parse(text.replace(/```json?\n?|\n?```/g, "").trim());
      if (parsed.companyContext) companyContext = parsed.companyContext;
      // Validate industry/vertical against known values
      const matchedIndustry = INDUSTRIES.find((i) => i.value === parsed.industry);
      if (matchedIndustry) {
        industry = matchedIndustry.value;
        const matchedVertical = matchedIndustry.verticals.find(
          (v) => v.value === parsed.industryVertical
        );
        if (matchedVertical) industryVertical = matchedVertical.value;
      }
    } catch {
      // If JSON parsing fails, use the raw text as companyContext
    }

    // Extract relationship context fields
    let clientsContext: string | undefined;
    let vendorsContext: string | undefined;
    let insuranceContext: string | undefined;
    let investorsContext: string | undefined;
    let partnersContext: string | undefined;
    try {
      const parsed = JSON.parse(text.replace(/```json?\n?|\n?```/g, "").trim());
      if (parsed.clientsContext) clientsContext = parsed.clientsContext;
      if (parsed.vendorsContext) vendorsContext = parsed.vendorsContext;
      if (parsed.insuranceContext) insuranceContext = parsed.insuranceContext;
      if (parsed.investorsContext) investorsContext = parsed.investorsContext;
      if (parsed.partnersContext) partnersContext = parsed.partnersContext;
    } catch {
      // Already handled above
    }

    // Save to user profile for backward compatibility during the org transition.
    const updates: Record<string, string> = { companyContext };
    if (industry) updates.industry = industry;
    if (industryVertical) updates.industryVertical = industryVertical;
    await ctx.runMutation(api.users.updateProfile, updates);

    if (viewerOrg?.org) {
      const orgUpdates: Record<string, string> = { context: companyContext };
      if (industry) orgUpdates.industry = industry;
      if (industryVertical) orgUpdates.industryVertical = industryVertical;
      if (clientsContext) orgUpdates.clientsContext = clientsContext;
      if (vendorsContext) orgUpdates.vendorsContext = vendorsContext;
      if (insuranceContext) orgUpdates.insuranceContext = insuranceContext;
      if (investorsContext) orgUpdates.investorsContext = investorsContext;
      if (partnersContext) orgUpdates.partnersContext = partnersContext;
      await ctx.runMutation(api.orgs.updateOrg, orgUpdates);
    }

    return {
      success: true,
      companyContext,
      industry,
      industryVertical,
      clientsContext,
      vendorsContext,
      insuranceContext,
      investorsContext,
      partnersContext,
    };
  },
});
