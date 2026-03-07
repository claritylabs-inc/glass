import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // Override default users table with custom profile fields
  users: defineTable({
    // Auth-managed fields
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Custom profile fields
    companyName: v.optional(v.string()),
    insuranceBroker: v.optional(v.string()),
    companyWebsite: v.optional(v.string()),
    companyContext: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  emailConnections: defineTable({
    userId: v.optional(v.id("users")),
    label: v.string(),
    imapHost: v.string(),
    imapPort: v.number(),
    email: v.string(),
    password: v.string(),
    lastScanAt: v.optional(v.number()),
    lastScanStatus: v.optional(
      v.union(
        v.literal("scanning"),
        v.literal("success"),
        v.literal("error")
      )
    ),
    lastScanError: v.optional(v.string()),
    emailsFound: v.optional(v.number()),
    policiesExtracted: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  emails: defineTable({
    userId: v.optional(v.id("users")),
    connectionId: v.id("emailConnections"),
    messageId: v.string(),
    uid: v.optional(v.number()),
    subject: v.string(),
    from: v.string(),
    date: v.string(),
    hasAttachments: v.boolean(),
    isInsuranceRelated: v.optional(v.boolean()),
    classificationReason: v.optional(v.string()),
    classificationConfidence: v.optional(v.number()),
    processed: v.boolean(),
  }).index("by_messageId", ["messageId"])
    .index("by_connection_processed", ["connectionId", "processed"])
    .index("by_userId", ["userId"]),

  policies: defineTable({
    userId: v.optional(v.id("users")),
    emailId: v.optional(v.id("emails")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    // Entity fields
    carrier: v.string(), // backward compat — prefer security for new extractions
    security: v.optional(v.string()), // insurer/underwriter company (e.g. "Lloyd's Underwriters")
    underwriter: v.optional(v.string()), // named individual underwriter (e.g. "Libby Rudd")
    mga: v.optional(v.string()), // MGA / Program Administrator (e.g. "CFC Tech")
    broker: v.optional(v.string()),
    // Policy metadata
    policyNumber: v.string(),
    policyType: v.optional(v.string()), // legacy single type
    policyTypes: v.optional(v.array(v.string())),
    documentType: v.optional(v.union(v.literal("policy"), v.literal("quote"))),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(
      v.object({
        name: v.string(),
        limit: v.string(),
        deductible: v.optional(v.string()),
        pageNumber: v.optional(v.number()),
        sectionRef: v.optional(v.string()),
      })
    ),
    premium: v.optional(v.string()),
    insuredName: v.string(),
    summary: v.optional(v.string()),
    // Provenance — page references for key metadata
    metadataSource: v.optional(v.object({
      carrierPage: v.optional(v.number()),
      policyNumberPage: v.optional(v.number()),
      premiumPage: v.optional(v.number()),
      effectiveDatePage: v.optional(v.number()),
    })),
    // Full document structure with provenance
    document: v.optional(v.object({
      sections: v.array(v.object({
        title: v.string(),
        sectionNumber: v.optional(v.string()),
        pageStart: v.number(),
        pageEnd: v.optional(v.number()),
        type: v.string(), // declarations, insuring_agreement, exclusion, condition, definition, endorsement, schedule, subjectivity, warranty, notice, regulatory, other
        coverageType: v.optional(v.string()), // links to policyTypes value
        content: v.string(), // full text — preserve original language
        subsections: v.optional(v.array(v.object({
          title: v.string(),
          sectionNumber: v.optional(v.string()),
          pageNumber: v.optional(v.number()),
          content: v.string(),
        }))),
      })),
      regulatoryContext: v.optional(v.object({
        content: v.string(),
        pageNumber: v.optional(v.number()),
      })),
      complaintContact: v.optional(v.object({
        content: v.string(),
        pageNumber: v.optional(v.number()),
      })),
      costsAndFees: v.optional(v.object({
        content: v.string(),
        pageNumber: v.optional(v.number()),
      })),
    })),
    // Extraction state
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("not_insurance")
    ),
    extractionError: v.optional(v.string()),
    rawExtractionResponse: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  }).index("by_carrier", ["carrier"])
    .index("by_policyYear", ["policyYear"])
    .index("by_userId", ["userId"]),
});
