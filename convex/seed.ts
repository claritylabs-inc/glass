import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const seed = mutation({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Check if already seeded
    const existing = await ctx.db.query("emailConnections").first();
    if (existing) return "Already seeded";

    // Use provided userId or find first user in DB
    let userId = args.userId;
    if (!userId) {
      const firstUser = await ctx.db.query("users").first();
      if (firstUser) userId = firstUser._id;
    }

    // Create demo connection
    const connectionId = await ctx.db.insert("emailConnections", {
      ...(userId ? { userId } : {}),
      label: "Rosario's Business Email",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      email: "insurance@rosarios.com",
      password: "demo-app-password",
      lastScanAt: Date.now() - 3600000,
      lastScanStatus: "success",
      emailsFound: 15,
      policiesExtracted: 8,
    });

    // Create sample emails
    const emailData = [
      { subject: "Your 2025 General Liability Policy - Renewal", from: "The Hartford <renewals@thehartford.com>", date: "2025-01-15T10:30:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "Workers' Compensation Policy WC-2025-44821", from: "Liberty Mutual <policies@libertymutual.com>", date: "2025-02-01T14:22:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "Commercial Auto Insurance - New Policy", from: "Travelers <service@travelers.com>", date: "2025-01-20T09:15:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "Property Insurance Renewal Notice", from: "Chubb <renewals@chubb.com>", date: "2024-12-10T16:45:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "Umbrella Policy - Annual Review", from: "The Hartford <policies@thehartford.com>", date: "2025-03-01T11:00:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "Professional Liability Coverage Update", from: "Hiscox <service@hiscox.com>", date: "2025-02-15T08:30:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "Cyber Insurance Policy Documents", from: "Chubb <cyber@chubb.com>", date: "2025-01-25T13:10:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "EPLI Policy - Employment Practices", from: "Liberty Mutual <epli@libertymutual.com>", date: "2024-11-20T15:30:00Z", hasAttachments: true, isInsuranceRelated: true, processed: true },
      { subject: "Invoice #4521 - Kitchen Supplies", from: "Restaurant Depot <billing@restaurantdepot.com>", date: "2025-02-10T09:00:00Z", hasAttachments: true, isInsuranceRelated: false, processed: true },
      { subject: "Weekly Staff Schedule", from: "Rosario Manager <manager@rosarios.com>", date: "2025-03-03T07:00:00Z", hasAttachments: false, isInsuranceRelated: false, processed: true },
      { subject: "Health Inspection Passed!", from: "County Health Dept <inspections@county.gov>", date: "2025-02-28T14:00:00Z", hasAttachments: true, isInsuranceRelated: false, processed: true },
      { subject: "Re: Catering Quote Request", from: "John Smith <john@smithevents.com>", date: "2025-03-02T10:15:00Z", hasAttachments: false, isInsuranceRelated: false, processed: true },
      { subject: "Your POS System Monthly Report", from: "Square <reports@square.com>", date: "2025-03-01T06:00:00Z", hasAttachments: true, isInsuranceRelated: false, processed: true },
      { subject: "Liquor License Renewal Reminder", from: "ABC Board <notices@abc.state.gov>", date: "2025-02-20T11:30:00Z", hasAttachments: false, isInsuranceRelated: false, processed: true },
      { subject: "New Menu Design Proofs", from: "PrintShop <orders@printshop.com>", date: "2025-03-04T16:00:00Z", hasAttachments: true, isInsuranceRelated: false, processed: true },
    ];

    const emailIds: Record<number, any> = {};
    for (let i = 0; i < emailData.length; i++) {
      const e = emailData[i];
      emailIds[i] = await ctx.db.insert("emails", {
        ...(userId ? { userId } : {}),
        connectionId,
        messageId: `msg-${i + 1}@demo.rosarios.com`,
        subject: e.subject,
        from: e.from,
        date: e.date,
        hasAttachments: e.hasAttachments,
        isInsuranceRelated: e.isInsuranceRelated,
        classificationReason: e.isInsuranceRelated ? "Keyword match: insurance policy" : "No insurance keywords found",
        classificationConfidence: e.isInsuranceRelated ? 0.95 : 0.1,
        processed: e.processed,
      });
    }

    // Create policies with pre-filled metadata
    const policiesData = [
      {
        emailIdx: 0,
        carrier: "The Hartford",
        mga: "AmTrust Financial",
        broker: "Marsh McLennan",
        policyNumber: "GL-2025-78432",
        policyTypes: ["general_liability"],
        documentType: "policy" as const,
        policyYear: 2025,
        effectiveDate: "01/15/2025",
        expirationDate: "01/15/2026",
        isRenewal: true,
        coverages: [
          { name: "Each Occurrence", limit: "$1,000,000", deductible: "$2,500" },
          { name: "General Aggregate", limit: "$2,000,000" },
          { name: "Products/Completed Ops", limit: "$2,000,000" },
          { name: "Personal & Advertising Injury", limit: "$1,000,000" },
        ],
        premium: "$3,200",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Commercial general liability policy covering bodily injury, property damage, and personal injury claims for restaurant operations.",
      },
      {
        emailIdx: 1,
        carrier: "Liberty Mutual",
        policyNumber: "WC-2025-44821",
        policyTypes: ["workers_comp"],
        documentType: "policy" as const,
        policyYear: 2025,
        effectiveDate: "02/01/2025",
        expirationDate: "02/01/2026",
        isRenewal: false,
        coverages: [
          { name: "Workers' Compensation", limit: "Statutory" },
          { name: "Employers' Liability - Each Accident", limit: "$500,000" },
          { name: "Employers' Liability - Disease (Each)", limit: "$500,000" },
          { name: "Employers' Liability - Disease (Policy)", limit: "$500,000" },
        ],
        premium: "$4,800",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Workers' compensation coverage for 22 employees including kitchen staff, servers, and management.",
      },
      {
        emailIdx: 2,
        carrier: "Travelers",
        policyNumber: "CA-2025-31094",
        policyTypes: ["commercial_auto"],
        documentType: "policy" as const,
        policyYear: 2025,
        effectiveDate: "01/20/2025",
        expirationDate: "01/20/2026",
        isRenewal: false,
        coverages: [
          { name: "Combined Single Limit", limit: "$1,000,000" },
          { name: "Uninsured/Underinsured Motorist", limit: "$1,000,000" },
          { name: "Medical Payments", limit: "$5,000" },
          { name: "Comprehensive", limit: "ACV", deductible: "$500" },
          { name: "Collision", limit: "ACV", deductible: "$1,000" },
        ],
        premium: "$2,400",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Commercial auto policy covering 2 delivery vehicles (2023 Ford Transit, 2024 Toyota Corolla).",
      },
      {
        emailIdx: 3,
        carrier: "Chubb",
        broker: "Aon",
        policyNumber: "CP-2024-67293",
        policyTypes: ["property"],
        documentType: "policy" as const,
        policyYear: 2024,
        effectiveDate: "12/10/2024",
        expirationDate: "12/10/2025",
        isRenewal: true,
        coverages: [
          { name: "Building", limit: "$850,000", deductible: "$5,000" },
          { name: "Business Personal Property", limit: "$250,000", deductible: "$2,500" },
          { name: "Business Income", limit: "$150,000" },
          { name: "Equipment Breakdown", limit: "$100,000", deductible: "$1,000" },
        ],
        premium: "$4,100",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Commercial property insurance covering the restaurant building at 742 Mulberry St, kitchen equipment, and business income loss.",
      },
      {
        emailIdx: 4,
        carrier: "The Hartford",
        policyNumber: "UMB-2025-12850",
        policyTypes: ["umbrella"],
        documentType: "policy" as const,
        policyYear: 2025,
        effectiveDate: "03/01/2025",
        expirationDate: "03/01/2026",
        isRenewal: false,
        coverages: [
          { name: "Each Occurrence", limit: "$2,000,000" },
          { name: "Aggregate", limit: "$2,000,000" },
        ],
        premium: "$1,500",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Commercial umbrella providing excess liability coverage above GL, auto, and employers' liability.",
      },
      {
        emailIdx: 5,
        carrier: "Hiscox",
        policyNumber: "PL-2025-90127",
        policyTypes: ["professional_liability"],
        documentType: "policy" as const,
        policyYear: 2025,
        effectiveDate: "02/15/2025",
        expirationDate: "02/15/2026",
        isRenewal: false,
        coverages: [
          { name: "Each Claim", limit: "$500,000", deductible: "$5,000" },
          { name: "Aggregate", limit: "$1,000,000" },
        ],
        premium: "$950",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Professional liability/E&O coverage for catering consulting and food safety advisory services.",
      },
      {
        emailIdx: 6,
        carrier: "Chubb",
        policyNumber: "CY-2025-55310",
        policyTypes: ["cyber"],
        documentType: "policy" as const,
        policyYear: 2025,
        effectiveDate: "01/25/2025",
        expirationDate: "01/25/2026",
        isRenewal: false,
        coverages: [
          { name: "Network Security Liability", limit: "$500,000", deductible: "$10,000" },
          { name: "Privacy Liability", limit: "$500,000" },
          { name: "Data Breach Response", limit: "$250,000" },
          { name: "Business Interruption", limit: "$100,000" },
        ],
        premium: "$1,250",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Cyber liability covering POS system breaches, customer data protection, and digital business interruption.",
      },
      {
        emailIdx: 7,
        carrier: "Liberty Mutual",
        policyNumber: "EPLI-2024-88214",
        policyTypes: ["epli"],
        documentType: "quote" as const,
        policyYear: 2024,
        effectiveDate: "11/20/2024",
        expirationDate: "11/20/2025",
        isRenewal: true,
        coverages: [
          { name: "Each Employment Claim", limit: "$250,000", deductible: "$15,000" },
          { name: "Aggregate", limit: "$500,000" },
          { name: "Third-Party Coverage", limit: "$250,000" },
        ],
        premium: "$1,800",
        insuredName: "Rosario's Italian Kitchen LLC",
        summary: "Employment practices liability covering wrongful termination, discrimination, harassment, and wage/hour claims.",
      },
    ];

    for (const p of policiesData) {
      await ctx.db.insert("policies", {
        ...(userId ? { userId } : {}),
        emailId: emailIds[p.emailIdx],
        carrier: p.carrier,
        ...("mga" in p ? { mga: p.mga } : {}),
        ...("broker" in p ? { broker: p.broker } : {}),
        policyNumber: p.policyNumber,
        policyTypes: p.policyTypes,
        documentType: p.documentType,
        policyYear: p.policyYear,
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        isRenewal: p.isRenewal,
        coverages: p.coverages,
        premium: p.premium,
        insuredName: p.insuredName,
        summary: p.summary,
        extractionStatus: "complete",
      });
    }

    return "Seeded successfully: 1 connection, 15 emails, 8 policies";
  },
});
