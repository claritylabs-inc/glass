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

    // Fetch the URL
    const response = await fetch(args.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClarityLabs/1.0)",
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

    // Save to user profile
    const updates: Record<string, string> = { companyContext };
    if (industry) updates.industry = industry;
    if (industryVertical) updates.industryVertical = industryVertical;
    await ctx.runMutation(api.users.updateProfile, updates);

    return { success: true, companyContext, industry, industryVertical };
  },
});
