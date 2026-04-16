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
    // Personal profile fields
    title: v.optional(v.string()),
    // Legacy company fields (kept for backward compat, will be removed after migration)
    companyName: v.optional(v.string()),
    insuranceBroker: v.optional(v.string()),
    companyWebsite: v.optional(v.string()),
    companyContext: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerContactEmail: v.optional(v.string()),
    coiHandling: v.optional(v.union(v.literal("broker"), v.literal("user"), v.literal("ignore"))),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
    // Onboarding & admin
    onboardingComplete: v.optional(v.boolean()),
    isAdmin: v.optional(v.boolean()),
    agentHandle: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_agentHandle", ["agentHandle"]),

  // Organizations — owns company data, agent, broker info
  organizations: defineTable({
    name: v.string(),
    website: v.optional(v.string()),
    context: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
    // Relationship context — helps categorize intelligence entries
    clientsContext: v.optional(v.string()),    // who the org's clients/customers are
    vendorsContext: v.optional(v.string()),    // key vendors and service providers
    insuranceContext: v.optional(v.string()),  // brokers, carriers, insurance relationships
    investorsContext: v.optional(v.string()),  // investors, shareholders, funding
    partnersContext: v.optional(v.string()),   // joint ventures, affiliates, partners
    // Broker info
    insuranceBroker: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerContactEmail: v.optional(v.string()),
    // COI handling preference
    coiHandling: v.optional(v.union(v.literal("broker"), v.literal("member"), v.literal("ignore"))),
    autoGenerateCoi: v.optional(v.boolean()), // when true, generate COI PDFs automatically on request
    // Agent
    agentHandle: v.optional(v.string()),
    // Primary insurance contact for the org
    primaryInsuranceContactId: v.optional(v.id("users")),
    // Agent settings
    chatEmailNotifications: v.optional(v.boolean()), // send email notifications for chat responses in email threads
    autoSendEmails: v.optional(v.boolean()), // when false, drafted emails from chat require confirmation before sending
    emailSendDelay: v.optional(v.number()), // seconds before sending emails (default 5, 0 = instant)
    // Onboarding
    onboardingComplete: v.optional(v.boolean()),
    // Portfolio-level AI analysis
    portfolioAnalysis: v.optional(v.any()),
    // Intelligence pipeline
    intelligenceSummary: v.optional(v.string()),
    lastDreamAt: v.optional(v.number()),
  }).index("by_agentHandle", ["agentHandle"]),

  // Org memberships — links users to orgs
  orgMemberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  })
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"])
    .index("by_orgId_userId", ["orgId", "userId"]),

  // Organization business context — reusable answers for application auto-fill
  orgBusinessContext: defineTable({
    orgId: v.id("organizations"),
    category: v.string(), // company_info, operations, financial, coverage, loss_history
    key: v.string(), // normalized field name
    value: v.string(),
    fieldType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("numeric"),
        v.literal("currency"),
        v.literal("date"),
        v.literal("yes_no"),
      ),
    ),
    source: v.union(
      v.literal("onboarding"),
      v.literal("application"),
      v.literal("user_email"),
      v.literal("manual"),
    ),
    confidence: v.union(v.literal("confirmed"), v.literal("inferred")),
    sourceConversationId: v.optional(v.id("agentConversations")),
    sourceSessionId: v.optional(v.id("applicationSessions")),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_category", ["orgId", "category"])
    .index("by_orgId_key", ["orgId", "key"]),

  // Org memory — persistent AI knowledge (facts, preferences, risk notes, observations)
  orgMemory: defineTable({
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("fact"),
      v.literal("preference"),
      v.literal("risk_note"),
      v.literal("observation"),
    ),
    content: v.string(),
    source: v.union(
      v.literal("extraction"),
      v.literal("analysis"),
      v.literal("chat"),
      v.literal("email"),
    ),
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.any()), // legacy: may contain old quotes table IDs // quotes now stored in policies table with documentType="quote"
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_type", ["orgId", "type"]),

  // Insurance application sessions — tracks multi-step form filling workflow
  applicationSessions: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    conversationId: v.id("agentConversations"), // root conversation
    threadId: v.optional(v.id("agentConversations")), // thread root for reply routing
    sourceFileId: v.id("_storage"),
    sourceFileName: v.string(),
    applicationTitle: v.optional(v.string()),
    status: v.union(
      v.literal("extracting_fields"),
      v.literal("filling_known"),
      v.literal("asking_questions"),
      v.literal("pending_confirmation"),
      v.literal("confirmed"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    failureReason: v.optional(v.string()),
    lastProgressAt: v.optional(v.number()),
    extractedFields: v.optional(v.string()), // JSON-serialized FormField[]
    totalFields: v.optional(v.number()),
    filledFields: v.optional(v.number()),
    confirmedFields: v.optional(v.number()),
    questionBatches: v.optional(v.string()), // JSON-serialized QuestionBatch[]
    currentBatchIndex: v.optional(v.number()),
    summaryFileId: v.optional(v.id("_storage")),
    filledFileId: v.optional(v.id("_storage")),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    rawExtractionResponse: v.optional(v.string()),
    originalMessageId: v.optional(v.string()), // inbound Message-ID for threading
    lastSentMessageId: v.optional(v.string()), // last outbound Message-ID for References chain
    error: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_conversationId", ["conversationId"])
    .index("by_threadId", ["threadId"])
    .index("by_status", ["status"]),

  // Org invitations — pending invites
  orgInvitations: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
    expiresAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_orgId", ["orgId"]),

  emailConnections: defineTable({
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    provider: v.optional(v.union(v.literal("google"), v.literal("imap"))),
    label: v.string(),
    // IMAP fields (optional — only for provider: "imap")
    imapHost: v.optional(v.string()),
    imapPort: v.optional(v.number()),
    email: v.string(),
    password: v.optional(v.string()),
    // Google OAuth fields (optional — only for provider: "google")
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    tokenExpiry: v.optional(v.number()),
    lastScanAt: v.optional(v.number()),
    lastScanStatus: v.optional(
      v.union(
        v.literal("scanning"),
        v.literal("success"),
        v.literal("error"),
        v.literal("disconnected")
      )
    ),
    lastScanError: v.optional(v.string()),
    emailsFound: v.optional(v.number()),
    policiesExtracted: v.optional(v.number()),
    lastScanParams: v.optional(v.object({
      sinceDate: v.optional(v.string()),
      untilDate: v.optional(v.string()),
      senderDomains: v.optional(v.array(v.string())),
    })),
    scanProgress: v.optional(v.object({
      phase: v.string(),
      totalEmails: v.optional(v.number()),
      processedEmails: v.optional(v.number()),
      insuranceFound: v.optional(v.number()),
      extracting: v.optional(v.number()),
      extracted: v.optional(v.number()),
    })),
    isDemo: v.optional(v.boolean()),
  }).index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"])
    .index("by_email_orgId_provider", ["email", "orgId", "provider"]),

  // Temporary OAuth state for CSRF validation during Google OAuth flow
  oauthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    orgId: v.id("organizations"),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // Unified business intelligence store — replaces orgBusinessContext + orgMemory
  orgIntelligence: defineTable({
    orgId: v.id("organizations"),
    content: v.string(),
    category: v.union(
      v.literal("company_info"),
      v.literal("products_services"),
      v.literal("operations"),
      v.literal("employees"),
      v.literal("financial"),
      v.literal("coverage"),
      v.literal("risk"),
      v.literal("relationship"),
      v.literal("clients"),
      v.literal("insurance"),
      v.literal("investors"),
      v.literal("vendors"),
      v.literal("partners"),
      v.literal("observation"),
    ),
    tags: v.optional(v.array(v.string())), // additional categories beyond the primary one
    confidence: v.union(
      v.literal("confirmed"),
      v.literal("inferred"),
      v.literal("stale"),
    ),
    source: v.union(
      v.literal("email"),
      v.literal("application"),
      v.literal("chat"),
      v.literal("extraction"),
      v.literal("dream"),
      v.literal("manual"),
    ),
    sourceRef: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),    // human-readable: "2025 P&L", "GL Policy #ABC"
    asOfDate: v.optional(v.string()),       // when the fact was true: "2025-12-31"
    documentDate: v.optional(v.string()),   // when the source doc was created/effective
    embedding: v.optional(v.array(v.float64())),
    supersededBy: v.optional(v.id("orgIntelligence")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_category", ["orgId", "category"])
    .index("by_orgId_source", ["orgId", "source"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["orgId"],
    }),

  // Email scan run logs (streaming — updated as scan progresses)
  emailScanLogs: defineTable({
    orgId: v.optional(v.id("organizations")),
    connectionId: v.id("emailConnections"),
    connectionLabel: v.string(),
    trigger: v.union(v.literal("manual"), v.literal("daily"), v.literal("calendar")),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("error"),
    ),
    // Scan parameters
    sinceDate: v.optional(v.string()),
    untilDate: v.optional(v.string()),
    senderDomains: v.optional(v.array(v.string())),
    // Result metrics
    inboxFound: v.number(),
    sentFound: v.number(),
    totalInserted: v.number(),
    duplicatesSkipped: v.number(),
    insuranceFound: v.optional(v.number()),
    // Progress + errors
    error: v.optional(v.string()),
    log: v.optional(v.array(v.string())),
    durationMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_connectionId", ["connectionId"]),

  // Dream consolidation run logs (streaming — updated as run progresses)
  dreamLogs: defineTable({
    orgId: v.id("organizations"),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
    ),
    entriesReviewed: v.number(),
    entriesDeleted: v.number(),
    entriesConsolidated: v.number(),
    gapsIdentified: v.number(),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    log: v.optional(v.array(v.string())), // streaming progress lines
    durationMs: v.number(),
    createdAt: v.number(),
  }).index("by_orgId", ["orgId"]),

  emails: defineTable({
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
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
    isDemo: v.optional(v.boolean()),
    // Intelligence extraction tracking
    intelligenceStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("skipped"),
      v.literal("extracted"),
      v.literal("error"),
    )),
    intelligenceExtractedAt: v.optional(v.number()),
  }).index("by_messageId", ["messageId"])
    .index("by_connection_processed", ["connectionId", "processed"])
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"]),

  policies: defineTable({
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    emailId: v.optional(v.id("emails")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    // Entity fields
    carrier: v.string(), // backward compat — prefer security for new extractions
    security: v.optional(v.string()), // insurer/underwriter company (e.g. "Lloyd's Underwriters")
    underwriter: v.optional(v.string()), // named individual underwriter (e.g. "Libby Rudd")
    mga: v.optional(v.string()), // MGA / Program Administrator (e.g. "CFC Tech")
    broker: v.optional(v.string()),
    // Enriched entity fields (cl-sdk 1.2+)
    carrierLegalName: v.optional(v.string()),
    carrierNaicNumber: v.optional(v.string()),
    carrierAmBestRating: v.optional(v.string()),
    carrierAdmittedStatus: v.optional(v.string()), // admitted, non_admitted, surplus_lines
    brokerAgency: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerLicenseNumber: v.optional(v.string()),
    // Structured entity objects (cl-sdk 0.11+)
    insurer: v.optional(v.object({
      legalName: v.string(),
      naicNumber: v.optional(v.string()),
      amBestRating: v.optional(v.string()),
      amBestNumber: v.optional(v.string()),
      admittedStatus: v.optional(v.string()),
      stateOfDomicile: v.optional(v.string()),
    })),
    producer: v.optional(v.object({
      agencyName: v.string(),
      contactName: v.optional(v.string()),
      licenseNumber: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      address: v.optional(v.object({
        street1: v.string(),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        country: v.optional(v.string()),
      })),
    })),
    lossPayees: v.optional(v.array(v.object({
      name: v.string(),
      role: v.string(),
      address: v.optional(v.object({
        street1: v.string(),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        country: v.optional(v.string()),
      })),
      relationship: v.optional(v.string()),
      scope: v.optional(v.string()),
    }))),
    mortgageHolders: v.optional(v.array(v.object({
      name: v.string(),
      role: v.string(),
      address: v.optional(v.object({
        street1: v.string(),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        country: v.optional(v.string()),
      })),
      relationship: v.optional(v.string()),
      scope: v.optional(v.string()),
    }))),
    priorPolicyNumber: v.optional(v.string()),
    programName: v.optional(v.string()),
    isPackage: v.optional(v.boolean()),
    // Insured details (cl-sdk 1.2+)
    insuredDba: v.optional(v.string()),
    insuredAddress: v.optional(v.object({
      street1: v.string(),
      street2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zip: v.optional(v.string()),
      country: v.optional(v.string()),
    })),
    insuredEntityType: v.optional(v.string()), // corporation, llc, partnership, etc.
    insuredFein: v.optional(v.string()),
    additionalNamedInsureds: v.optional(v.array(v.object({
      name: v.string(),
      relationship: v.optional(v.string()),
      address: v.optional(v.object({
        street1: v.string(),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        country: v.optional(v.string()),
      })),
    }))),
    // Coverage structure (cl-sdk 1.2+)
    coverageForm: v.optional(v.string()), // occurrence, claims_made, accident
    retroactiveDate: v.optional(v.string()),
    effectiveTime: v.optional(v.string()),
    limits: v.optional(v.object({
      perOccurrence: v.optional(v.string()),
      generalAggregate: v.optional(v.string()),
      productsCompletedOpsAggregate: v.optional(v.string()),
      personalAdvertisingInjury: v.optional(v.string()),
      eachEmployee: v.optional(v.string()),
      fireDamage: v.optional(v.string()),
      medicalExpense: v.optional(v.string()),
      combinedSingleLimit: v.optional(v.string()),
      bodilyInjuryPerPerson: v.optional(v.string()),
      bodilyInjuryPerAccident: v.optional(v.string()),
      propertyDamage: v.optional(v.string()),
      eachOccurrenceUmbrella: v.optional(v.string()),
      umbrellaAggregate: v.optional(v.string()),
      umbrellaRetention: v.optional(v.string()),
      statutory: v.optional(v.boolean()),
      employersLiability: v.optional(v.object({
        eachAccident: v.string(),
        diseasePolicyLimit: v.string(),
        diseaseEachEmployee: v.string(),
      })),
      sublimits: v.optional(v.array(v.object({
        name: v.string(),
        limit: v.string(),
        appliesTo: v.optional(v.string()),
        deductible: v.optional(v.string()),
      }))),
      sharedLimits: v.optional(v.array(v.object({
        description: v.string(),
        limit: v.string(),
        coverageParts: v.array(v.string()),
      }))),
      defenseCostTreatment: v.optional(v.string()), // inside_limits, outside_limits, supplementary
    })),
    deductibles: v.optional(v.object({
      perClaim: v.optional(v.string()),
      perOccurrence: v.optional(v.string()),
      aggregateDeductible: v.optional(v.string()),
      selfInsuredRetention: v.optional(v.string()),
      corridorDeductible: v.optional(v.string()),
      waitingPeriod: v.optional(v.string()),
      appliesTo: v.optional(v.string()),
    })),
    // Locations, vehicles, classifications (cl-sdk 1.2+)
    locations: v.optional(v.array(v.object({
      number: v.number(),
      address: v.object({
        street1: v.string(),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        country: v.optional(v.string()),
      }),
      description: v.optional(v.string()),
      buildingValue: v.optional(v.string()),
      contentsValue: v.optional(v.string()),
      businessIncomeValue: v.optional(v.string()),
      constructionType: v.optional(v.string()),
      yearBuilt: v.optional(v.number()),
      squareFootage: v.optional(v.number()),
      protectionClass: v.optional(v.string()),
      sprinklered: v.optional(v.boolean()),
      alarmType: v.optional(v.string()),
      occupancy: v.optional(v.string()),
    }))),
    vehicles: v.optional(v.array(v.object({
      number: v.number(),
      year: v.number(),
      make: v.string(),
      model: v.string(),
      vin: v.string(),
      costNew: v.optional(v.string()),
      statedValue: v.optional(v.string()),
      garageLocation: v.optional(v.number()),
      coverages: v.optional(v.array(v.object({
        type: v.string(),
        limit: v.optional(v.string()),
        deductible: v.optional(v.string()),
        included: v.boolean(),
      }))),
      radius: v.optional(v.string()),
      vehicleType: v.optional(v.string()),
    }))),
    classifications: v.optional(v.array(v.object({
      code: v.string(),
      description: v.string(),
      premiumBasis: v.string(),
      basisAmount: v.optional(v.string()),
      rate: v.optional(v.string()),
      premium: v.optional(v.string()),
      locationNumber: v.optional(v.number()),
    }))),
    formInventory: v.optional(v.array(v.object({
      formNumber: v.string(),
      editionDate: v.optional(v.string()),
      title: v.optional(v.string()),
      formType: v.string(), // coverage, endorsement, declarations, application, notice, other
      pageStart: v.optional(v.number()),
      pageEnd: v.optional(v.number()),
    }))),
    taxesAndFees: v.optional(v.array(v.object({
      name: v.string(),
      amount: v.string(),
      type: v.optional(v.string()), // tax, fee, surcharge, assessment
      description: v.optional(v.string()),
    }))),
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
        coverageCode: v.optional(v.string()),
        limit: v.optional(v.string()),
        limitType: v.optional(v.string()),
        limitValueType: v.optional(v.string()),
        deductible: v.optional(v.string()),
        deductibleValueType: v.optional(v.string()),
        formNumber: v.optional(v.string()),
        pageNumber: v.optional(v.number()),
        sectionRef: v.optional(v.string()),
        originalContent: v.optional(v.string()),
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
    // Extracted document structure (sections, endorsements, conditions, etc.)
    // Uses v.any() because the cl-sdk document schema evolves frequently
    document: v.optional(v.any()),
    // Extraction state
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("paused"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("not_insurance")
    ),
    extractionError: v.optional(v.string()),
    extractionCheckpoint: v.optional(v.any()), // PipelineCheckpoint<ExtractionState> for resume
    extractionLog: v.optional(v.array(v.object({
      timestamp: v.number(),
      message: v.string(),
    }))),
    rawExtractionResponse: v.optional(v.string()),
    rawMetadataResponse: v.optional(v.string()),
    // Typed declarations (cl-sdk 1.4+) — line-specific structured data
    declarations: v.optional(v.any()),
    // AI analysis results (risk notes, observations, key findings)
    analysis: v.optional(v.any()),
    // cl-sdk 3.0+ fields
    policyTermType: v.optional(v.string()),
    nextReviewDate: v.optional(v.string()),
    minPremium: v.optional(v.string()),
    depositPremium: v.optional(v.string()),
    auditProvision: v.optional(v.boolean()),
    cancellationProvisions: v.optional(v.string()),
    nonRenewalProvisions: v.optional(v.string()),
    assignmentClause: v.optional(v.string()),
    subrogationClause: v.optional(v.string()),
    otherInsuranceClause: v.optional(v.string()),
    // Quote-specific fields (for documentType === "quote")
    quoteNumber: v.optional(v.string()),
    quoteYear: v.optional(v.number()),
    proposedEffectiveDate: v.optional(v.string()),
    proposedExpirationDate: v.optional(v.string()),
    quoteExpirationDate: v.optional(v.string()),
    subjectivities: v.optional(v.any()),
    underwritingConditions: v.optional(v.any()),
    premiumBreakdown: v.optional(v.any()),
    enrichedSubjectivities: v.optional(v.any()),
    enrichedUnderwritingConditions: v.optional(v.any()),
    warrantyRequirements: v.optional(v.any()),
    // Supplementary extraction (cl-sdk 0.13+) — extra facts not captured by structured extractors
    supplementaryFacts: v.optional(v.array(v.object({
      key: v.string(),
      value: v.string(),
      subject: v.optional(v.string()),
      context: v.optional(v.string()),
    }))),
    deletedAt: v.optional(v.number()),
    isDemo: v.optional(v.boolean()),
    // When true, this policy's chunks are excluded from vector search results
    excludeFromSearch: v.optional(v.boolean()),
  }).index("by_carrier", ["carrier"])
    .index("by_policyYear", ["policyYear"])
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"]),

  // ── Vector Search (cl-sdk 0.5.0+) ──

  // Document chunks for semantic search over extracted policy/quote content
  documentChunks: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    chunkId: v.string(), // SDK-assigned: "${docId}:${type}:${index}"
    chunkType: v.string(), // carrier_info, named_insured, coverage, endorsement, etc.
    text: v.string(), // chunk content for embedding + display
    metadata: v.optional(v.any()), // SDK metadata for filtering
    embedding: v.array(v.float64()), // 1536-dim vector (text-embedding-3-small)
    createdAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_chunkId", ["chunkId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["orgId"],
    }),

  // Conversation turns for cross-thread memory search
  conversationTurns: defineTable({
    orgId: v.id("organizations"),
    conversationId: v.string(), // thread ID or conversation ID
    role: v.string(), // user, assistant, tool
    content: v.string(),
    embedding: v.array(v.float64()), // 1536-dim vector
    createdAt: v.number(),
  })
    .index("by_conversationId", ["conversationId"])
    .index("by_orgId", ["orgId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["orgId"],
    }),

  policyAuditLog: defineTable({
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.any()), // legacy: may contain old quotes table IDs
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
    action: v.string(),
    detail: v.optional(v.string()),
    metadata: v.optional(v.any()),
  }).index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"]),

  // Web chat sessions with Prism
  webChats: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    createdBy: v.id("users"),
    lastMessageAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    initialContext: v.optional(v.object({
      pageType: v.string(),
      entityId: v.optional(v.string()),
      summary: v.optional(v.string()),
    })),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_lastMessageAt", ["orgId", "lastMessageAt"]),

  // Messages within web chat sessions
  webChatMessages: defineTable({
    chatId: v.id("webChats"),
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("agent")),
    content: v.string(),
    // Agent response metadata
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.any()), // legacy: may contain old quotes table IDs
    status: v.optional(v.union(v.literal("processing"), v.literal("error"))),
    error: v.optional(v.string()),
  }).index("by_chatId", ["chatId"]),

  agentConversations: defineTable({
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toAddresses: v.array(v.string()),
    ccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    bodyHtml: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    messageId: v.optional(v.string()),
    mode: v.union(v.literal("direct"), v.literal("cc"), v.literal("forward"), v.literal("unknown")),
    responseBody: v.optional(v.string()),
    responseHtml: v.optional(v.string()),
    responseTo: v.optional(v.string()),
    responseCc: v.optional(v.array(v.string())),
    responseSentAt: v.optional(v.number()),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.any()), // legacy: may contain old quotes table IDs
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("replied"),
      v.literal("error")
    ),
    error: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    threadId: v.optional(v.id("agentConversations")),
    responseMessageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    attachments: v.optional(v.array(v.object({
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      fileId: v.optional(v.id("_storage")),
    }))),
  }).index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"])
    .index("by_messageId", ["messageId"])
    .index("by_resendEmailId", ["resendEmailId"]),

  // ── Unified Threads ──

  threads: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    threadEmail: v.optional(v.string()),
    createdBy: v.id("users"),
    lastMessageAt: v.number(),
    archivedAt: v.optional(v.number()),
    initialContext: v.optional(v.object({
      pageType: v.string(),
      entityId: v.optional(v.string()),
      summary: v.optional(v.string()),
    })),
    legacyConversationId: v.optional(v.id("agentConversations")),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_lastMessageAt", ["orgId", "lastMessageAt"])
    .index("by_threadEmail", ["threadEmail"])
    .index("by_legacyConversationId", ["legacyConversationId"]),

  threadMessages: defineTable({
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    channel: v.union(v.literal("chat"), v.literal("email")),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    // User messages
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    // Email messages
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    toAddresses: v.optional(v.array(v.string())),
    ccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    messageId: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    // Content
    content: v.string(),
    contentHtml: v.optional(v.string()),
    // Reasoning / thinking content (for models that support it)
    reasoning: v.optional(v.string()),
    // Attachments
    attachments: v.optional(v.array(v.object({
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      fileId: v.optional(v.id("_storage")),
    }))),
    // Agent response metadata
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.any()), // legacy: may contain old quotes table IDs
    // Sections cited by the agent (titles captured from lookup_policy_section tool results)
    citedSections: v.optional(v.array(v.string())),
    // Status
    status: v.optional(v.union(
      v.literal("processing"),
      v.literal("error"),
      v.literal("pending_send"),
    )),
    error: v.optional(v.string()),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    // Legacy link
    legacyConversationId: v.optional(v.id("agentConversations")),
    legacyChatMessageId: v.optional(v.id("webChatMessages")),
  })
    .index("by_threadId", ["threadId"])
    .index("by_messageId", ["messageId"]),

  // ── Pending Emails (send delay queue) ──

  pendingEmails: defineTable({
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("cancelled")),
    emailPayload: v.string(), // JSON-serialized Resend payload
    scheduledSendTime: v.number(), // timestamp when it should actually send
    sentMessageId: v.optional(v.string()), // Resend message ID after send
    // For updating the chat message after send
    chatMessageId: v.optional(v.id("threadMessages")),
    // For updating legacy conversation after send
    legacyConversationId: v.optional(v.id("agentConversations")),
    // Metadata for the sent email record
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(), // plain content (for thread record)
    // For unified thread dual-write
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.any()), // legacy: may contain old quotes table IDs
  })
    .index("by_threadId", ["threadId"])
    .index("by_status", ["status"]),

  // ── Presence ──

  // API keys for MCP server authentication
  apiKeys: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    name: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(), // first 14 chars of key for display
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_keyHash", ["keyHash"])
    .index("by_orgId", ["orgId"]),

  // ── OAuth (MCP remote clients) ──

  oauthClients: defineTable({
    clientId: v.string(),
    clientName: v.string(),
    redirectUris: v.array(v.string()),
    tokenEndpointAuthMethod: v.string(), // "none" for public clients
    createdAt: v.number(),
  }).index("by_clientId", ["clientId"]),

  oauthAuthCodes: defineTable({
    codeHash: v.string(),
    clientId: v.string(),
    userId: v.id("users"),
    orgId: v.id("organizations"),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    scope: v.optional(v.string()),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_codeHash", ["codeHash"]),

  oauthTokens: defineTable({
    tokenHash: v.string(),
    refreshTokenHash: v.optional(v.string()),
    clientId: v.string(),
    userId: v.id("users"),
    orgId: v.id("organizations"),
    scope: v.optional(v.string()),
    expiresAt: v.number(),
    refreshExpiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_refreshTokenHash", ["refreshTokenHash"])
    .index("by_userId", ["userId"]),

  // ── Presence ──

  presence: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    pageKey: v.string(),
    userName: v.optional(v.string()),
    lastSeen: v.number(),
  })
    .index("by_pageKey", ["pageKey"])
    .index("by_userId", ["userId"]),
});
