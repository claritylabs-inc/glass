"use node";

import { v } from "convex/values";
import { z } from "zod";
import { generateText, Output } from "ai";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getModelAndRouteForOrg } from "../lib/models";
import { structuredOutputSchemaForRoute } from "../lib/fireworksStructuredOutput";
import { INDUSTRIES } from "../lib/industries";
import { runWebRetrieval } from "../lib/webRetrieval";

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
  atomicFacts: z.array(z.string()).describe(
    [
      "Atomic, durable facts about the company that are useful as long-term memory.",
      "Each entry MUST follow these rules:",
      "- Exactly ONE fact per entry. Never combine facts with 'and', commas, or semicolons.",
      "- A single short declarative sentence, ideally under 15 words.",
      "- Self-contained and unambiguous when read in isolation (use the company's name, not 'we'/'the company'/'they').",
      "- Only include facts explicitly evident from the website content. Do not speculate, summarize broadly, or hedge ('appears to', 'likely', 'may').",
      "- Prefer concrete, structured statements (products, services, locations, named clients/partners/investors, headcount, founding year, NAICS, revenue) over generic marketing language.",
      "- Do NOT prefix entries with labels like 'NAICS:' or 'Clients:' — write a complete sentence instead (e.g. 'Acme's NAICS code is 541512.').",
      "- Skip duplicates and near-duplicates. Return [] if nothing reliable is evident.",
      "Examples: 'Acme builds AI software for commercial insurance brokers.', 'Acme is headquartered in San Francisco, California.', 'Acme employs about 25 people.', 'Acme's investors include Sequoia Capital.'",
    ].join(" "),
  ),
});

type CompanyInfo = z.infer<typeof CompanyInfoSchema>;
type ExtractCompanyInfoResult = {
  error?: string;
  success?: true;
  companyContext?: string;
  industry?: string;
  industryVertical?: string;
} & Partial<Omit<CompanyInfo, "companyContext" | "industry" | "industryVertical">>;

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

export const extractCompanyInfo = action({
  args: { url: v.string(), orgId: v.optional(v.id("organizations")) },
  returns: v.any(),
  handler: async (ctx, args): Promise<ExtractCompanyInfoResult> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const viewerOrg: { org: { _id: Id<"organizations"> } } | null = await ctx.runQuery(
      api.orgs.viewerOrg,
      {},
    );
    const targetOrgId = args.orgId ?? viewerOrg?.org?._id;
    if (!targetOrgId) throw new Error("Organization not found");
    if (args.orgId && args.orgId !== viewerOrg?.org?._id) {
      const access = await ctx.runQuery(
        internal.clientInvitations.resolveAccessInternal,
        {
          userId: viewer._id,
          orgId: args.orgId,
        },
      );
      if (!access) throw new Error("Not authorized");
    }

    // Favicon — best effort, parallel with content fetch
    void (async () => {
      try {
        const iconBlob = await fetchFavicon(args.url);
        if (iconBlob) {
          const iconStorageId = await ctx.storage.store(iconBlob);
          await ctx.runMutation(internal.orgs.setIconInternal, {
            orgId: targetOrgId,
            iconStorageId,
          });
        }
      } catch {
        // ignore favicon failures
      }
    })();

    const retrieval = await runWebRetrieval(ctx, targetOrgId, {
      url: args.url,
      goal: "Extract factual company profile information from this organization's public website.",
      maxResults: 1,
    });
    const content = retrieval.text;
    if (!content) {
      return { error: "Could not retrieve website content" };
    }

    const modelRoute = await getModelAndRouteForOrg(ctx, targetOrgId, "triage");
    const { output: object } = (await generateText({
      model: modelRoute.model,
      output: Output.object({
        schema: structuredOutputSchemaForRoute(CompanyInfoSchema, modelRoute.route),
      }),
      maxOutputTokens: 2048,
      prompt: `Extract company information from the website content below.

Valid industry values and their verticals:
${INDUSTRY_REF}

For industry/industryVertical fields, only return a value that exactly matches the list above. Otherwise return an empty string. For text fields, return an empty string if the answer is not evident — do not guess.
Only return NAICS, yearsInBusiness, numberOfEmployees, and annualRevenue when explicitly stated on the site.

For atomicFacts, decompose what's on the site into the smallest possible standalone facts (one idea each, one short sentence each). Do not paraphrase the same fact twice. Do not include the verbose companyContext sentence as an atomicFact.

Website content:
${content}`,
    })) as { output: CompanyInfo };

    const matchedIndustry = INDUSTRIES.find((i) => i.value === object.industry);
    const industry = matchedIndustry?.value;
    const industryVertical = matchedIndustry?.verticals.find(
      (v) => v.value === object.industryVertical,
    )?.value;

    const companyContext = object.companyContext;

    if (targetOrgId) {
      const orgUpdates: Record<string, string> = { context: companyContext };
      if (industry) orgUpdates.industry = industry;
      if (industryVertical) orgUpdates.industryVertical = industryVertical;
      await ctx.runMutation(internal.orgs.updateProfileInternal, {
        orgId: targetOrgId,
        ...orgUpdates,
      });

      const seen = new Set<string>();
      const memoryItems = (object.atomicFacts ?? [])
        .map((fact) => fact.trim())
        .filter((fact) => {
          if (!fact) return false;
          // Skip multi-fact runs that slipped past the prompt rules.
          if (fact.length > 240) return false;
          const key = fact.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((content) => ({
          orgId: targetOrgId,
          type: "fact" as const,
          content,
          source: "extraction" as const,
        }));

      if (memoryItems.length > 0) {
        await ctx.runMutation(internal.orgMemory.bulkInsert, {
          items: memoryItems,
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
    };
  },
});
