"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Called at the end of extractCompanyInfo to populate passport fields with
 * website-derived suggestions. Writes passportFieldProvenance rows with
 * confidence="suggested".
 */
export const mapWebsiteToPassport = internalAction({
  args: {
    clientOrgId: v.id("organizations"),
    extracted: v.object({
      companyContext: v.optional(v.string()),
      industry: v.optional(v.string()),
    }),
    websiteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const suggestions: Array<{ fieldPath: string; value: unknown }> = [];

    if (args.extracted.companyContext) {
      suggestions.push({
        fieldPath: "businessDescription",
        value: args.extracted.companyContext,
      });
    }
    if (args.websiteUrl) {
      suggestions.push({ fieldPath: "website", value: args.websiteUrl });
    }

    for (const { fieldPath, value } of suggestions) {
      await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
        clientOrgId: args.clientOrgId,
        fieldPath,
        source: "website",
        confidence: "suggested",
        sourceRef: args.websiteUrl,
        sourceLabel: "Website enrichment",
        suggestedValue: value,
        setAt: now,
      });
    }
  },
});

/**
 * Called at the end of extractFromDocument to map extracted KV facts to
 * passport fields. General document → field suggestions; loss run → passportLosses rows.
 */
export const mapDocumentToPassport = internalAction({
  args: {
    clientOrgId: v.id("organizations"),
    orgDocumentId: v.id("orgDocuments"),
    documentType: v.string(),
    extractedEntries: v.array(v.object({
      key: v.string(),
      value: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sourceLabel = `Document: ${args.orgDocumentId}`;

    // Field key → passport fieldPath mapping
    const KEY_MAP: Record<string, string> = {
      annual_revenue: "annualRevenue",
      revenue: "annualRevenue",
      employees: "numberOfEmployees",
      employee_count: "numberOfEmployees",
      fein: "fein",
      tax_id: "fein",
      legal_name: "legalName",
      company_name: "legalName",
      naics: "naicsCode",
      sic: "sicCode",
    };

    for (const entry of args.extractedEntries) {
      const fieldPath = KEY_MAP[entry.key.toLowerCase().replace(/\s+/g, "_")];
      if (!fieldPath) continue;
      await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
        clientOrgId: args.clientOrgId,
        fieldPath,
        source: "document",
        confidence: "suggested",
        sourceRef: args.orgDocumentId,
        sourceLabel,
        suggestedValue: entry.value,
        setAt: now,
      });
    }
  },
});

/**
 * Called when a loss run document is classified. Parses structured loss data
 * and inserts suggested passportLosses rows.
 */
export const mapLossRunToPassportLosses = internalAction({
  args: {
    clientOrgId: v.id("organizations"),
    orgDocumentId: v.id("orgDocuments"),
    losses: v.array(v.object({
      dateOfLoss: v.optional(v.string()),
      lineOfBusiness: v.optional(v.string()),
      claimNumber: v.optional(v.string()),
      description: v.optional(v.string()),
      amountPaid: v.optional(v.string()),
      amountReserved: v.optional(v.string()),
      status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    })),
  },
  handler: async (ctx, args) => {
    if (args.losses.length === 0) return;
    await ctx.runMutation(internal.passportSideTables.bulkFromExtraction, {
      clientOrgId: args.clientOrgId,
      sourceDocumentId: args.orgDocumentId,
      losses: args.losses,
    });
  },
});
