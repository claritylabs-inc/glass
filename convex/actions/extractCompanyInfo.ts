"use node";

import { v } from "convex/values";
import { z } from "zod";
import { generateText, Output } from "ai";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { getModel } from "../lib/models";
import { INDUSTRIES } from "../lib/industries";
import { makeEmbedText } from "../lib/sdkCallbacks";

// Build a compact reference of valid industry/vertical values for the prompt
const INDUSTRY_REF = INDUSTRIES.map(
  (i) => `${i.value}: [${i.verticals.map((v) => v.value).join(", ")}]`,
).join("\n");

const CompanyInfoSchema = z.object({
  companyContext: z.string().describe("2-4 sentence factual description: what the company does, industry, size if known, location, key products/services."),
  industry: z.string().describe("Best-matching industry value from the provided list. Empty string if unclear."),
  industryVertical: z.string().describe("Best-matching vertical value for that industry. Empty string if unclear."),
  naicsCode: z.string().describe("NAICS code if explicitly visible. Empty string if not evident."),
  yearsInBusiness: z.string().describe("Years in business if explicitly visible as a number. Empty string if not evident."),
  numberOfEmployees: z.string().describe("Employee count if explicitly visible as a number. Empty string if not evident."),
  annualRevenue: z.string().describe("Annual revenue if explicitly visible. Preserve units/currency. Empty string if not evident."),
  clientsContext: z.string().describe("Typical clients/customers. Empty string if not evident."),
  vendorsContext: z.string().describe("Vendors, suppliers, or service providers. Empty string if not evident."),
  insuranceContext: z.string().describe("Insurance brokers, carriers, or relationships. Empty string if not evident."),
  investorsContext: z.string().describe("Investors, funding sources, shareholders. Empty string if not evident."),
  partnersContext: z.string().describe("Business partners, affiliates, joint ventures. Empty string if not evident."),
});

async function fetchFavicon(siteUrl: string): Promise<Blob | null> {
  let base: URL;
  try {
    base = new URL(siteUrl);
  } catch {
    return null;
  }

  const candidates: string[] = [];
  try {
    const pageRes = await fetch(base.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GlassBot/1.0)" },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const iconMatches = html.matchAll(
        /<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*href=["']([^"']+)["']/gi,
      );
      for (const m of iconMatches) candidates.push(m[2]);
      const reverseMatches = html.matchAll(
        /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']([^"']*icon[^"']*)["']/gi,
      );
      for (const m of reverseMatches) candidates.push(m[1]);
    }
  } catch {
    // ignore
  }

  candidates.push("/apple-touch-icon.png", "/favicon.ico");
  candidates.push(`https://www.google.com/s2/favicons?domain=${base.hostname}&sz=128`);

  for (const candidate of candidates) {
    try {
      const absolute = new URL(candidate, base).toString();
      const res = await fetch(absolute, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; GlassBot/1.0)" },
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/") && !absolute.endsWith(".ico")) continue;
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 64 || buffer.byteLength > 512 * 1024) continue;
      return new Blob([buffer], { type: contentType || "image/x-icon" });
    } catch {
      continue;
    }
  }
  return null;
}

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
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GlassBot/1.0)" },
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
    const viewerOrg = await ctx.runQuery(api.orgs.viewerOrg, {});

    // Favicon — best effort, parallel with content fetch
    if (viewerOrg?.org) {
      void (async () => {
        try {
          const iconBlob = await fetchFavicon(args.url);
          if (iconBlob) {
            const iconStorageId = await ctx.storage.store(iconBlob);
            await ctx.runMutation(internal.orgs.setIconInternal, {
              orgId: viewerOrg.org._id,
              iconStorageId,
            });
          }
        } catch {
          // ignore favicon failures
        }
      })();
    }

    const content =
      (await fetchWithExa(args.url)) ?? (await fetchWithRawHtml(args.url));
    if (!content) {
      return { error: "Could not retrieve website content" };
    }

    const { output: object } = await generateText({
      model: getModel("triage"),
      output: Output.object({ schema: CompanyInfoSchema }),
      maxOutputTokens: 1024,
      prompt: `Extract company information from the website content below.

Valid industry values and their verticals:
${INDUSTRY_REF}

For industry/industryVertical fields, only return a value that exactly matches the list above. Otherwise return an empty string. For text fields, return an empty string if the answer is not evident — do not guess.
Only return NAICS, yearsInBusiness, numberOfEmployees, and annualRevenue when explicitly stated on the site.

Website content:
${content}`,
    });

    const matchedIndustry = INDUSTRIES.find((i) => i.value === object.industry);
    const industry = matchedIndustry?.value;
    const industryVertical = matchedIndustry?.verticals.find(
      (v) => v.value === object.industryVertical,
    )?.value;

    const companyContext = object.companyContext;

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

      const embedText = makeEmbedText();
      let host = args.url;
      try {
        host = new URL(args.url).hostname;
      } catch {
        // Keep raw URL when parsing fails.
      }
      const sourceLabel = `Website enrichment: ${host}`;
      const intelligenceEntries = [
        { content: companyContext, category: "company_info" as const },
        {
          content: object.naicsCode ? `NAICS code: ${object.naicsCode}` : "",
          category: "company_info" as const,
        },
        {
          content: object.yearsInBusiness
            ? `Years in business: ${object.yearsInBusiness}`
            : "",
          category: "operations" as const,
        },
        {
          content: object.numberOfEmployees
            ? `Employee count: ${object.numberOfEmployees}`
            : "",
          category: "employees" as const,
        },
        {
          content: object.annualRevenue
            ? `Annual revenue: ${object.annualRevenue}`
            : "",
          category: "financial" as const,
        },
        { content: object.clientsContext, category: "clients" as const },
        { content: object.vendorsContext, category: "vendors" as const },
        { content: object.insuranceContext, category: "insurance" as const },
        { content: object.investorsContext, category: "investors" as const },
        { content: object.partnersContext, category: "partners" as const },
      ].filter((entry) => entry.content?.trim());

      for (const entry of intelligenceEntries) {
        const content = entry.content.trim();
        let embedding: number[] | undefined;
        try {
          embedding = await embedText(content);
          const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: embedding,
            limit: 3,
            filter: (q) => q.eq("orgId", viewerOrg.org._id),
          });
          if (similar.some((s: { _score?: number }) => (s._score ?? 0) > 0.97)) {
            continue;
          }
        } catch (err) {
          console.error("extractCompanyInfo: embed failed, inserting without embedding", err);
        }
        try {
          await ctx.runMutation(internal.intelligence.insert, {
            orgId: viewerOrg.org._id,
            content,
            category: entry.category,
            confidence: "confirmed",
            source: "manual",
            sourceRef: args.url,
            sourceLabel,
            embedding,
          });
        } catch (err) {
          console.error("extractCompanyInfo: intelligence insert failed", err);
        }
      }

      if ((viewerOrg.org.type ?? "client") === "client") {
        const years = parseInt(object.yearsInBusiness, 10);
        const employees = parseInt(object.numberOfEmployees, 10);
        await ctx.runAction(internal.actions.passportExtraction.mapWebsiteToPassport, {
          clientOrgId: viewerOrg.org._id,
          websiteUrl: args.url,
          extracted: {
            companyContext,
            industry,
            naicsCode: object.naicsCode || undefined,
            yearsInBusiness: Number.isFinite(years) ? years : undefined,
            numberOfEmployees: Number.isFinite(employees) ? employees : undefined,
            annualRevenue: object.annualRevenue || undefined,
          },
        });
      }
    }

    return {
      success: true,
      companyContext,
      industry,
      industryVertical,
      naicsCode: object.naicsCode || undefined,
      yearsInBusiness: object.yearsInBusiness || undefined,
      numberOfEmployees: object.numberOfEmployees || undefined,
      annualRevenue: object.annualRevenue || undefined,
      clientsContext: object.clientsContext || undefined,
      vendorsContext: object.vendorsContext || undefined,
      insuranceContext: object.insuranceContext || undefined,
      investorsContext: object.investorsContext || undefined,
      partnersContext: object.partnersContext || undefined,
    };
  },
});
