"use node";

import { v } from "convex/values";
import { z } from "zod";
import { generateObject } from "ai";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { getModel } from "../lib/models";
import { INDUSTRIES } from "../lib/industries";

const INDUSTRY_REF = INDUSTRIES.map(
  (i) => `${i.value}: [${i.verticals.map((v) => v.value).join(", ")}]`,
).join("\n");

const CompanyInfoSchema = z.object({
  companyContext: z.string().describe("2-4 sentence factual description: what the company does, industry, size if known, location, key products/services."),
  industry: z.string().describe("Best-matching industry value from the provided list. Empty string if unclear."),
  industryVertical: z.string().describe("Best-matching vertical value for that industry. Empty string if unclear."),
  clientsContext: z.string().describe("Typical clients/customers. Empty string if not evident."),
  vendorsContext: z.string().describe("Vendors, suppliers, or service providers. Empty string if not evident."),
  insuranceContext: z.string().describe("Insurance brokers, carriers, or relationships. Empty string if not evident."),
  investorsContext: z.string().describe("Investors, funding sources, shareholders. Empty string if not evident."),
  partnersContext: z.string().describe("Business partners, affiliates, joint ventures. Empty string if not evident."),
});

async function fetchWithExa(url: string): Promise<string | null> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        urls: [url],
        text: { maxCharacters: 12000 },
        livecrawl: "always",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ text?: string; title?: string }> };
    const first = data.results?.[0];
    if (!first?.text) return null;
    return [first.title, first.text].filter(Boolean).join("\n\n");
  } catch {
    return null;
  }
}

async function fetchWithRawHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PrismBot/1.0)" },
    });
    if (!response.ok) return null;
    let html = await response.text();
    html = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (html.length < 200) return null;
    return html.slice(0, 12000);
  } catch {
    return null;
  }
}

export const extractCompanyInfo = action({
  args: { url: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const viewerOrg = await ctx.runQuery(api.orgs.viewerOrg);

    const content =
      (await fetchWithExa(args.url)) ?? (await fetchWithRawHtml(args.url));
    if (!content) {
      return { error: "Could not retrieve website content" };
    }

    const { object } = await generateObject({
      model: getModel("triage"),
      schema: CompanyInfoSchema,
      maxOutputTokens: 1024,
      prompt: `Extract company information from the website content below.

Valid industry values and their verticals:
${INDUSTRY_REF}

For industry/industryVertical fields, only return a value that exactly matches the list above. Otherwise return an empty string. For text fields, return an empty string if the answer is not evident — do not guess.

Website content:
${content}`,
    });

    const matchedIndustry = INDUSTRIES.find((i) => i.value === object.industry);
    const industry = matchedIndustry?.value;
    const industryVertical = matchedIndustry?.verticals.find(
      (v) => v.value === object.industryVertical,
    )?.value;

    const companyContext = object.companyContext;

    const updates: Record<string, string> = { companyContext };
    if (industry) updates.industry = industry;
    if (industryVertical) updates.industryVertical = industryVertical;
    await ctx.runMutation(api.users.updateProfile, updates);

    if (viewerOrg?.org) {
      const orgUpdates: Record<string, string> = { context: companyContext };
      if (industry) orgUpdates.industry = industry;
      if (industryVertical) orgUpdates.industryVertical = industryVertical;
      if (object.clientsContext) orgUpdates.clientsContext = object.clientsContext;
      if (object.vendorsContext) orgUpdates.vendorsContext = object.vendorsContext;
      if (object.insuranceContext) orgUpdates.insuranceContext = object.insuranceContext;
      if (object.investorsContext) orgUpdates.investorsContext = object.investorsContext;
      if (object.partnersContext) orgUpdates.partnersContext = object.partnersContext;
      await ctx.runMutation(api.orgs.updateOrg, orgUpdates);
    }

    return {
      success: true,
      companyContext,
      industry,
      industryVertical,
      clientsContext: object.clientsContext || undefined,
      vendorsContext: object.vendorsContext || undefined,
      insuranceContext: object.insuranceContext || undefined,
      investorsContext: object.investorsContext || undefined,
      partnersContext: object.partnersContext || undefined,
    };
  },
});
