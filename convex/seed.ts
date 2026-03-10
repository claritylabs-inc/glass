import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAuth } from "./lib/auth";
import { requireOrgAccess } from "./lib/orgAuth";
import { getAuthUserId } from "@convex-dev/auth/server";
import Anthropic from "@anthropic-ai/sdk";
import { Id } from "./_generated/dataModel";

// ── Public action: generate and insert demo data ──
export const seed = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get org membership
    const orgData = await ctx.runQuery(api.orgs.viewerOrg);
    const orgId = orgData?.org?._id;

    // Check if user already has seeded data
    const existing = await ctx.runQuery(internal.seed.hasExistingConnection, { userId });
    if (existing) return "Already seeded";

    // Get org or user profile for context
    const org = orgId ? await ctx.runQuery(internal.orgs.getInternal, { id: orgId }) : null;
    const user = await ctx.runQuery(internal.users.getInternal, { id: userId });
    const companyName = org?.name || user?.companyName || "Demo Company";
    const companyContext = org?.context || user?.companyContext || "";
    const industry = org?.industry || user?.industry || "";
    const industryVertical = org?.industryVertical || user?.industryVertical || "";

    let seedData: SeedPayload;

    try {
      seedData = await generateWithHaiku({
        companyName,
        companyContext,
        industry,
        industryVertical,
      });
    } catch (e) {
      console.error("Haiku generation failed, using fallback:", e);
      seedData = getFallbackData(companyName);
    }

    await ctx.runMutation(internal.seed.insertSeedData, {
      userId,
      orgId,
      data: seedData,
    });

    return `Seeded successfully: 1 connection, ${seedData.emails.length} emails, ${seedData.policies.length} policies`;
  },
});

// ── Check for existing connection ──
export const hasExistingConnection = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("emailConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    return !!existing;
  },
});

// ── Remove all demo data ──
export const removeDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    let removed = 0;

    // Delete demo policies + their stored files
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const policy of policies) {
      if (policy.isDemo) {
        if (policy.fileId) await ctx.storage.delete(policy.fileId);
        await ctx.db.delete(policy._id);
        removed++;
      }
    }

    // Delete demo emails
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const email of emails) {
      if (email.isDemo) {
        await ctx.db.delete(email._id);
        removed++;
      }
    }

    // Delete demo connections
    const connections = await ctx.db
      .query("emailConnections")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const conn of connections) {
      if (conn.isDemo) {
        await ctx.db.delete(conn._id);
        removed++;
      }
    }

    return { removed };
  },
});

// ── Check if user has demo data ──
export const hasDemoData = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("isDemo"), true))
      .first();
    return !!policy;
  },
});

// ── Internal mutation to insert seed data ──
export const insertSeedData = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
    data: v.any(),
  },
  handler: async (ctx, { userId, orgId, data }) => {
    const seedData = data as SeedPayload;

    // Insert connection
    const connectionId = await ctx.db.insert("emailConnections", {
      userId,
      orgId,
      label: seedData.connection.label,
      imapHost: "imap.claritylabs.inc",
      imapPort: 993,
      email: "demo@claritylabs.inc",
      password: "demo-password",
      lastScanAt: Date.now() - 3600000,
      lastScanStatus: "success",
      emailsFound: seedData.emails.length,
      policiesExtracted: seedData.policies.length,
      isDemo: true,
    });

    // Insert emails
    const emailIds: Record<number, Id<"emails">> = {};
    for (let i = 0; i < seedData.emails.length; i++) {
      const e = seedData.emails[i];
      emailIds[i] = await ctx.db.insert("emails", {
        userId,
        orgId,
        connectionId,
        messageId: `msg-${i + 1}@demo.claritylabs.inc`,
        subject: e.subject,
        from: e.from,
        date: e.date,
        hasAttachments: e.hasAttachments,
        isInsuranceRelated: e.isInsuranceRelated,
        classificationReason: e.isInsuranceRelated
          ? "Keyword match: insurance policy"
          : "No insurance keywords found",
        classificationConfidence: e.isInsuranceRelated ? 0.95 : 0.1,
        processed: true,
        isDemo: true,
      });
    }

    // Insert policies
    for (const p of seedData.policies) {
      await ctx.db.insert("policies", {
        userId,
        orgId,
        emailId: emailIds[p.emailIdx],
        carrier: p.carrier,
        ...(p.mga ? { mga: p.mga } : {}),
        ...(p.broker ? { broker: p.broker } : {}),
        policyNumber: p.policyNumber,
        policyTypes: p.policyTypes,
        documentType: (p.documentType || "policy") as "policy" | "quote",
        policyYear: p.policyYear,
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        isRenewal: p.isRenewal,
        coverages: p.coverages,
        premium: p.premium,
        insuredName: p.insuredName,
        summary: p.summary,
        extractionStatus: "complete",
        isDemo: true,
      });
    }
  },
});

// ── Types ──
type SeedEmail = {
  subject: string;
  from: string;
  date: string;
  hasAttachments: boolean;
  isInsuranceRelated: boolean;
};

type SeedPolicy = {
  emailIdx: number;
  carrier: string;
  mga?: string;
  broker?: string;
  policyNumber: string;
  policyTypes: string[];
  documentType: string;
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  isRenewal: boolean;
  coverages: { name: string; limit: string; deductible?: string }[];
  premium: string;
  insuredName: string;
  summary: string;
};

type SeedPayload = {
  connection: { label: string };
  emails: SeedEmail[];
  policies: SeedPolicy[];
};

// ── Generate demo data with Haiku ──
async function generateWithHaiku(ctx: {
  companyName: string;
  companyContext: string;
  industry: string;
  industryVertical: string;
}): Promise<SeedPayload> {
  const client = new Anthropic();

  const prompt = `Generate realistic demo insurance data for a company. Return ONLY valid JSON, no markdown fences.

Company: ${ctx.companyName}
Industry: ${ctx.industry || "General Business"}
Vertical: ${ctx.industryVertical || "General"}
Context: ${ctx.companyContext || "A small to mid-sized business"}

Generate JSON with this exact structure:
{
  "connection": { "label": "<company name> Business Email" },
  "emails": [
    // 15 emails total: 8 insurance-related (hasAttachments: true, isInsuranceRelated: true), 7 business emails (isInsuranceRelated: false)
    // Each: { "subject": "...", "from": "Name <email@claritylabs.inc>", "date": "2025-MM-DDT10:00:00Z", "hasAttachments": bool, "isInsuranceRelated": bool }
    // ALL email addresses must use @claritylabs.inc domain
    // Business emails should be realistic for the industry (suppliers, clients, internal)
  ],
  "policies": [
    // 8 policies, each linked to an insurance email by emailIdx (0-7)
    // Use FAKE carrier names like: "Pinnacle Insurance Group", "Summit Mutual Insurance", "Ironclad Underwriters", "Vanguard Casualty Co.", "Beacon Surety Group", "Meridian National Insurance", "Atlas Risk Partners", "Sentinel Coverage Corp."
    // Each: {
    //   "emailIdx": 0-7,
    //   "carrier": "Fake Carrier Name",
    //   "broker": "Optional Fake Broker" (include on 2-3 policies),
    //   "mga": "Optional Fake MGA" (include on 1-2 policies),
    //   "policyNumber": "XX-2025-NNNNN" (realistic format),
    //   "policyTypes": ["general_liability" | "workers_comp" | "commercial_auto" | "property" | "umbrella" | "professional_liability" | "cyber" | "epli" | "directors_officers" | "non_owned_auto" | "other"],
    //   "documentType": "policy" (make the last one "quote"),
    //   "policyYear": 2025 (one can be 2024),
    //   "effectiveDate": "MM/DD/YYYY",
    //   "expirationDate": "MM/DD/YYYY" (1 year later),
    //   "isRenewal": bool (true for ~3),
    //   "coverages": [3-5 items with {"name": "...", "limit": "$X,XXX,XXX", "deductible": "$X,XXX" (optional)}],
    //   "premium": "$X,XXX",
    //   "insuredName": "${ctx.companyName}",
    //   "summary": "1-2 sentence description relevant to the industry"
    // }
    // Include policy types relevant to ${ctx.industry || "the business"}: always include GL, property, and workers comp. Choose remaining types based on industry risk profile.
  ]
}

Important:
- All contact emails must use @claritylabs.inc domain
- Use ONLY fake/fictional carrier names, never real insurance companies
- Phone numbers if needed: (647) 693-0328
- Coverage amounts should be realistic for a ${ctx.industryVertical || "small business"} in ${ctx.industry || "general business"}
- Premiums should be realistic for the industry and coverage levels`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  // Strip potential markdown fences
  const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const parsed = JSON.parse(cleaned) as SeedPayload;

  // Validate basic structure
  if (!parsed.connection || !parsed.emails || !parsed.policies) {
    throw new Error("Invalid response structure");
  }

  return parsed;
}

// ── Fallback hardcoded data ──
function getFallbackData(companyName: string): SeedPayload {
  return {
    connection: { label: `${companyName} Business Email` },
    emails: [
      { subject: "Your 2025 General Liability Policy - Renewal", from: "Pinnacle Insurance <renewals@claritylabs.inc>", date: "2025-01-15T10:30:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Workers' Compensation Policy WC-2025-44821", from: "Summit Mutual <policies@claritylabs.inc>", date: "2025-02-01T14:22:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Commercial Auto Insurance - New Policy", from: "Ironclad Underwriters <service@claritylabs.inc>", date: "2025-01-20T09:15:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Property Insurance Renewal Notice", from: "Vanguard Casualty <renewals@claritylabs.inc>", date: "2024-12-10T16:45:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Umbrella Policy - Annual Review", from: "Pinnacle Insurance <policies@claritylabs.inc>", date: "2025-03-01T11:00:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Professional Liability Coverage Update", from: "Beacon Surety <service@claritylabs.inc>", date: "2025-02-15T08:30:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Cyber Insurance Policy Documents", from: "Vanguard Casualty <cyber@claritylabs.inc>", date: "2025-01-25T13:10:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "EPLI Policy - Employment Practices", from: "Summit Mutual <epli@claritylabs.inc>", date: "2024-11-20T15:30:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Invoice #4521 - Office Supplies", from: "Supply Co <billing@claritylabs.inc>", date: "2025-02-10T09:00:00Z", hasAttachments: true, isInsuranceRelated: false },
      { subject: "Weekly Team Schedule", from: "Operations <manager@claritylabs.inc>", date: "2025-03-03T07:00:00Z", hasAttachments: false, isInsuranceRelated: false },
      { subject: "Compliance Audit Passed", from: "Regulatory Affairs <compliance@claritylabs.inc>", date: "2025-02-28T14:00:00Z", hasAttachments: true, isInsuranceRelated: false },
      { subject: "Re: Project Proposal", from: "Client Relations <clients@claritylabs.inc>", date: "2025-03-02T10:15:00Z", hasAttachments: false, isInsuranceRelated: false },
      { subject: "Monthly Financial Report", from: "Finance <reports@claritylabs.inc>", date: "2025-03-01T06:00:00Z", hasAttachments: true, isInsuranceRelated: false },
      { subject: "License Renewal Reminder", from: "Admin <notices@claritylabs.inc>", date: "2025-02-20T11:30:00Z", hasAttachments: false, isInsuranceRelated: false },
      { subject: "New Marketing Materials", from: "Marketing <marketing@claritylabs.inc>", date: "2025-03-04T16:00:00Z", hasAttachments: true, isInsuranceRelated: false },
    ],
    policies: [
      {
        emailIdx: 0, carrier: "Pinnacle Insurance Group", broker: "Meridian Risk Advisors", mga: "Atlas Risk Partners",
        policyNumber: "GL-2025-78432", policyTypes: ["general_liability"], documentType: "policy",
        policyYear: 2025, effectiveDate: "01/15/2025", expirationDate: "01/15/2026", isRenewal: true,
        coverages: [
          { name: "Each Occurrence", limit: "$1,000,000", deductible: "$2,500" },
          { name: "General Aggregate", limit: "$2,000,000" },
          { name: "Products/Completed Ops", limit: "$2,000,000" },
          { name: "Personal & Advertising Injury", limit: "$1,000,000" },
        ],
        premium: "$3,200", insuredName: companyName,
        summary: "Commercial general liability policy covering bodily injury, property damage, and personal injury claims.",
      },
      {
        emailIdx: 1, carrier: "Summit Mutual Insurance",
        policyNumber: "WC-2025-44821", policyTypes: ["workers_comp"], documentType: "policy",
        policyYear: 2025, effectiveDate: "02/01/2025", expirationDate: "02/01/2026", isRenewal: false,
        coverages: [
          { name: "Workers' Compensation", limit: "Statutory" },
          { name: "Employers' Liability - Each Accident", limit: "$500,000" },
          { name: "Employers' Liability - Disease (Each)", limit: "$500,000" },
          { name: "Employers' Liability - Disease (Policy)", limit: "$500,000" },
        ],
        premium: "$4,800", insuredName: companyName,
        summary: "Workers' compensation coverage for all employees.",
      },
      {
        emailIdx: 2, carrier: "Ironclad Underwriters",
        policyNumber: "CA-2025-31094", policyTypes: ["commercial_auto"], documentType: "policy",
        policyYear: 2025, effectiveDate: "01/20/2025", expirationDate: "01/20/2026", isRenewal: false,
        coverages: [
          { name: "Combined Single Limit", limit: "$1,000,000" },
          { name: "Uninsured/Underinsured Motorist", limit: "$1,000,000" },
          { name: "Medical Payments", limit: "$5,000" },
          { name: "Comprehensive", limit: "ACV", deductible: "$500" },
        ],
        premium: "$2,400", insuredName: companyName,
        summary: "Commercial auto policy covering company vehicles.",
      },
      {
        emailIdx: 3, carrier: "Vanguard Casualty Co.", broker: "Sentinel Brokers",
        policyNumber: "CP-2024-67293", policyTypes: ["property"], documentType: "policy",
        policyYear: 2024, effectiveDate: "12/10/2024", expirationDate: "12/10/2025", isRenewal: true,
        coverages: [
          { name: "Building", limit: "$850,000", deductible: "$5,000" },
          { name: "Business Personal Property", limit: "$250,000", deductible: "$2,500" },
          { name: "Business Income", limit: "$150,000" },
          { name: "Equipment Breakdown", limit: "$100,000", deductible: "$1,000" },
        ],
        premium: "$4,100", insuredName: companyName,
        summary: "Commercial property insurance covering the business premises, equipment, and business income loss.",
      },
      {
        emailIdx: 4, carrier: "Pinnacle Insurance Group",
        policyNumber: "UMB-2025-12850", policyTypes: ["umbrella"], documentType: "policy",
        policyYear: 2025, effectiveDate: "03/01/2025", expirationDate: "03/01/2026", isRenewal: false,
        coverages: [
          { name: "Each Occurrence", limit: "$2,000,000" },
          { name: "Aggregate", limit: "$2,000,000" },
        ],
        premium: "$1,500", insuredName: companyName,
        summary: "Commercial umbrella providing excess liability coverage above GL, auto, and employers' liability.",
      },
      {
        emailIdx: 5, carrier: "Beacon Surety Group",
        policyNumber: "PL-2025-90127", policyTypes: ["professional_liability"], documentType: "policy",
        policyYear: 2025, effectiveDate: "02/15/2025", expirationDate: "02/15/2026", isRenewal: false,
        coverages: [
          { name: "Each Claim", limit: "$500,000", deductible: "$5,000" },
          { name: "Aggregate", limit: "$1,000,000" },
        ],
        premium: "$950", insuredName: companyName,
        summary: "Professional liability/E&O coverage for professional services and consulting.",
      },
      {
        emailIdx: 6, carrier: "Vanguard Casualty Co.",
        policyNumber: "CY-2025-55310", policyTypes: ["cyber"], documentType: "policy",
        policyYear: 2025, effectiveDate: "01/25/2025", expirationDate: "01/25/2026", isRenewal: false,
        coverages: [
          { name: "Network Security Liability", limit: "$500,000", deductible: "$10,000" },
          { name: "Privacy Liability", limit: "$500,000" },
          { name: "Data Breach Response", limit: "$250,000" },
          { name: "Business Interruption", limit: "$100,000" },
        ],
        premium: "$1,250", insuredName: companyName,
        summary: "Cyber liability covering data breaches, network security, and digital business interruption.",
      },
      {
        emailIdx: 7, carrier: "Summit Mutual Insurance",
        policyNumber: "EPLI-2024-88214", policyTypes: ["epli"], documentType: "quote",
        policyYear: 2024, effectiveDate: "11/20/2024", expirationDate: "11/20/2025", isRenewal: true,
        coverages: [
          { name: "Each Employment Claim", limit: "$250,000", deductible: "$15,000" },
          { name: "Aggregate", limit: "$500,000" },
          { name: "Third-Party Coverage", limit: "$250,000" },
        ],
        premium: "$1,800", insuredName: companyName,
        summary: "Employment practices liability covering wrongful termination, discrimination, harassment, and wage/hour claims.",
      },
    ],
  };
}
