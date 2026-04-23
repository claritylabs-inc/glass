import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { pipelineFields } from "@claritylabs/cl-pipelines/convex";

const addressObject = v.object({
  street1: v.string(),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
});

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
    // Onboarding & admin
    onboardingComplete: v.optional(v.boolean()),
    isAdmin: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

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
    // Client-org verification: which sender emails/domains count as "this client"
    // when routing inbound email sent to the broker's agent handle.
    allowedEmails: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    emailVerification: v.optional(
      v.union(v.literal("strict"), v.literal("domain"), v.literal("open")),
    ),
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
    // Branding
    iconStorageId: v.optional(v.id("_storage")),
    // Dual-org: org type discriminator
    type: v.optional(v.union(v.literal("broker"), v.literal("client"))),
    // Set on client orgs only — ID of the managing broker org
    brokerOrgId: v.optional(v.id("organizations")),
    // Client-org lifecycle: "draft" = broker is preparing, "invited" = invite sent and pending,
    // undefined = legacy/active (accepted or pre-dates this field).
    inviteStatus: v.optional(v.union(
      v.literal("draft"),
      v.literal("invited"),
    )),
    // Draft/invite contact details captured by broker before the client accepts.
    // Mirrored into clientPassport on accept.
    primaryContactName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    inviteCustomMessage: v.optional(v.string()),
    // Broker user who created the draft.
    draftCreatedByUserId: v.optional(v.id("users")),
    // Broker slug for URLs, [a-z0-9-]{3,40}, unique
    slug: v.optional(v.string()),
    // Broker branding
    brandingColor: v.optional(v.string()),  // hex e.g. "#4F46E5"
    brandingMode: v.optional(v.union(v.literal("light"), v.literal("dark"))),
    brandingTextOnAccent: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("auto"))),
    agentDisplayName: v.optional(v.string()),
    // Broker-org: which extended passport sections are required by default
    defaultRequiredPassportSections: v.optional(v.array(v.union(
      v.literal("prior_carrier"),
      v.literal("loss_history"),
      v.literal("additional_interests"),
      v.literal("transaction_info"),
    ))),
    // Client-org: per-client override of broker's default
    passportRequirementOverrides: v.optional(v.array(v.union(
      v.literal("prior_carrier"),
      v.literal("loss_history"),
      v.literal("additional_interests"),
      v.literal("transaction_info"),
    ))),
  })
    .index("by_agentHandle", ["agentHandle"])
    .index("by_type", ["type"])
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_slug", ["slug"]),

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

  // applicationSessions retired — use applications v2 (applications table)

  // ── Applications v2 ──────────────────────────────────────────────────────

  questionIntents: defineTable({
    intentKey: v.string(),
    label: v.string(),
    defaultPrompt: v.string(),
    answerType: v.union(
      v.literal("text"), v.literal("long_text"), v.literal("number"),
      v.literal("currency"), v.literal("percent"), v.literal("date"),
      v.literal("yes_no"), v.literal("select"), v.literal("multi_select"),
      v.literal("address"), v.literal("location_list"),
      v.literal("subsidiary_list"), v.literal("loss_list"),
      v.literal("file_upload"),
    ),
    selectOptions: v.optional(v.array(v.object({ value: v.string(), label: v.string() }))),
    passportFieldPath: v.optional(v.string()),
    integrationCandidates: v.optional(v.array(v.string())),
    category: v.union(
      v.literal("applicant_info"), v.literal("operations"), v.literal("financial"),
      v.literal("risk"), v.literal("history"), v.literal("coverage_preferences"),
      v.literal("supporting_docs"), v.literal("other"),
    ),
    validationHint: v.optional(v.string()),
  }).index("by_intentKey", ["intentKey"]),

  applications: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    createdByUserId: v.id("users"),
    assignedProducerId: v.optional(v.id("users")),
    creationPath: v.union(v.literal("ai"), v.literal("extracted_pdf")),
    title: v.string(),
    lineOfBusiness: v.optional(v.string()),
    aiGenerationPrompt: v.optional(v.string()),
    status: v.union(
      v.literal("draft"), v.literal("sent"), v.literal("in_progress"),
      v.literal("awaiting_review"), v.literal("complete"), v.literal("cancelled"),
    ),
    sentAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Pipeline fields for cl-pipelines phase-runner (extraction)
    ...pipelineFields(),
    // Prefill pipeline — second independent pipeline on the same table.
    // Hand-rolled with "prefill" prefix to avoid colliding with pipelineFields().
    prefillStatus: v.optional(v.union(
      v.literal("idle"), v.literal("running"), v.literal("paused"),
      v.literal("complete"), v.literal("error"),
    )),
    prefillError: v.optional(v.string()),
    prefillCheckpoint: v.optional(v.any()),
    prefillLog: v.optional(v.array(v.object({
      timestamp: v.number(),
      message: v.string(),
      phase: v.optional(v.string()),
      level: v.optional(v.string()),
    }))),
  })
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_clientOrgId", ["clientOrgId"])
    .index("by_clientOrgId_status", ["clientOrgId", "status"])
    .index("by_brokerOrgId_status", ["brokerOrgId", "status"]),

  applicationGroups: defineTable({
    applicationId: v.id("applications"),
    order: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    conditional: v.optional(v.any()),
    repeating: v.optional(v.object({
      source: v.union(
        v.literal("passport_locations"),
        v.literal("passport_subsidiaries"),
        v.literal("application_list"),
      ),
      minItems: v.optional(v.number()),
      maxItems: v.optional(v.number()),
    })),
    status: v.union(
      v.literal("not_started"), v.literal("in_progress"),
      v.literal("submitted"), v.literal("returned"), v.literal("accepted"),
    ),
    submittedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_applicationId", ["applicationId"])
    .index("by_applicationId_order", ["applicationId", "order"]),

  // Application templates — reusable intent graphs keyed by line of business
  // (and optionally carrier). Extraction can seed from a matching template to
  // run in "differential" mode and cut token spend.
  //
  // Share scope: `private` = owner user only, `org` = broker org (default),
  // `public` = Clarity-curated (e.g. ACORD 125/126/130/140).
  applicationTemplates: defineTable({
    name: v.string(),
    lineOfBusiness: v.string(),
    carrier: v.optional(v.string()),
    ownerOrgId: v.id("organizations"),
    createdByUserId: v.optional(v.id("users")),
    shareScope: v.union(
      v.literal("private"),
      v.literal("org"),
      v.literal("public"),
    ),
    // Canonical intent graph — see convex/lib/applicationIntentGraph.ts
    intentGraph: v.any(),
    // Fingerprint used for fast candidate lookup & match scoring.
    fingerprint: v.object({
      normalizedPrompts: v.array(v.string()),
      fieldTypeHistogram: v.array(
        v.object({ fieldType: v.string(), count: v.number() }),
      ),
      pageCount: v.optional(v.number()),
    }),
    // Rolling telemetry from extractions that matched this template. Updated
    // by the learning loop.
    stats: v.optional(
      v.object({
        matchCount: v.number(),
        lastMatchedAt: v.optional(v.number()),
        avgDeltaRatio: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerOrgId_line", ["ownerOrgId", "lineOfBusiness"])
    .index("by_line_carrier", ["lineOfBusiness", "carrier"])
    .index("by_shareScope_line", ["shareScope", "lineOfBusiness"]),

  // Telemetry row per extraction run. Powers the eval harness and the learning
  // loop. One row per application extraction attempt.
  applicationExtractionRuns: defineTable({
    applicationId: v.id("applications"),
    templateId: v.optional(v.id("applicationTemplates")),
    templateMatchScore: v.optional(v.number()),
    tokensUsed: v.number(),
    criticRounds: v.number(),
    qualityScore: v.optional(v.number()),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("capped"),
    ),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_applicationId", ["applicationId"])
    .index("by_templateId", ["templateId"]),

  applicationQuestions: defineTable({
    applicationId: v.id("applications"),
    groupId: v.id("applicationGroups"),
    order: v.number(),
    intentKey: v.optional(v.string()),
    prompt: v.string(),
    rawPrompt: v.optional(v.string()),
    answerType: v.string(),
    selectOptions: v.optional(v.array(v.object({ value: v.string(), label: v.string() }))),
    required: v.boolean(),
    conditional: v.optional(v.any()),
    repeating: v.optional(v.object({
      collectionKey: v.string(),
      itemLabel: v.string(),
      dependsOnQuestionId: v.optional(v.id("applicationQuestions")),
      minItems: v.optional(v.number()),
      maxItems: v.optional(v.number()),
    })),
    binding: v.optional(v.object({
      source: v.union(
        v.literal("manual"), v.literal("passport"),
        v.literal("integration"), v.literal("document"),
      ),
      target: v.optional(v.string()),
    })),
    helpText: v.optional(v.string()),
    placedByAi: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_applicationId", ["applicationId"])
    .index("by_groupId", ["groupId"])
    .index("by_groupId_order", ["groupId", "order"]),

  applicationAnswers: defineTable({
    applicationId: v.id("applications"),
    questionId: v.id("applicationQuestions"),
    rowKey: v.optional(v.string()),
    value: v.optional(v.any()),
    source: v.union(
      v.literal("manual"), v.literal("passport"),
      v.literal("integration"), v.literal("document"),
      v.literal("auto_prefill"),
    ),
    sourceRef: v.optional(v.string()),
    overrideOfIntegration: v.optional(v.object({
      connectorKey: v.string(),
      syncedValue: v.any(),
      syncedAt: v.number(),
      overriddenAt: v.number(),
    })),
    status: v.union(v.literal("answered"), v.literal("needs_new_answer")),
    answeredAt: v.number(),
    answeredByUserId: v.optional(v.id("users")),
  })
    .index("by_applicationId", ["applicationId"])
    .index("by_questionId", ["questionId"])
    .index("by_applicationId_questionId_rowKey", ["applicationId", "questionId", "rowKey"]),

  applicationQuestionFlags: defineTable({
    applicationId: v.id("applications"),
    groupId: v.id("applicationGroups"),
    questionId: v.id("applicationQuestions"),
    rowKey: v.optional(v.string()),
    flagType: v.union(v.literal("comment"), v.literal("needs_new_answer")),
    authorUserId: v.id("users"),
    message: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_applicationId", ["applicationId"])
    .index("by_questionId", ["questionId"])
    .index("by_groupId_status", ["groupId", "status"]),

  // ── End Applications v2 ───────────────────────────────────────────────────

  // ── Integrations (Subsystem 5) ───────────────────────────────────────────

  integrationConnections: defineTable({
    clientOrgId: v.id("organizations"),
    category: v.union(
      v.literal("accounting"),
      v.literal("hris"),
      v.literal("payroll"),
    ),
    mergeAccountTokenEncrypted: v.string(),
    mergeLinkedAccountId: v.string(),
    providerSlug: v.string(),
    providerDisplayName: v.string(),
    status: v.union(
      v.literal("connecting"),
      v.literal("active"),
      v.literal("reauth_required"),
      v.literal("disconnected"),
      v.literal("error"),
    ),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.union(
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
    )),
    lastSyncError: v.optional(v.string()),
    connectedByUserId: v.optional(v.id("users")),
    connectedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
    originatingApplicationId: v.optional(v.id("applications")),
    integrationRequestId: v.optional(v.id("integrationRequests")),
  })
    .index("by_clientOrgId", ["clientOrgId"])
    .index("by_clientOrgId_category", ["clientOrgId", "category"])
    .index("by_mergeLinkedAccountId", ["mergeLinkedAccountId"]),

  integrationData: defineTable({
    connectionId: v.id("integrationConnections"),
    clientOrgId: v.id("organizations"),
    metricKey: v.string(),
    value: v.any(),
    unit: v.optional(v.string()),
    asOfDate: v.optional(v.string()),
    period: v.optional(v.object({
      start: v.string(),
      end: v.string(),
      kind: v.union(
        v.literal("ytd"),
        v.literal("trailing_12"),
        v.literal("fiscal_year"),
        v.literal("calendar_year"),
        v.literal("quarter"),
        v.literal("month"),
      ),
    })),
    syncedAt: v.number(),
    mergeSourceRef: v.optional(v.string()),
  })
    .index("by_clientOrgId_metricKey", ["clientOrgId", "metricKey"])
    .index("by_connectionId", ["connectionId"]),

  integrationSyncLogs: defineTable({
    connectionId: v.id("integrationConnections"),
    clientOrgId: v.id("organizations"),
    trigger: v.union(
      v.literal("initial"),
      v.literal("webhook"),
      v.literal("scheduled"),
      v.literal("manual"),
    ),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("error"),
    ),
    metricsWritten: v.number(),
    error: v.optional(v.string()),
    startedAt: v.number(),
    durationMs: v.optional(v.number()),
  })
    .index("by_connectionId", ["connectionId"])
    .index("by_clientOrgId", ["clientOrgId"]),

  integrationRequests: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    category: v.union(
      v.literal("accounting"),
      v.literal("hris"),
      v.literal("payroll"),
    ),
    requestedByUserId: v.id("users"),
    message: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("fulfilled"),
      v.literal("dismissed"),
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_clientOrgId_status", ["clientOrgId", "status"])
    .index("by_brokerOrgId", ["brokerOrgId"]),

  // ── End Integrations ──────────────────────────────────────────────────────

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

  brokerClientAssignments: defineTable({
    orgId: v.id("organizations"),           // broker org
    clientOrgId: v.id("organizations"),     // client org
    producerId: v.id("users"),              // broker user
    role: v.union(v.literal("primary"), v.literal("secondary")),
    createdAt: v.number(),
  })
    .index("by_orgId_clientOrgId", ["orgId", "clientOrgId"])
    .index("by_orgId_producerId", ["orgId", "producerId"])
    .index("by_clientOrgId", ["clientOrgId"]),

  clientInvitations: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    prefillPassport: v.optional(v.any()),
    invitedBy: v.id("users"),
    inviteTokenHash: v.string(),
    linkType: v.union(v.literal("email"), v.literal("shareable")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("revoked"),
    ),
    clientOrgId: v.optional(v.id("organizations")),
    acceptedCount: v.optional(v.number()),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    // Permanent per-broker shareable link (one per broker org).
    // Stores raw token so the broker can copy it repeatedly.
    isPerma: v.optional(v.boolean()),
    rawToken: v.optional(v.string()),
  })
    .index("by_tokenHash", ["inviteTokenHash"])
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_status", ["status"])
    .index("by_brokerOrgId_isPerma", ["brokerOrgId", "isPerma"]),

  emailConnections: defineTable({
    ...pipelineFields(),
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
    sinceDate: v.optional(v.string()),
    returnTo: v.optional(v.string()),
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
    // Temporary compatibility for legacy rows. Run cleanup, then remove again.
    tags: v.optional(v.array(v.string())),
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

  // Uploaded org context documents — one row per file, persists regardless of extraction outcome
  orgDocuments: defineTable({
    ...pipelineFields(),
    orgId: v.id("organizations"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    // Deprecated — kept optional for migration. Remove after removeDeprecatedExtractionFields runs.
    extractionStatus: v.optional(v.string()),
    extractionError: v.optional(v.string()),
    entryCount: v.optional(v.number()),
    sourceLabel: v.optional(v.string()),
    documentType: v.optional(v.string()),
    asOfDate: v.optional(v.string()),
    documentDate: v.optional(v.string()),
    uploadedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    visibility: v.optional(v.union(v.literal("broker_visible"), v.literal("client_internal"))),
  })
    .index("by_orgId", ["orgId"])
    .index("by_storageId", ["storageId"]),

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
    .index("by_connection_date", ["connectionId", "date"])
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"]),

  policies: defineTable({
    ...pipelineFields(),
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    emailId: v.optional(v.id("emails")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    // Provenance — who uploaded and from which side
    uploadedBySide: v.optional(v.union(
      v.literal("broker"),
      v.literal("client"),
      v.literal("email_scan"),
    )),
    uploadedByUserId: v.optional(v.id("users")),
    uploadedByBrokerOrgId: v.optional(v.id("organizations")),
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
    // Dismissal flag — set when a policy row is dismissed/marked not-insurance.
    // Replaces the old extractionStatus: "not_insurance" value.
    dismissed: v.optional(v.boolean()),
    // Deprecated — kept optional for migration. Remove after removeDeprecatedExtractionFields runs.
    extractionStatus: v.optional(v.string()),
    extractionError: v.optional(v.string()),
    extractionCheckpoint: v.optional(v.any()),
    extractionLog: v.optional(v.any()),
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
    // ── Multi-file support ──
    // Denormalized lightweight file list for fast UI rendering (source of truth is policyFiles table)
    files: v.optional(v.array(v.object({
      fileId: v.id("_storage"),
      fileName: v.string(),
      fileType: v.string(), // declaration, wording, endorsement, schedule, renewal, certificate, unknown
      status: v.string(), // pending, extracting, complete, error, not_insurance
    }))),
    // Whether the reconciled view is up to date across all files
    reconciliationStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("reconciled"),
      v.literal("error"),
    )),
    reconciliationLog: v.optional(v.array(v.object({
      timestamp: v.number(),
      message: v.string(),
    }))),
    // Multiple source emails (additive to legacy emailId)
    emailIds: v.optional(v.array(v.id("emails"))),
  }).index("by_carrier", ["carrier"])
    .index("by_policyYear", ["policyYear"])
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"]),

  // ── Policy Files (multi-file support) ──

  // Each policy can have multiple source files (declaration, wording, endorsements, etc.)
  policyFiles: defineTable({
    ...pipelineFields(),
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    emailId: v.optional(v.id("emails")),
    fileName: v.string(),
    fileType: v.union(
      v.literal("declaration"),
      v.literal("wording"),
      v.literal("endorsement"),
      v.literal("schedule"),
      v.literal("renewal"),
      v.literal("certificate"),
      v.literal("unknown"),
    ),
    extractedData: v.optional(v.any()), // Raw per-file extraction result (InsuranceDocument)
    // Deprecated — kept optional for migration. Remove after removeDeprecatedExtractionFields runs.
    extractionStatus: v.optional(v.string()),
    extractionError: v.optional(v.string()),
    extractionLog: v.optional(v.any()),
    pageCount: v.optional(v.number()),
    createdAt: v.number(),
    orgId: v.id("organizations"),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_fileId", ["fileId"])
    .index("by_emailId", ["emailId"]),

  // ── Notifications ──

  notifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")), // null = org-wide
    type: v.union(
      // Existing glass types
      v.literal("merge_suggestion"),
      v.literal("coverage_gap"),
      v.literal("renewal_reminder"),
      v.literal("policy_lapsed"),
      v.literal("coverage_limit_concern"),
      v.literal("missing_coverage"),
      v.literal("carrier_rating_change"),
      v.literal("broker_action"),
      v.literal("extraction_complete"),
      v.literal("extraction_error"),
      v.literal("incomplete_extraction"),
      v.literal("stale_data"),
      v.literal("premium_anomaly"),
      v.literal("dream_insight"),
      // Broker-targeted (new)
      v.literal("client_invitation_accepted"),
      v.literal("client_onboarding_completed"),
      v.literal("application_submitted_by_client"),
      v.literal("application_completed_by_client"),
      v.literal("client_document_uploaded"),
      v.literal("integration_disconnected_for_client"),
      v.literal("integration_request_fulfilled"),
      v.literal("passport_flag_resolved_by_client"),
      // Client-targeted (new)
      v.literal("application_sent_by_broker"),
      v.literal("application_section_returned_by_broker"),
      v.literal("application_accepted_by_broker"),
      v.literal("passport_flag_raised_by_broker"),
      v.literal("integration_requested_by_broker"),
      v.literal("policy_delivered_by_broker"),
      v.literal("quote_delivered_by_broker"),
    ),
    title: v.string(),
    body: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    status: v.union(
      v.literal("unread"),
      v.literal("read"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
    actionType: v.optional(v.string()), // merge_policies, review_policy, renew_policy, etc.
    actionPayload: v.optional(v.any()), // e.g. {policyIds: [...]} for merge
    sourceRef: v.optional(v.any()), // what generated this: policyId, emailId, etc.
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // auto-dismiss after this date
    // Cross-org context
    relatedOrgId: v.optional(v.id("organizations")),
    // Coalesce fields
    coalesceKey: v.optional(v.string()),
    coalescedCount: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
    // Email delivery
    emailStatus: v.optional(v.union(
      v.literal("not_scheduled"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("suppressed_by_preference"),
      v.literal("failed"),
    )),
    emailSentAt: v.optional(v.number()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_orgId_type", ["orgId", "type"])
    .index("by_userId", ["userId"])
    .index("by_orgId_coalesceKey_status", ["orgId", "coalesceKey", "status"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    type: v.string(),    // matches notifications.type or "__all__"
    channel: v.union(v.literal("in_app"), v.literal("email")),
    enabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_userId_orgId", ["userId", "orgId"])
    .index("by_userId_orgId_type_channel", ["userId", "orgId", "type", "channel"]),

  // ── Client Passport (ACORD 125) ──

  clientPassport: defineTable({
    clientOrgId: v.id("organizations"),
    // Applicant info
    legalName: v.optional(v.string()),
    dba: v.optional(v.string()),
    entityType: v.optional(v.string()),
    fein: v.optional(v.string()),
    website: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactTitle: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    mailingAddress: v.optional(addressObject),
    // Nature of business
    businessDescription: v.optional(v.string()),
    naicsCode: v.optional(v.string()),
    sicCode: v.optional(v.string()),
    yearsInBusiness: v.optional(v.number()),
    yearEstablished: v.optional(v.number()),
    numberOfEmployees: v.optional(v.number()),
    annualRevenue: v.optional(v.string()),
    operationsSummary: v.optional(v.string()),
    // General info
    hasPriorBankruptcy: v.optional(v.boolean()),
    bankruptcyDetails: v.optional(v.string()),
    hasPriorCancellation: v.optional(v.boolean()),
    cancellationDetails: v.optional(v.string()),
    hasForeignOperations: v.optional(v.boolean()),
    foreignOperationsDetails: v.optional(v.string()),
    ownershipNotes: v.optional(v.string()),
    // Transaction / desired coverage profile
    desiredEffectiveDate: v.optional(v.string()),
    desiredPolicyTerm: v.optional(v.string()),
    desiredLinesOfBusiness: v.optional(v.array(v.string())),
    // Completion tracking
    coreCompletedAt: v.optional(v.number()),
    lastEditedAt: v.number(),
    lastEditedBy: v.optional(v.id("users")),
  }).index("by_clientOrgId", ["clientOrgId"]),

  passportFieldProvenance: defineTable({
    clientOrgId: v.id("organizations"),
    fieldPath: v.string(),
    source: v.union(
      v.literal("manual"),
      v.literal("invite"),
      v.literal("website"),
      v.literal("document"),
      v.literal("integration"),
      v.literal("broker"),
    ),
    confidence: v.union(v.literal("confirmed"), v.literal("suggested")),
    sourceRef: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
    suggestedValue: v.optional(v.any()),
    setAt: v.number(),
    setByUserId: v.optional(v.id("users")),
  }).index("by_clientOrgId", ["clientOrgId"])
    .index("by_clientOrgId_fieldPath", ["clientOrgId", "fieldPath"]),

  passportLocations: defineTable({
    clientOrgId: v.id("organizations"),
    number: v.number(),
    address: addressObject,
    description: v.optional(v.string()),
    occupancy: v.optional(v.string()),
    squareFootage: v.optional(v.number()),
    yearBuilt: v.optional(v.number()),
    constructionType: v.optional(v.string()),
    protectionClass: v.optional(v.string()),
    sprinklered: v.optional(v.boolean()),
    alarmType: v.optional(v.string()),
    buildingValue: v.optional(v.string()),
    contentsValue: v.optional(v.string()),
    businessIncomeValue: v.optional(v.string()),
  }).index("by_clientOrgId", ["clientOrgId"]),

  passportSubsidiaries: defineTable({
    clientOrgId: v.id("organizations"),
    name: v.string(),
    ownershipPct: v.optional(v.number()),
    entityType: v.optional(v.string()),
    description: v.optional(v.string()),
    naicsCode: v.optional(v.string()),
  }).index("by_clientOrgId", ["clientOrgId"]),

  passportPriorCarriers: defineTable({
    clientOrgId: v.id("organizations"),
    lineOfBusiness: v.optional(v.string()),
    carrierName: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    premium: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_clientOrgId", ["clientOrgId"]),

  passportLosses: defineTable({
    clientOrgId: v.id("organizations"),
    dateOfLoss: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
    claimNumber: v.optional(v.string()),
    description: v.optional(v.string()),
    amountPaid: v.optional(v.string()),
    amountReserved: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    sourceDocumentId: v.optional(v.id("orgDocuments")),
    confidence: v.optional(v.union(v.literal("confirmed"), v.literal("suggested"))),
  }).index("by_clientOrgId", ["clientOrgId"]),

  passportAdditionalInterests: defineTable({
    clientOrgId: v.id("organizations"),
    name: v.string(),
    role: v.union(
      v.literal("mortgagee"),
      v.literal("loss_payee"),
      v.literal("additional_insured"),
    ),
    address: v.optional(addressObject),
    relationship: v.optional(v.string()),
    scope: v.optional(v.string()),
  }).index("by_clientOrgId", ["clientOrgId"]),

  passportFieldFlags: defineTable({
    clientOrgId: v.id("organizations"),
    brokerOrgId: v.id("organizations"),
    fieldPath: v.string(),
    authorUserId: v.id("users"),
    message: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
    resolvedByUserId: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_clientOrgId", ["clientOrgId"])
    .index("by_clientOrgId_status", ["clientOrgId", "status"])
    .index("by_brokerOrgId", ["brokerOrgId"]),

  // ── Broker Activity ──

  brokerActivity: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    type: v.union(
      v.literal("invitation_accepted"),
      v.literal("onboarding_completed"),
      v.literal("document_uploaded"),
      v.literal("application_sent"),
      v.literal("application_batch_submitted"),
      v.literal("application_completed"),
      v.literal("policy_uploaded"),
      v.literal("policy_extraction_completed"),
      v.literal("notification_fired"),
    ),
    actorUserId: v.optional(v.id("users")),
    actorSide: v.union(v.literal("broker"), v.literal("client"), v.literal("system")),
    payload: v.optional(v.any()),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("by_brokerOrgId_createdAt", ["brokerOrgId", "createdAt"])
    .index("by_brokerOrgId_clientOrgId_createdAt", ["brokerOrgId", "clientOrgId", "createdAt"])
    .index("by_clientOrgId_createdAt", ["clientOrgId", "createdAt"]),

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

  // Web chat sessions with Glass
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
    visibility: v.optional(v.union(v.literal("broker_visible"), v.literal("client_internal"))),
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
    // Structured coverage names cited by the agent when tool results match policy coverages
    citedCoverageNames: v.optional(v.array(v.string())),
    // Tool names used while producing the response, in call order
    usedTools: v.optional(v.array(v.string())),
    // Exact tool calls made while producing the response
    toolCalls: v.optional(v.array(v.object({
      name: v.string(),
      input: v.optional(v.string()),
    }))),
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
    allowedScopes: v.optional(v.array(v.union(v.literal("read"), v.literal("write")))),
    description: v.optional(v.string()),
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
    scopes: v.optional(v.array(v.union(v.literal("read"), v.literal("write")))),
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
    scopes: v.optional(v.array(v.union(v.literal("read"), v.literal("write")))),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_refreshTokenHash", ["refreshTokenHash"])
    .index("by_userId", ["userId"]),

  // ── API Audit Log ──

  apiAuditLog: defineTable({
    requestId: v.string(),
    timestamp: v.number(),
    userId: v.id("users"),
    orgId: v.id("organizations"),
    method: v.string(),
    path: v.string(),
    status: v.number(),
    body: v.optional(v.string()),
    response: v.optional(v.string()),
    tokenId: v.id("oauthTokens"),
  }).index("by_orgId_timestamp", ["orgId", "timestamp"]),

  // ── Rate Limit Counters ──

  rateLimitCounters: defineTable({
    tokenId: v.id("oauthTokens"),
    windowStart: v.number(),
    count: v.number(),
    lastRequestMs: v.number(),
  }).index("by_tokenId", ["tokenId"]),

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
