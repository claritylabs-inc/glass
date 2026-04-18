import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";
import { getAuthUserId } from "@convex-dev/auth/server";
import { generateText } from "ai";
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

    return `Seeded successfully: 1 connection, ${seedData.emails.length} emails, ${seedData.policies.length} policies, ${seedData.quotes.length} quotes`;
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
    const access = await getOrgAccess(ctx);
    if (!access) return false;
    const { orgId } = access;
    const policy = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("isDemo"), true))
      .first();
    if (policy) return true;
    const quote = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.and(q.eq(q.field("isDemo"), true), q.eq(q.field("documentType"), "quote")))
      .first();
    return !!quote;
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
        documentType: "policy",
        policyYear: p.policyYear,
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        isRenewal: p.isRenewal,
        coverages: p.coverages,
        premium: p.premium,
        insuredName: p.insuredName,
        summary: p.summary,
        ...(p.document ? { document: p.document } : {}),
        ...(p.metadataSource ? { metadataSource: p.metadataSource } : {}),
        extractionStatus: "complete",
        isDemo: true,
      });
    }

    // Insert quotes (stored in policies table with documentType: "quote")
    for (const q of seedData.quotes) {
      // Map quote coverages to policy coverage format (proposedLimit -> limit)
      const mappedCoverages = q.coverages.map((c) => ({
        name: c.name,
        limit: c.proposedLimit,
        deductible: c.proposedDeductible,
      }));
      await ctx.db.insert("policies", {
        userId,
        orgId,
        emailId: emailIds[q.emailIdx],
        carrier: q.carrier,
        ...(q.mga ? { mga: q.mga } : {}),
        ...(q.broker ? { broker: q.broker } : {}),
        policyNumber: q.quoteNumber,
        quoteNumber: q.quoteNumber,
        policyTypes: q.policyTypes,
        documentType: "quote",
        policyYear: q.quoteYear,
        quoteYear: q.quoteYear,
        effectiveDate: q.proposedEffectiveDate ?? "Unknown",
        expirationDate: q.proposedExpirationDate ?? "Unknown",
        proposedEffectiveDate: q.proposedEffectiveDate,
        proposedExpirationDate: q.proposedExpirationDate,
        quoteExpirationDate: q.quoteExpirationDate,
        isRenewal: q.isRenewal,
        coverages: mappedCoverages,
        premium: q.premium,
        insuredName: q.insuredName,
        summary: q.summary,
        premiumBreakdown: q.premiumBreakdown,
        subjectivities: q.subjectivities,
        ...(q.document ? { document: q.document } : {}),
        ...(q.metadataSource ? { metadataSource: q.metadataSource } : {}),
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

type DocumentSection = {
  title: string;
  sectionNumber?: string;
  pageStart: number;
  pageEnd?: number;
  type: string;
  coverageType?: string;
  content: string;
  subsections?: { title: string; sectionNumber?: string; pageNumber?: number; content: string }[];
};

type SeedPolicy = {
  emailIdx: number;
  carrier: string;
  mga?: string;
  broker?: string;
  policyNumber: string;
  policyTypes: string[];
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  isRenewal: boolean;
  coverages: { name: string; limit: string; deductible?: string }[];
  premium: string;
  insuredName: string;
  summary: string;
  document?: { sections: DocumentSection[] };
  metadataSource?: {
    carrierPage?: number;
    policyNumberPage?: number;
    premiumPage?: number;
    effectiveDatePage?: number;
  };
};

type SeedQuote = {
  emailIdx: number;
  carrier: string;
  mga?: string;
  broker?: string;
  quoteNumber: string;
  policyTypes: string[];
  quoteYear: number;
  proposedEffectiveDate: string;
  proposedExpirationDate: string;
  quoteExpirationDate: string;
  isRenewal: boolean;
  coverages: { name: string; proposedLimit: string; proposedDeductible?: string }[];
  premium: string;
  insuredName: string;
  summary: string;
  premiumBreakdown?: { line: string; amount: string }[];
  subjectivities?: { description: string; category?: string }[];
  document?: { sections: DocumentSection[] };
  metadataSource?: {
    carrierPage?: number;
    quoteNumberPage?: number;
    premiumPage?: number;
    effectiveDatePage?: number;
  };
};

type SeedPayload = {
  connection: { label: string };
  emails: SeedEmail[];
  policies: SeedPolicy[];
  quotes: SeedQuote[];
};

// ── Generate demo data with Haiku ──
async function generateWithHaiku(ctx: {
  companyName: string;
  companyContext: string;
  industry: string;
  industryVertical: string;
}): Promise<SeedPayload> {
  const prompt = `Generate realistic demo insurance data for a company. Return ONLY valid JSON, no markdown fences.

Company: ${ctx.companyName}
Industry: ${ctx.industry || "General Business"}
Vertical: ${ctx.industryVertical || "General"}
Context: ${ctx.companyContext || "A small to mid-sized business"}
Today's date: 2026-03-10

Generate JSON with this exact structure:
{
  "connection": { "label": "<company name> Business Email" },
  "emails": [
    // 8 emails total: 6 insurance-related (hasAttachments: true, isInsuranceRelated: true), 2 business emails (isInsuranceRelated: false)
    // Each: { "subject": "...", "from": "Name <email@claritylabs.inc>", "date": "2025-MM-DDT10:00:00Z" or "2026-MM-DDT10:00:00Z", "hasAttachments": bool, "isInsuranceRelated": bool }
    // Insurance emails 0-3 are for policies, emails 4-5 are for quote proposals
    // ALL email addresses must use @claritylabs.inc domain
  ],
  "policies": [
    // 4 policies, each linked to an insurance email by emailIdx (0-3)
    // Policy 0: General Liability (CGL), Pinnacle Insurance Group, GL-2025-78432, 04/10/2025-04/10/2026, EXPIRING (31d)
    // Policy 1: Commercial Property, Vanguard Casualty Co., CP-2025-67293, 05/05/2025-05/05/2026, EXPIRING (56d)
    // Policy 2: Umbrella/Excess, Pinnacle Insurance Group, UMB-2026-12850, 03/01/2026-03/01/2027
    // Policy 3: Cyber Liability, Vanguard Casualty Co., CY-2026-55310, 01/25/2026-01/25/2027
    // Use ONLY fake carrier names. Include broker on GL and Property.
    // Each: {
    //   "emailIdx": 0-3,
    //   "carrier": "...", "broker": "optional", "mga": "optional",
    //   "policyNumber": "...", "policyTypes": ["..."],
    //   "policyYear": 2025|2026, "effectiveDate": "MM/DD/YYYY", "expirationDate": "MM/DD/YYYY",
    //   "isRenewal": bool,
    //   "coverages": [3-6 items with {"name": "...", "limit": "$X,XXX,XXX", "deductible": "$X,XXX" (optional)}],
    //   "premium": "$X,XXX", "insuredName": "${ctx.companyName}",
    //   "summary": "1-2 sentence description"
    // }
    // GL coverages: Each Occurrence $1M (ded $2,500), General Aggregate $2M, Products/Completed Ops $2M, Personal & Advertising Injury $1M, Tenants' Legal Liability $100K, Medical Expense $10K
    // Property coverages: Building $850K (ded $5K), BPP $250K (ded $2.5K), Business Income $150K, Equipment Breakdown $100K (ded $1K)
    // Umbrella: Each Occurrence $2M, Aggregate $2M
    // Cyber: Network Security $500K (ded $10K), Privacy $500K, Data Breach $250K, BI $100K
  ],
  "quotes": [
    // 2 renewal quotes for the 2 expiring policies
    // Quote 0: GL Renewal from Pinnacle, Q-2026-78432, proposed 04/10/2026-04/10/2027, quote expires 03/28/2026
    // Quote 1: Property Renewal from Vanguard, Q-2026-67293, proposed 05/05/2026-05/05/2027, quote expires 04/05/2026
    // Each: {
    //   "emailIdx": 4|5,
    //   "carrier": "same as expiring policy", "broker": "same if policy had one",
    //   "quoteNumber": "Q-YYYY-NNNNN", "policyTypes": ["same as policy"],
    //   "quoteYear": 2026,
    //   "proposedEffectiveDate": "MM/DD/YYYY", "proposedExpirationDate": "MM/DD/YYYY",
    //   "quoteExpirationDate": "MM/DD/YYYY",
    //   "isRenewal": true,
    //   "coverages": [items with {"name": "...", "proposedLimit": "$X,XXX,XXX", "proposedDeductible": "$X,XXX" (optional)}],
    //   "premium": "$X,XXX (slightly different from policy)",
    //   "insuredName": "${ctx.companyName}",
    //   "summary": "Renewal quote for [type]. [Note changes].",
    //   "premiumBreakdown": [{"line": "...", "amount": "$X,XXX"}, ...],
    //   "subjectivities": [{"description": "...", "category": "pre_binding"|"information"}, ...]
    // }
  ]
}

Important:
- All contact emails must use @claritylabs.inc domain
- Use ONLY fake/fictional carrier names, never real insurance companies
- Coverage amounts should be realistic for a ${ctx.industryVertical || "small business"} in ${ctx.industry || "general business"}
- Do NOT include document sections — only metadata and coverages
- The relationship between expiring policies and renewal quotes is critical — make it logical`;

  const { text } = await generateText({
    model: "anthropic/claude-haiku-4.5",
    maxTokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  // Strip potential markdown fences
  const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const parsed = JSON.parse(cleaned) as SeedPayload;

  // Validate basic structure
  if (!parsed.connection || !parsed.emails || !parsed.policies || !parsed.quotes) {
    throw new Error("Invalid response structure");
  }

  // Ensure quotes have correct field names (coverages use proposedLimit)
  for (const q of parsed.quotes) {
    q.coverages = q.coverages.map((c) => ({
      name: c.name,
      proposedLimit: c.proposedLimit || "TBD",
      ...(c.proposedDeductible ? { proposedDeductible: c.proposedDeductible } : {}),
    }));
  }

  // Enrich with document sections from fallback (Haiku can't generate these well)
  const fallback = getFallbackData(parsed.policies[0]?.insuredName || "Demo Company");
  for (let i = 0; i < parsed.policies.length && i < fallback.policies.length; i++) {
    parsed.policies[i].document = fallback.policies[i].document;
    parsed.policies[i].metadataSource = fallback.policies[i].metadataSource;
  }
  for (let i = 0; i < parsed.quotes.length && i < fallback.quotes.length; i++) {
    parsed.quotes[i].document = fallback.quotes[i].document;
    parsed.quotes[i].metadataSource = fallback.quotes[i].metadataSource;
  }

  return parsed;
}

// ── Fallback hardcoded data ──
function getFallbackData(companyName: string): SeedPayload {
  return {
    connection: { label: `${companyName} Business Email` },
    emails: [
      // Policy emails (0-3)
      { subject: "Your 2025 General Liability Policy - Renewal", from: "Pinnacle Insurance <renewals@claritylabs.inc>", date: "2025-04-10T10:30:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Property Insurance Renewal Notice", from: "Vanguard Casualty <renewals@claritylabs.inc>", date: "2025-05-05T16:45:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Umbrella Policy - Annual Review", from: "Pinnacle Insurance <policies@claritylabs.inc>", date: "2026-03-01T11:00:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Cyber Insurance Policy Documents", from: "Vanguard Casualty <cyber@claritylabs.inc>", date: "2026-01-25T13:10:00Z", hasAttachments: true, isInsuranceRelated: true },
      // Quote emails (4-5)
      { subject: "Renewal Quote - General Liability 2026", from: "Pinnacle Insurance <quotes@claritylabs.inc>", date: "2026-02-20T09:00:00Z", hasAttachments: true, isInsuranceRelated: true },
      { subject: "Property Insurance Renewal Proposal", from: "Vanguard Casualty <quotes@claritylabs.inc>", date: "2026-03-01T11:00:00Z", hasAttachments: true, isInsuranceRelated: true },
      // Business emails (6-7)
      { subject: "Invoice #4521 - Office Supplies", from: "Supply Co <billing@claritylabs.inc>", date: "2025-02-10T09:00:00Z", hasAttachments: true, isInsuranceRelated: false },
      { subject: "Weekly Team Schedule", from: "Operations <manager@claritylabs.inc>", date: "2025-03-03T07:00:00Z", hasAttachments: false, isInsuranceRelated: false },
    ],
    policies: [
      // ────────────────────────────────────────────────────
      // Policy 1: General Liability (CGL) — EXPIRING in 31d
      // ────────────────────────────────────────────────────
      {
        emailIdx: 0,
        carrier: "Pinnacle Insurance Group",
        broker: "Meridian Risk Advisors",
        mga: "Atlas Risk Partners",
        policyNumber: "GL-2025-78432",
        policyTypes: ["general_liability"],
        policyYear: 2025,
        effectiveDate: "04/10/2025",
        expirationDate: "04/10/2026",
        isRenewal: true,
        coverages: [
          { name: "Each Occurrence", limit: "$1,000,000", deductible: "$2,500" },
          { name: "General Aggregate", limit: "$2,000,000" },
          { name: "Products/Completed Operations Aggregate", limit: "$2,000,000" },
          { name: "Personal & Advertising Injury", limit: "$1,000,000" },
          { name: "Damage to Premises Rented to You (Tenants' Legal Liability)", limit: "$100,000" },
          { name: "Medical Expense (Any One Person)", limit: "$10,000" },
        ],
        premium: "$3,200",
        insuredName: companyName,
        summary: "Commercial general liability policy covering bodily injury, property damage, and personal & advertising injury claims. Occurrence form with products-completed operations coverage.",
        metadataSource: {
          carrierPage: 1,
          policyNumberPage: 1,
          premiumPage: 1,
          effectiveDatePage: 1,
        },
        document: {
          sections: [
            {
              title: "Declarations",
              sectionNumber: "DEC",
              pageStart: 1,
              pageEnd: 2,
              type: "declarations",
              coverageType: "general_liability",
              content: `COMMERCIAL GENERAL LIABILITY DECLARATIONS

Named Insured: ${companyName}
Policy Number: GL-2025-78432
Policy Period: 04/10/2025 to 04/10/2026, 12:01 A.M. Standard Time

LIMITS OF INSURANCE
Each Occurrence Limit: $1,000,000
Damage to Premises Rented to You Limit: $100,000 (Any One Premises)
Medical Expense Limit: $10,000 (Any One Person)
Personal & Advertising Injury Limit: $1,000,000
General Aggregate Limit: $2,000,000
Products-Completed Operations Aggregate Limit: $2,000,000

RETROACTIVE DATE (CG 00 02 ONLY): N/A — This is an Occurrence Form

All Premises You Own, Rent or Occupy: 123 Commerce Drive, Suite 200, Springfield, IL 62701

Classification Code / Premium Base / Rate / Advance Premium:
  41677 — Consultants / $850,000 Gross Sales / $0.376 per $100 / $3,200

Business Description: Professional consulting and technology services.

Forms and Endorsements Attached:
CG 00 01 04 13 — Commercial General Liability Coverage Form
CG 21 47 12 07 — Employment-Related Practices Exclusion
CG 24 04 05 09 — Waiver of Transfer of Rights of Recovery
IL 00 21 09 08 — Nuclear Energy Liability Exclusion`,
            },
            {
              title: "Coverage A — Bodily Injury and Property Damage Liability",
              sectionNumber: "I.A",
              pageStart: 3,
              pageEnd: 4,
              type: "insuring_agreement",
              coverageType: "general_liability",
              content: `SECTION I — COVERAGES

COVERAGE A — BODILY INJURY AND PROPERTY DAMAGE LIABILITY

1. Insuring Agreement

a. We will pay those sums that the insured becomes legally obligated to pay as damages because of "bodily injury" or "property damage" to which this insurance applies. We will have the right and duty to defend the insured against any "suit" seeking those damages. However, we will have no duty to defend the insured against any "suit" seeking damages for "bodily injury" or "property damage" to which this insurance does not apply. We may, at our discretion, investigate any "occurrence" and settle any claim or "suit" that may result.

b. This insurance applies to "bodily injury" and "property damage" only if:
   (1) The "bodily injury" or "property damage" is caused by an "occurrence" that takes place in the "coverage territory";
   (2) The "bodily injury" or "property damage" occurs during the policy period; and
   (3) Prior to the policy period, no insured listed under Paragraph 1. of Section II — Who Is An Insured and no "employee" authorized by you to give or receive notice of an "occurrence" or claim, knew that the "bodily injury" or "property damage" had occurred, in whole or in part.

c. "Bodily injury" or "property damage" which occurs during the policy period and was not, prior to the policy period, known to have occurred by any insured listed under Paragraph 1. of Section II — Who Is An Insured or any "employee" authorized by you to give or receive notice of an "occurrence" or claim, includes any continuation, change or resumption of that "bodily injury" or "property damage" after the end of the policy period.

d. "Bodily injury" or "property damage" will be deemed to have been known to have occurred at the earliest time when any insured listed under Paragraph 1. of Section II — Who Is An Insured or any "employee" authorized by you to give or receive notice of an "occurrence" or claim:
   (1) Reports all, or any part, of the "bodily injury" or "property damage" to us or any other insurer;
   (2) Receives a written or verbal demand or claim for damages because of the "bodily injury" or "property damage"; or
   (3) Becomes aware by any other means that "bodily injury" or "property damage" has occurred or has begun to occur.

e. Damages because of "bodily injury" include damages claimed by any person or organization for care, loss of services or death resulting at any time from the "bodily injury".`,
              subsections: [
                {
                  title: "Duty to Defend",
                  pageNumber: 3,
                  content: "We will have the right and duty to defend the insured against any \"suit\" seeking damages for \"bodily injury\" or \"property damage\" to which this insurance applies. We may, at our discretion, investigate any \"occurrence\" and settle any claim or \"suit\" that may result. Our right and duty to defend ends when we have used up the applicable limit of insurance in the payment of judgments or settlements.",
                },
              ],
            },
            {
              title: "Coverage B — Personal and Advertising Injury Liability",
              sectionNumber: "I.B",
              pageStart: 5,
              pageEnd: 5,
              type: "insuring_agreement",
              coverageType: "general_liability",
              content: `COVERAGE B — PERSONAL AND ADVERTISING INJURY LIABILITY

1. Insuring Agreement

a. We will pay those sums that the insured becomes legally obligated to pay as damages because of "personal and advertising injury" to which this insurance applies. We will have the right and duty to defend the insured against any "suit" seeking those damages. However, we will have no duty to defend the insured against any "suit" seeking damages for "personal and advertising injury" to which this insurance does not apply. We may, at our discretion, investigate any "occurrence" and settle any claim or "suit" that may result.

b. This insurance applies to "personal and advertising injury" caused by an offense arising out of your business but only if the offense was committed in the "coverage territory" during the policy period.

c. "Personal and advertising injury" means injury, including consequential "bodily injury", arising out of one or more of the following offenses:
   (1) False arrest, detention or imprisonment;
   (2) Malicious prosecution;
   (3) The wrongful eviction from, wrongful entry into, or invasion of the right of private occupancy of a room, dwelling or premises that a person occupies, committed by or on behalf of its owner, landlord or lessor;
   (4) Oral or written publication, in any manner, of material that slanders or libels a person or organization or disparages a person's or organization's goods, products or services;
   (5) Oral or written publication, in any manner, of material that violates a person's right of privacy;
   (6) The use of another's advertising idea in your "advertisement"; or
   (7) Infringing upon another's copyright, trade dress or slogan in your "advertisement".`,
            },
            {
              title: "Exclusions",
              sectionNumber: "I.A.2",
              pageStart: 6,
              pageEnd: 9,
              type: "exclusion",
              coverageType: "general_liability",
              content: `2. Exclusions

This insurance does not apply to:

a. Expected Or Intended Injury
"Bodily injury" or "property damage" expected or intended from the standpoint of the insured. This exclusion does not apply to "bodily injury" resulting from the use of reasonable force to protect persons or property.

b. Contractual Liability
"Bodily injury" or "property damage" for which the insured is obligated to pay damages by reason of the assumption of liability in a contract or agreement. This exclusion does not apply to liability for damages assumed in a contract or agreement that is an "insured contract", provided the "bodily injury" or "property damage" occurs subsequent to the execution of the contract or agreement.

c. Liquor Liability
"Bodily injury" or "property damage" for which any insured may be held liable by reason of causing or contributing to the intoxication of any person, furnishing of alcoholic beverages to a person under the legal drinking age or under the influence of alcohol, or any statute, ordinance or regulation relating to the sale, gift, distribution or use of alcoholic beverages.

d. Workers' Compensation And Similar Laws
Any obligation of the insured under a workers' compensation, disability benefits or unemployment compensation law or any similar law.

e. Employer's Liability
"Bodily injury" to an "employee" of the insured arising out of and in the course of employment by the insured or performing duties related to the conduct of the insured's business.

f. Pollution
(1) "Bodily injury" or "property damage" arising out of the actual, alleged or threatened discharge, dispersal, seepage, migration, release or escape of "pollutants" at or from any premises, site or location which is or was at any time owned or occupied by, or rented or loaned to, any insured.
(2) Any loss, cost or expense arising out of any request, demand, order or statutory or regulatory requirement that any insured or others test for, monitor, clean up, remove, contain, treat, detoxify or neutralize, or in any way respond to, or assess the effects of, "pollutants".

g. Aircraft, Auto Or Watercraft
"Bodily injury" or "property damage" arising out of the ownership, maintenance, use or entrustment to others of any aircraft, "auto" or watercraft owned or operated by or rented or loaned to any insured.

h. War
"Bodily injury" or "property damage", however caused, arising, directly or indirectly, out of war, including undeclared or civil war, or any act or condition incident to war.`,
              subsections: [
                {
                  title: "Asbestos Exclusion",
                  pageNumber: 8,
                  content: "This insurance does not apply to \"bodily injury\" or \"property damage\" arising out of the actual, alleged, or threatened presence of, or exposure to, asbestos or asbestos-containing materials in any form, including but not limited to asbestos fibers, dust, or products.",
                },
                {
                  title: "Nuclear Energy Exclusion (IL 00 21)",
                  pageNumber: 9,
                  content: "This policy does not apply to \"bodily injury\" or \"property damage\" with respect to which an insured under this policy is also an insured under a nuclear energy liability policy issued by Nuclear Energy Liability Insurance Association, Mutual Atomic Energy Liability Underwriters, or Nuclear Insurance Association of Canada.",
                },
              ],
            },
            {
              title: "Conditions",
              sectionNumber: "IV",
              pageStart: 10,
              pageEnd: 12,
              type: "condition",
              coverageType: "general_liability",
              content: `SECTION IV — COMMERCIAL GENERAL LIABILITY CONDITIONS

1. Bankruptcy
Bankruptcy or insolvency of the insured or of the insured's estate will not relieve us of our obligations under this Coverage Part.

2. Duties In The Event Of Occurrence, Offense, Claim Or Suit
a. You must see to it that we are notified as soon as practicable of an "occurrence" or an offense which may result in a claim. To the extent possible, notice should include:
   (1) How, when and where the "occurrence" or offense took place;
   (2) The names and addresses of any injured persons and witnesses; and
   (3) The nature and location of any injury or damage arising out of the "occurrence" or offense.

b. If a claim is made or "suit" is brought against any insured, you must:
   (1) Immediately record the specifics of the claim or "suit" and the date received; and
   (2) Notify us as soon as practicable.

3. Legal Action Against Us
No person or organization has a right under this Coverage Part to join us as a party or otherwise bring us into a "suit" asking for damages from an insured, or to sue us on this Coverage Part unless all of its terms have been fully complied with.

4. Other Insurance
If other valid and collectible insurance is available to the insured for a loss we cover under Coverages A or B of this Coverage Part, our obligations are limited as follows:
   a. Primary Insurance — This insurance is primary except when Paragraph b. below applies.
   b. Excess Insurance — This insurance is excess over any of the other insurance, whether primary, excess, contingent or on any other basis.

5. Premium Audit
a. We will compute all premiums for this Coverage Part in accordance with our rules and rates.
b. Premium shown in this Coverage Part as advance premium is a deposit premium only. At the close of each audit period we will compute the earned premium for that period and send notice to the first Named Insured.

6. Representations
By accepting this policy, you agree that the statements in the Declarations are accurate and complete.

7. Separation Of Insureds
Except with respect to the Limits of Insurance, and any rights or duties specifically assigned in this Coverage Part to the first Named Insured, this insurance applies as if each Named Insured were the only Named Insured, and separately to each insured against whom claim is made or "suit" is brought.

8. Transfer Of Rights Of Recovery Against Others To Us
If the insured has rights to recover all or part of any payment we have made under this Coverage Part, those rights are transferred to us.

9. When We Do Not Renew
If we decide not to renew this Coverage Part, we will mail or deliver to the first Named Insured shown in the Declarations written notice of the nonrenewal not less than 30 days before the expiration date.`,
            },
            {
              title: "Definitions",
              sectionNumber: "V",
              pageStart: 13,
              pageEnd: 15,
              type: "definition",
              coverageType: "general_liability",
              content: `SECTION V — DEFINITIONS

1. "Advertisement" means a notice that is broadcast or published to the general public or specific market segments about your goods, products or services for the purpose of attracting customers or supporters.

2. "Auto" means a land motor vehicle, trailer or semitrailer designed for travel on public roads, including any attached machinery or equipment.

3. "Bodily injury" means bodily injury, sickness or disease sustained by a person, including death resulting from any of these at any time.

4. "Coverage territory" means:
   a. The United States of America (including its territories and possessions), Puerto Rico and Canada;
   b. International waters or airspace, but only if the injury or damage occurs in the course of travel or transportation between any places included in Paragraph a. above; or
   c. All other parts of the world if the injury or damage arises out of goods or products made or sold by you in the territory described in Paragraph a. above.

5. "Impaired property" means tangible property, other than "your product" or "your work", that cannot be used or is less useful because it incorporates "your product" or "your work" that is known or thought to be defective, deficient, inadequate or dangerous.

6. "Insured contract" means:
   a. A contract for a lease of premises;
   b. A sidetrack agreement;
   c. Any easement or license agreement;
   d. An obligation, as required by ordinance, to indemnify a municipality;
   e. An elevator maintenance agreement; or
   f. That part of any other contract or agreement pertaining to your business under which you assume the tort liability of another party.

7. "Occurrence" means an accident, including continuous or repeated exposure to substantially the same general harmful conditions.

8. "Products-completed operations hazard" includes all "bodily injury" and "property damage" occurring away from premises you own or rent and arising out of "your product" or "your work".

9. "Property damage" means:
   a. Physical injury to tangible property, including all resulting loss of use of that property; or
   b. Loss of use of tangible property that is not physically injured.

10. "Suit" means a civil proceeding in which damages because of "bodily injury", "property damage" or "personal and advertising injury" to which this insurance applies are alleged.`,
            },
            {
              title: "Endorsement — Employment-Related Practices Exclusion (CG 21 47)",
              sectionNumber: "END-1",
              pageStart: 16,
              pageEnd: 16,
              type: "endorsement",
              coverageType: "general_liability",
              content: `EMPLOYMENT-RELATED PRACTICES EXCLUSION
CG 21 47 12 07

This endorsement modifies insurance provided under:
COMMERCIAL GENERAL LIABILITY COVERAGE PART

The following exclusion is added to Paragraph 2., Exclusions of Section I — Coverage A — Bodily Injury And Property Damage Liability; and to Paragraph 2., Exclusions of Section I — Coverage B — Personal And Advertising Injury Liability:

This insurance does not apply to:
"Bodily injury" or "personal and advertising injury" to:
a. A person arising out of any:
   (1) Refusal to employ that person;
   (2) Termination of that person's employment; or
   (3) Employment-related practices, policies, acts or omissions, such as coercion, demotion, evaluation, reassignment, discipline, defamation, harassment, humiliation, discrimination or malicious prosecution directed at that person; or
b. The spouse, child, parent, brother or sister of that person as a consequence of "bodily injury" or "personal and advertising injury" to that person at whom any of the employment-related practices described in Paragraphs (1), (2), or (3) above is directed.

This exclusion applies whether the injury-causing event described in Paragraphs a. and b. above occurs before employment, during employment or after employment of that person.`,
            },
          ],
        },
      },

      // ────────────────────────────────────────────────────
      // Policy 2: Commercial Property — EXPIRING in 56d
      // ────────────────────────────────────────────────────
      {
        emailIdx: 1,
        carrier: "Vanguard Casualty Co.",
        broker: "Sentinel Brokers",
        policyNumber: "CP-2025-67293",
        policyTypes: ["property"],
        policyYear: 2025,
        effectiveDate: "05/05/2025",
        expirationDate: "05/05/2026",
        isRenewal: true,
        coverages: [
          { name: "Building", limit: "$850,000", deductible: "$5,000" },
          { name: "Business Personal Property", limit: "$250,000", deductible: "$2,500" },
          { name: "Business Income with Extra Expense", limit: "$150,000" },
          { name: "Equipment Breakdown", limit: "$100,000", deductible: "$1,000" },
        ],
        premium: "$4,100",
        insuredName: companyName,
        summary: "Commercial property insurance covering the business premises at 123 Commerce Drive, business equipment, and income loss from covered perils.",
        metadataSource: {
          carrierPage: 1,
          policyNumberPage: 1,
          premiumPage: 2,
          effectiveDatePage: 1,
        },
        document: {
          sections: [
            {
              title: "Declarations",
              sectionNumber: "DEC",
              pageStart: 1,
              pageEnd: 2,
              type: "declarations",
              coverageType: "property",
              content: `COMMERCIAL PROPERTY DECLARATIONS

Named Insured: ${companyName}
Policy Number: CP-2025-67293
Policy Period: 05/05/2025 to 05/05/2026, 12:01 A.M. Standard Time

COVERED PROPERTY AND LIMITS OF INSURANCE
Premises: 123 Commerce Drive, Suite 200, Springfield, IL 62701

Coverage                                    Limit           Deductible
Building                                    $850,000        $5,000
Business Personal Property                  $250,000        $2,500
Business Income with Extra Expense          $150,000        72 Hours
Equipment Breakdown                         $100,000        $1,000

Covered Causes of Loss: Special Form (CP 10 30)
Coinsurance: 80%
Valuation: Replacement Cost

Annual Premium: $4,100

Forms and Endorsements Attached:
CP 00 10 10 12 — Building and Personal Property Coverage Form
CP 10 30 10 12 — Causes of Loss — Special Form
CP 00 30 10 12 — Business Income Coverage Form
CP 04 05 10 12 — Equipment Breakdown`,
            },
            {
              title: "Building and Personal Property Coverage",
              sectionNumber: "A",
              pageStart: 3,
              pageEnd: 5,
              type: "insuring_agreement",
              coverageType: "property",
              content: `BUILDING AND PERSONAL PROPERTY COVERAGE FORM (CP 00 10)

A. Coverage
We will pay for direct physical loss of or damage to Covered Property at the premises described in the Declarations caused by or resulting from any Covered Cause of Loss.

1. Covered Property
   a. Building — The building or structure described in the Declarations, including:
      (1) Completed additions;
      (2) Fixtures, including outdoor fixtures;
      (3) Permanently installed machinery and equipment;
      (4) Your personal property in apartments, rooms or common areas furnished by you as landlord.

   b. Business Personal Property — Personal property owned by you that is located in or on the building or in the open within 100 feet of the described premises, including:
      (1) Furniture and fixtures;
      (2) Machinery and equipment;
      (3) "Stock";
      (4) All other personal property owned by you and used in your business;
      (5) Improvements and betterments.

2. Property Not Covered
   a. Accounts, bills, currency, food stamps or other evidences of debt;
   b. Animals, unless owned by others and boarded by you;
   c. Automobiles held for sale;
   d. Contraband, or property in the course of illegal transportation;
   e. The cost of excavations, grading, backfilling or filling;
   f. Land (including land on which the property is located), water, growing crops or lawns.`,
            },
            {
              title: "Causes of Loss — Special Form Exclusions",
              sectionNumber: "B",
              pageStart: 6,
              pageEnd: 8,
              type: "exclusion",
              coverageType: "property",
              content: `CAUSES OF LOSS — SPECIAL FORM (CP 10 30)

A. Covered Causes Of Loss
When Special is shown in the Declarations, Covered Causes of Loss means direct physical loss unless the loss is excluded or limited in this policy.

B. Exclusions
1. We will not pay for loss or damage caused directly or indirectly by any of the following. Such loss or damage is excluded regardless of any other cause or event that contributes concurrently or in any sequence to the loss.
   a. Ordinance Or Law
   b. Earth Movement (earthquake, landslide, mine subsidence, etc.)
   c. Governmental Action
   d. Nuclear Hazard
   e. Utility Services — failure of power, communication, water or other utility
   f. War And Military Action
   g. Water — flood, surface water, waves, tidal water, overflow of any body of water

2. We will not pay for loss or damage caused by or resulting from any of the following:
   a. Artificially generated electrical, magnetic or electromagnetic energy
   b. Delay, loss of use or loss of market
   c. Smoke, vapor or gas from agricultural smudging or industrial operations
   d. Wear and tear, rust, corrosion, fungus, decay, deterioration
   e. Mechanical breakdown
   f. Settling, cracking, shrinking or expansion
   g. Insects, birds, rodents or other animals
   h. Neglect — neglect of an insured to use all reasonable means to save and preserve property
   i. Pollution`,
            },
            {
              title: "Business Income Coverage",
              sectionNumber: "C",
              pageStart: 9,
              pageEnd: 10,
              type: "insuring_agreement",
              coverageType: "property",
              content: `BUSINESS INCOME (AND EXTRA EXPENSE) COVERAGE FORM (CP 00 30)

A. Coverage
1. Business Income
   We will pay for the actual loss of Business Income you sustain due to the necessary "suspension" of your "operations" during the "period of restoration". The "suspension" must be caused by direct physical loss of or damage to property at premises which are described in the Declarations and for which a Business Income Limit Of Insurance is shown in the Declarations.

   Business Income means the:
   a. Net Income (Net Profit or Loss before income taxes) that would have been earned or incurred; and
   b. Continuing normal operating expenses incurred, including payroll.

2. Extra Expense
   Extra Expense means necessary expenses you incur during the "period of restoration" that you would not have incurred if there had been no direct physical loss or damage to property caused by or resulting from a Covered Cause of Loss.

   We will pay Extra Expense (other than the expense to repair or replace property) to:
   a. Avoid or minimize the "suspension" of business and to continue "operations" at the described premises or at replacement premises or temporary locations;
   b. Minimize the "suspension" of business if you cannot continue "operations".

B. Waiting Period: 72 Hours
The waiting period applies to Business Income loss sustained during the first 72 hours of the "period of restoration".`,
            },
          ],
        },
      },

      // ────────────────────────────────────────────────────
      // Policy 3: Umbrella/Excess — NOT expiring
      // ────────────────────────────────────────────────────
      {
        emailIdx: 2,
        carrier: "Pinnacle Insurance Group",
        policyNumber: "UMB-2026-12850",
        policyTypes: ["umbrella"],
        policyYear: 2026,
        effectiveDate: "03/01/2026",
        expirationDate: "03/01/2027",
        isRenewal: false,
        coverages: [
          { name: "Each Occurrence", limit: "$2,000,000" },
          { name: "Aggregate", limit: "$2,000,000" },
        ],
        premium: "$1,500",
        insuredName: companyName,
        summary: "Commercial umbrella providing excess liability coverage above general liability, commercial auto, and employers' liability underlying policies.",
        metadataSource: {
          carrierPage: 1,
          policyNumberPage: 1,
          premiumPage: 1,
          effectiveDatePage: 1,
        },
        document: {
          sections: [
            {
              title: "Declarations",
              sectionNumber: "DEC",
              pageStart: 1,
              pageEnd: 1,
              type: "declarations",
              coverageType: "umbrella",
              content: `COMMERCIAL UMBRELLA LIABILITY DECLARATIONS

Named Insured: ${companyName}
Policy Number: UMB-2026-12850
Policy Period: 03/01/2026 to 03/01/2027, 12:01 A.M. Standard Time

LIMITS OF INSURANCE
Each Occurrence Limit: $2,000,000
Aggregate Limit: $2,000,000
Self-Insured Retention: $10,000

UNDERLYING INSURANCE SCHEDULE
Carrier: Pinnacle Insurance Group — CGL Policy GL-2025-78432 — $1,000,000/$2,000,000
Carrier: Ironclad Underwriters — Commercial Auto — $1,000,000 CSL

Annual Premium: $1,500`,
            },
            {
              title: "Insuring Agreement",
              sectionNumber: "I",
              pageStart: 2,
              pageEnd: 3,
              type: "insuring_agreement",
              coverageType: "umbrella",
              content: `SECTION I — INSURING AGREEMENT

A. We will pay on behalf of the insured the "ultimate net loss" in excess of the "retained limit" because of "bodily injury" or "property damage" to which this insurance applies caused by an "occurrence" during the policy period.

B. We will pay on behalf of the insured the "ultimate net loss" in excess of the "retained limit" because of "personal and advertising injury" to which this insurance applies caused by an offense committed during the policy period.

C. This insurance applies only if the "bodily injury", "property damage" or "personal and advertising injury" is:
   (1) Not excluded under this policy; and
   (2) Covered under one of the underlying policies listed in the Schedule of Underlying Insurance shown in the Declarations, or would be covered but for the exhaustion of the applicable limits.

D. The "retained limit" is the greater of:
   (1) The applicable limits of "underlying insurance"; or
   (2) The Self-Insured Retention shown in the Declarations.

E. We will have the right and duty to defend the insured against any "suit" seeking damages to which this insurance applies when the "underlying insurance" does not provide coverage or the limits of "underlying insurance" have been exhausted.`,
            },
            {
              title: "Exclusions",
              sectionNumber: "II",
              pageStart: 4,
              pageEnd: 5,
              type: "exclusion",
              coverageType: "umbrella",
              content: `SECTION II — EXCLUSIONS

This insurance does not apply to:

a. Asbestos
   "Bodily injury", "property damage" or "personal and advertising injury" arising out of the actual, alleged or threatened discharge, dispersal, seepage, migration, release or escape of asbestos or asbestos-containing materials.

b. Employment-Related Practices
   "Bodily injury" to a person arising out of any employment-related practices, policies, acts or omissions.

c. Expected Or Intended Injury
   "Bodily injury" or "property damage" expected or intended from the standpoint of the insured.

d. Nuclear
   Any injury or damage with respect to which an insured is also an insured under a nuclear energy liability policy.

e. Pollution
   "Bodily injury" or "property damage" arising out of the actual, alleged or threatened discharge, dispersal, seepage, migration, release or escape of "pollutants".

f. Professional Services
   "Bodily injury", "property damage" or "personal and advertising injury" due to the rendering or failure to render any professional service.

g. War
   "Bodily injury" or "property damage", however caused, arising directly or indirectly out of war.

h. Workers' Compensation
   Any obligation of the insured under a workers' compensation, disability benefits or unemployment compensation law.`,
            },
          ],
        },
      },

      // ────────────────────────────────────────────────────
      // Policy 4: Cyber Liability — NOT expiring
      // ────────────────────────────────────────────────────
      {
        emailIdx: 3,
        carrier: "Vanguard Casualty Co.",
        policyNumber: "CY-2026-55310",
        policyTypes: ["cyber"],
        policyYear: 2026,
        effectiveDate: "01/25/2026",
        expirationDate: "01/25/2027",
        isRenewal: false,
        coverages: [
          { name: "Network Security Liability", limit: "$500,000", deductible: "$10,000" },
          { name: "Privacy Liability", limit: "$500,000" },
          { name: "Data Breach Response Costs", limit: "$250,000" },
          { name: "Cyber Business Interruption", limit: "$100,000" },
        ],
        premium: "$1,250",
        insuredName: companyName,
        summary: "Cyber liability policy covering data breaches, network security incidents, privacy liability, and digital business interruption losses.",
        metadataSource: {
          carrierPage: 1,
          policyNumberPage: 1,
          premiumPage: 2,
          effectiveDatePage: 1,
        },
        document: {
          sections: [
            {
              title: "Declarations",
              sectionNumber: "DEC",
              pageStart: 1,
              pageEnd: 2,
              type: "declarations",
              coverageType: "cyber",
              content: `CYBER LIABILITY INSURANCE DECLARATIONS

Named Insured: ${companyName}
Policy Number: CY-2026-55310
Policy Period: 01/25/2026 to 01/25/2027, 12:01 A.M. Standard Time

LIMITS OF INSURANCE AND RETENTIONS
Coverage                               Limit of Liability    Retention
A. Network Security Liability          $500,000              $10,000
B. Privacy Liability                   $500,000              $10,000
C. Data Breach Response Costs          $250,000              $5,000
D. Cyber Business Interruption         $100,000              8 Hours
   (Waiting Period)

Policy Aggregate Limit: $1,000,000

Annual Premium: $1,250
Retroactive Date: 01/25/2025

Number of Records Maintained: Up to 50,000
Annual Revenue: Up to $5,000,000`,
            },
            {
              title: "Insuring Agreements",
              sectionNumber: "I",
              pageStart: 3,
              pageEnd: 5,
              type: "insuring_agreement",
              coverageType: "cyber",
              content: `SECTION I — INSURING AGREEMENTS

A. Network Security Liability
We will pay on behalf of the Insured all Loss that the Insured becomes legally obligated to pay as a result of any Claim first made against the Insured during the Policy Period arising out of a Network Security Wrongful Act. Network Security Wrongful Act means any actual or alleged act, error, or omission that results in:
   (1) Unauthorized access to or use of Computer Systems;
   (2) A denial-of-service attack against Computer Systems;
   (3) Infection of Computer Systems by malicious code or malware;
   (4) Transmission of malicious code or malware from Computer Systems to third-party systems.

B. Privacy Liability
We will pay on behalf of the Insured all Loss that the Insured becomes legally obligated to pay as a result of any Claim first made against the Insured during the Policy Period arising out of a Privacy Wrongful Act. Privacy Wrongful Act means:
   (1) Failure to protect Personally Identifiable Information in the care, custody, or control of the Insured;
   (2) Failure to comply with the Insured's own privacy policy;
   (3) Violation of any Privacy Regulation, including CCPA, state breach notification laws, HIPAA, and GDPR (to the extent insurable under applicable law).

C. Data Breach Response Costs
We will reimburse the Insured for Data Breach Response Costs incurred as a result of a Data Breach discovered during the Policy Period, including:
   (1) Forensic investigation costs;
   (2) Legal and regulatory counsel;
   (3) Notification costs to affected individuals;
   (4) Credit monitoring and identity theft restoration services;
   (5) Public relations and crisis management expenses;
   (6) Call center services.

D. Cyber Business Interruption
We will pay the Insured for Income Loss and Extra Expense sustained during the Period of Restoration directly resulting from a total or partial interruption of Computer Systems caused by a Network Security Incident, subject to the Waiting Period shown in the Declarations.`,
            },
            {
              title: "Exclusions",
              sectionNumber: "III",
              pageStart: 6,
              pageEnd: 7,
              type: "exclusion",
              coverageType: "cyber",
              content: `SECTION III — EXCLUSIONS

This Policy does not apply to any Claim, Loss, or Data Breach Response Costs:

a. Bodily Injury or Property Damage
   For bodily injury, sickness, disease, death, or physical damage to or destruction of tangible property.

b. Criminal, Fraudulent, or Dishonest Acts
   Arising out of any criminal, fraudulent, or intentionally dishonest act by any Insured, provided this exclusion shall not apply unless a final adjudication establishes such conduct.

c. Contractual Liability
   Based upon or arising out of any assumed liability under contract, except to the extent the Insured would be liable in the absence of the contract.

d. Infrastructure Failure
   Arising out of the failure of electrical, gas, water, telephone, cable, satellite, Internet, or other infrastructure not under the operational control of the Insured.

e. Patent Infringement
   For actual or alleged infringement of any patent.

f. Prior Known Events
   Arising from events known to the Insured prior to the inception of this Policy.

g. Unsolicited Communications
   Arising out of violations of the Telephone Consumer Protection Act (TCPA), CAN-SPAM Act, or any similar statute regulating unsolicited communications.

h. War and Terrorism
   Arising out of war, invasion, acts of foreign enemies, or terrorism, except for cyber terrorism that does not involve physical violence.`,
            },
          ],
        },
      },
    ],
    quotes: [
      // ────────────────────────────────────────────────────
      // Quote 1: GL Renewal (for expiring GL policy)
      // ────────────────────────────────────────────────────
      {
        emailIdx: 4,
        carrier: "Pinnacle Insurance Group",
        broker: "Meridian Risk Advisors",
        quoteNumber: "Q-2026-78432",
        policyTypes: ["general_liability"],
        quoteYear: 2026,
        proposedEffectiveDate: "04/10/2026",
        proposedExpirationDate: "04/10/2027",
        quoteExpirationDate: "03/28/2026",
        isRenewal: true,
        coverages: [
          { name: "Each Occurrence", proposedLimit: "$1,000,000", proposedDeductible: "$2,500" },
          { name: "General Aggregate", proposedLimit: "$2,000,000" },
          { name: "Products/Completed Operations Aggregate", proposedLimit: "$2,000,000" },
          { name: "Personal & Advertising Injury", proposedLimit: "$1,000,000" },
          { name: "Damage to Premises Rented to You", proposedLimit: "$100,000" },
          { name: "Medical Expense (Any One Person)", proposedLimit: "$10,000" },
        ],
        premium: "$3,450",
        insuredName: companyName,
        summary: "Renewal quote for General Liability. Premium increased 7.8% ($3,200 → $3,450) due to claims history adjustment and rate filing increase.",
        premiumBreakdown: [
          { line: "Base Premium", amount: "$2,800" },
          { line: "Experience Modification", amount: "$420" },
          { line: "Terrorism Coverage (TRIA)", amount: "$130" },
          { line: "Taxes & Fees", amount: "$100" },
        ],
        subjectivities: [
          { description: "Signed ACORD 125/126 application", category: "pre_binding" },
          { description: "Loss runs for prior 5 years from all carriers", category: "pre_binding" },
          { description: "Updated schedule of operations and locations", category: "information" },
        ],
        metadataSource: {
          carrierPage: 1,
          quoteNumberPage: 1,
          premiumPage: 2,
          effectiveDatePage: 1,
        },
        document: {
          sections: [
            {
              title: "Terms Summary",
              sectionNumber: "1",
              pageStart: 1,
              pageEnd: 2,
              type: "terms_summary",
              coverageType: "general_liability",
              content: `RENEWAL QUOTATION — COMMERCIAL GENERAL LIABILITY

Prepared for: ${companyName}
Quote Number: Q-2026-78432
Prepared by: Meridian Risk Advisors on behalf of Pinnacle Insurance Group

Proposed Policy Period: 04/10/2026 to 04/10/2027
Quote Valid Until: 03/28/2026

This quotation is for the renewal of your Commercial General Liability policy (GL-2025-78432) currently in force. The proposed terms maintain your existing coverage structure with the following adjustments:

PROPOSED LIMITS OF INSURANCE
Each Occurrence Limit: $1,000,000
Damage to Premises Rented to You: $100,000 (Any One Premises)
Medical Expense Limit: $10,000 (Any One Person)
Personal & Advertising Injury Limit: $1,000,000
General Aggregate Limit: $2,000,000
Products-Completed Operations Aggregate: $2,000,000

Self-Insured Retention / Deductible: $2,500 per occurrence

Coverage Form: CG 00 01 (Occurrence)
Rating Basis: Gross Sales — $850,000 (estimated)

TOTAL PROPOSED ANNUAL PREMIUM: $3,450
(Current premium: $3,200 — Change: +$250 / +7.8%)

The premium increase reflects a 5% rate filing adjustment effective statewide and a minor experience modification based on the reported slip-and-fall claim from 2024 (closed, no payment).`,
            },
            {
              title: "Premium Indication",
              sectionNumber: "2",
              pageStart: 2,
              pageEnd: 2,
              type: "premium_indication",
              coverageType: "general_liability",
              content: `PREMIUM BREAKDOWN

Base Premium (Class 41677 — Consultants)              $2,800
Experience Modification Factor (1.15)                  $420
Terrorism Coverage — TRIA                              $130
State Taxes & Regulatory Fees                          $100
                                                       ------
Total Proposed Annual Premium                          $3,450

Payment Options:
  • Full Pay: $3,450 due at binding
  • Quarterly: $862.50 per quarter (no installment fee)
  • Monthly: $287.50 per month ($25 installment fee applies)

Note: Premium is subject to audit based on actual gross sales at policy expiration. Minimum earned premium: 25% of annual premium.`,
            },
            {
              title: "Subjectivities & Conditions",
              sectionNumber: "3",
              pageStart: 3,
              pageEnd: 3,
              type: "subjectivity",
              coverageType: "general_liability",
              content: `SUBJECTIVITIES — REQUIRED PRIOR TO BINDING

The following items must be received and approved prior to binding coverage:

Pre-Binding Requirements:
1. Signed ACORD 125 (Commercial Insurance Application) and ACORD 126 (Commercial General Liability Section)
2. Currently valued loss runs for the prior five (5) years from all liability carriers
3. Copy of any open or pending claims documentation

Information Required Within 30 Days of Binding:
4. Updated schedule of operations, locations, and employee count
5. Copies of contracts with hold harmless and indemnification provisions
6. Certificates of insurance for all subcontractors (if applicable)

This quotation is contingent upon:
• No material change in operations, ownership, or risk profile prior to the proposed effective date
• No claims or incidents between the date of this quote and the proposed effective date
• Satisfactory review of all subjectivities listed above

This quote does not constitute a binder of insurance. Coverage is not in effect until a binder or policy is issued by the carrier.`,
            },
          ],
        },
      },

      // ────────────────────────────────────────────────────
      // Quote 2: Property Renewal (for expiring property policy)
      // ────────────────────────────────────────────────────
      {
        emailIdx: 5,
        carrier: "Vanguard Casualty Co.",
        broker: "Sentinel Brokers",
        quoteNumber: "Q-2026-67293",
        policyTypes: ["property"],
        quoteYear: 2026,
        proposedEffectiveDate: "05/05/2026",
        proposedExpirationDate: "05/05/2027",
        quoteExpirationDate: "04/05/2026",
        isRenewal: true,
        coverages: [
          { name: "Building", proposedLimit: "$900,000", proposedDeductible: "$5,000" },
          { name: "Business Personal Property", proposedLimit: "$275,000", proposedDeductible: "$2,500" },
          { name: "Business Income with Extra Expense", proposedLimit: "$175,000" },
          { name: "Equipment Breakdown", proposedLimit: "$125,000", proposedDeductible: "$1,000" },
        ],
        premium: "$4,350",
        insuredName: companyName,
        summary: "Renewal quote for Commercial Property. Building limit increased to $900K (from $850K) per updated appraisal. Premium up 6.1% ($4,100 → $4,350).",
        premiumBreakdown: [
          { line: "Building Coverage", amount: "$2,100" },
          { line: "Business Personal Property", amount: "$850" },
          { line: "Business Income & Extra Expense", amount: "$620" },
          { line: "Equipment Breakdown", amount: "$480" },
          { line: "Ordinance & Law", amount: "$150" },
          { line: "Taxes & Fees", amount: "$150" },
        ],
        subjectivities: [
          { description: "Updated property appraisal within last 12 months", category: "pre_binding" },
          { description: "Proof of fire alarm and sprinkler system maintenance", category: "pre_binding" },
          { description: "Photos of premises interior and exterior", category: "information" },
          { description: "Copy of current lease agreement", category: "information" },
        ],
        metadataSource: {
          carrierPage: 1,
          quoteNumberPage: 1,
          premiumPage: 2,
          effectiveDatePage: 1,
        },
        document: {
          sections: [
            {
              title: "Terms Summary",
              sectionNumber: "1",
              pageStart: 1,
              pageEnd: 2,
              type: "terms_summary",
              coverageType: "property",
              content: `RENEWAL QUOTATION — COMMERCIAL PROPERTY

Prepared for: ${companyName}
Quote Number: Q-2026-67293
Prepared by: Sentinel Brokers on behalf of Vanguard Casualty Co.

Proposed Policy Period: 05/05/2026 to 05/05/2027
Quote Valid Until: 04/05/2026

This quotation is for the renewal of your Commercial Property policy (CP-2025-67293). Limits have been adjusted to reflect the updated property appraisal.

PROPOSED SCHEDULE OF COVERAGE
Location: 123 Commerce Drive, Suite 200, Springfield, IL 62701

Coverage                                  Current Limit    Proposed Limit    Deductible
Building                                  $850,000         $900,000          $5,000
Business Personal Property                $250,000         $275,000          $2,500
Business Income with Extra Expense        $150,000         $175,000          72 Hours
Equipment Breakdown                       $100,000         $125,000          $1,000

Covered Causes of Loss: Special Form (CP 10 30)
Coinsurance: 80%
Valuation: Replacement Cost
Agreed Value: Yes (subject to signed Statement of Values)

TOTAL PROPOSED ANNUAL PREMIUM: $4,350
(Current premium: $4,100 — Change: +$250 / +6.1%)

The premium increase reflects increased property values per the 2025 appraisal and a 3% construction cost index adjustment.`,
            },
            {
              title: "Premium Indication",
              sectionNumber: "2",
              pageStart: 2,
              pageEnd: 2,
              type: "premium_indication",
              coverageType: "property",
              content: `PREMIUM BREAKDOWN

Building Coverage (Special Form)                       $2,100
Business Personal Property                             $850
Business Income & Extra Expense                        $620
Equipment Breakdown Enhancement                        $480
Ordinance & Law Coverage                               $150
State Taxes & Regulatory Fees                          $150
                                                       ------
Total Proposed Annual Premium                          $4,350

Optional Coverages Available (not included):
  • Flood (NFIP or Private): Additional $800–$1,200/year
  • Earthquake: Additional $350/year
  • Cyber-Caused Property Damage: Additional $200/year

Payment Options:
  • Full Pay: $4,350 due at binding
  • Quarterly: $1,087.50 per quarter
  • Monthly: $362.50 per month ($25 installment fee applies)`,
            },
            {
              title: "Subjectivities & Conditions",
              sectionNumber: "3",
              pageStart: 3,
              pageEnd: 3,
              type: "subjectivity",
              coverageType: "property",
              content: `SUBJECTIVITIES — REQUIRED PRIOR TO BINDING

The following items must be received and approved prior to binding coverage:

Pre-Binding Requirements:
1. Updated property appraisal completed within the last 12 months
2. Proof of fire alarm monitoring and sprinkler system inspection/maintenance (within 12 months)
3. Signed Statement of Values for Agreed Value endorsement

Information Required Within 30 Days of Binding:
4. Recent photos of premises — exterior (all sides) and interior (common areas, mechanical rooms)
5. Copy of current lease agreement for occupied premises
6. Schedule of high-value equipment (items over $25,000)
7. Business continuity plan or disaster recovery documentation (if available)

This quotation is contingent upon:
• No material change in building condition, occupancy, or fire protection prior to proposed effective date
• Satisfactory completion of loss control inspection (to be scheduled within 60 days of binding)
• No losses or claims between the date of this quote and the proposed effective date

This quote does not constitute a binder of insurance. Coverage is not in effect until a binder or policy is issued by the carrier.`,
            },
          ],
        },
      },
    ],
  };
}
