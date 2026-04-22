"use node";

import { v } from "convex/values";
import { z } from "zod";
import { generateText, Output } from "ai";
import { action } from "../_generated/server";
import { api, internal as _internal } from "../_generated/api";
import { getModel } from "../lib/models";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

const PassportFieldsSchema = z.object({
  legalName: z.string().describe("Company legal name. Empty string if not evident."),
  dba: z.string().describe("Doing-business-as name. Empty string if not evident."),
  fein: z.string().describe("Federal Employer ID. Empty string if not evident."),
  entityType: z.string().describe("One of: corporation, llc, partnership, sole_proprietor, nonprofit, government, other. Empty string if unclear."),
  website: z.string().describe("Company website URL. Empty string if not evident."),
  naicsCode: z.string().describe("NAICS code. Empty string if not evident."),
  businessDescription: z.string().describe("2-4 sentence factual description of what the company does. Empty string if not evident."),
  operationsSummary: z.string().describe("Operations summary — key operations, locations served, special risks. Empty string if not evident."),
  yearsInBusiness: z.string().describe("Integer years in business as a string. Empty string if not evident."),
  numberOfEmployees: z.string().describe("Integer employee count as a string. Empty string if not evident."),
  annualRevenue: z.string().describe("Annual revenue with currency/units preserved. Empty string if not evident."),
  primaryContactName: z.string().describe("Primary contact full name. Empty string if not evident."),
  primaryContactTitle: z.string().describe("Primary contact title/role. Empty string if not evident."),
  primaryContactEmail: z.string().describe("Primary contact email address. Empty string if not evident."),
  primaryContactPhone: z.string().describe("Primary contact phone number. Empty string if not evident."),
  ownershipNotes: z.string().describe("Parent/subsidiary/ownership structure notes. Empty string if not evident."),
});

const NUMBER_FIELDS = new Set(["yearsInBusiness", "numberOfEmployees"]);

export const proposeFromContext = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<{ success: boolean; written?: number; reason?: string; error?: string }> => {
    const viewer = (await ctx.runQuery(api.users.viewer)) as { _id: string } | null;
    if (!viewer) return { success: false, error: "Not authenticated" };

    const orgData = (await ctx.runQuery(api.orgs.viewerOrg, {})) as
      | {
          org: {
            _id: string;
            name?: string;
            type?: string;
            website?: string;
            context?: string;
            industry?: string;
            industryVertical?: string;
            clientsContext?: string;
            vendorsContext?: string;
            insuranceContext?: string;
            investorsContext?: string;
            partnersContext?: string;
          };
        }
      | null;
    if (!orgData) return { success: false, error: "No organization" };
    if ((orgData.org.type ?? "client") !== "client") {
      return { success: false, reason: "not-client" };
    }
    const clientOrgId = orgData.org._id;
    const org = orgData.org;

    const intel = ((await ctx.runQuery(api.intelligence.list, {})) ?? []) as Array<{
      category: string;
      content: string;
    }>;

    const orgProfileLines: string[] = [];
    if (org.name) orgProfileLines.push(`Company name: ${org.name}`);
    if (org.website) orgProfileLines.push(`Website: ${org.website}`);
    if (org.context) orgProfileLines.push(`About: ${org.context}`);
    if (org.industry) orgProfileLines.push(`Industry: ${org.industry}`);
    if (org.industryVertical) orgProfileLines.push(`Vertical: ${org.industryVertical}`);
    if (org.clientsContext) orgProfileLines.push(`Clients: ${org.clientsContext}`);
    if (org.vendorsContext) orgProfileLines.push(`Vendors: ${org.vendorsContext}`);
    if (org.insuranceContext) orgProfileLines.push(`Insurance: ${org.insuranceContext}`);
    if (org.investorsContext) orgProfileLines.push(`Investors: ${org.investorsContext}`);
    if (org.partnersContext) orgProfileLines.push(`Partners: ${org.partnersContext}`);

    if (intel.length === 0 && orgProfileLines.length === 0) {
      return { success: false, reason: "no-context" };
    }

    const passportData = (await ctx.runQuery(api.clientPassport.getFull, {})) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      passport?: Record<string, any>;
      provenance?: Array<{ fieldPath: string; confidence: string; suggestedValue?: unknown }>;
    } | null;
    const passport = passportData?.passport ?? {};
    const provenance = passportData?.provenance ?? [];

    const occupied = new Set<string>();
    for (const p of provenance) {
      if (p.confidence === "confirmed") occupied.add(p.fieldPath);
      else if (p.suggestedValue !== undefined && p.suggestedValue !== null && String(p.suggestedValue).trim()) {
        occupied.add(p.fieldPath);
      }
    }

    const intelLines = intel
      .slice(-200)
      .map((e) => `- [${e.category}] ${e.content}`);
    const factText = [
      orgProfileLines.length ? `Company profile:\n${orgProfileLines.map((l) => `- ${l}`).join("\n")}` : "",
      intelLines.length ? `Additional facts:\n${intelLines.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { output } = await generateText({
      model: getModel("document_extraction"),
      output: Output.object({ schema: PassportFieldsSchema }),
      maxOutputTokens: 2048,
      system:
        "You are extracting structured company facts for an insurance passport. Given the company profile and facts below, fill in each field. For businessDescription, always produce a 2-4 sentence factual summary if any context is available. Return an empty string only for fields that are truly unsupported — do not guess specific numbers or identifiers.",
      prompt: factText,
    });

    const now = Date.now();
    let written = 0;

    for (const [fieldPath, rawValue] of Object.entries(output)) {
      if (typeof rawValue !== "string") continue;
      const trimmed = rawValue.trim();
      if (!trimmed) continue;
      // Skip fields already set on passport or already suggested.
      if (passport[fieldPath]) continue;
      if (occupied.has(fieldPath)) continue;

      let value: unknown = trimmed;
      if (NUMBER_FIELDS.has(fieldPath)) {
        const n = parseInt(trimmed.replace(/[^0-9-]/g, ""), 10);
        if (!Number.isFinite(n)) continue;
        value = n;
      }

      await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
        clientOrgId,
        fieldPath,
        source: "document",
        confidence: "suggested",
        sourceLabel: "Company context",
        suggestedValue: value,
        setAt: now,
      });
      written++;
    }

    return { success: true, written };
  },
});
