import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { pipelineFields } from "@claritylabs/cl-pipelines/convex";

const modelProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("moonshot"),
  v.literal("deepseek"),
);

const modelRouteValidator = v.object({
  provider: modelProviderValidator,
  model: v.string(),
});

const webRetrievalProviderValidator = v.union(
  v.literal("exa"),
  v.literal("openai"),
  v.literal("google"),
  v.literal("anthropic"),
  v.literal("xai"),
);

const webRetrievalValidator = v.object({
  primary: webRetrievalProviderValidator,
  route: v.optional(modelRouteValidator),
});

const pipelineStatusValidator = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("complete"),
  v.literal("error"),
);

const notificationChannelValidator = v.union(
  v.literal("in_app"),
  v.literal("email"),
  v.literal("imessage"),
);

const policyDeliveryChannelValidator = v.union(
  v.literal("email"),
  v.literal("imessage"),
);

const policyDeliveryActionValidator = v.union(
  v.literal("auto_send"),
  v.literal("broker_review"),
  v.literal("do_not_send"),
);

const policyDeliveryStatusValidator = v.union(
  v.literal("queued"),
  v.literal("review_required"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("partially_sent"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("suppressed"),
  v.literal("cancelled"),
);

const policyDeliverySourceKindValidator = v.union(
  v.literal("policy"),
  v.literal("endorsement"),
);

const policyDeliveryRuleFiltersValidator = v.object({
  carriers: v.optional(v.array(v.string())),
  securities: v.optional(v.array(v.string())),
  underwriters: v.optional(v.array(v.string())),
  productLines: v.optional(v.array(v.string())),
  policyTypes: v.optional(v.array(v.string())),
});

const policyChangeStatusValidator = v.union(
  // Legacy statuses kept during widen-migrate-narrow.
  v.literal("draft"),
  v.literal("ready"),
  v.literal("accepted"),
  v.literal("needs_info"),
  v.literal("submitted"),
  v.literal("declined"),
  v.literal("cancelled"),
  // Simplified CLA-28 workflow statuses.
  v.literal("intake"),
  v.literal("ready_to_submit"),
  v.literal("waiting_for_endorsement"),
  v.literal("completed"),
);

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
    accountKind: v.optional(v.union(v.literal("customer"), v.literal("operator"))),
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
    clientsContext: v.optional(v.string()), // who the org's clients/customers are
    vendorsContext: v.optional(v.string()), // key vendors and service providers
    insuranceContext: v.optional(v.string()), // brokers, carriers, insurance relationships
    investorsContext: v.optional(v.string()), // investors, shareholders, funding
    partnersContext: v.optional(v.string()), // joint ventures, affiliates, partners
    // Client-org verification: which sender emails/domains count as "this client"
    // when routing inbound email sent to the broker's agent handle.
    allowedEmails: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    emailVerification: v.optional(
      v.union(v.literal("strict"), v.literal("domain"), v.literal("open")),
    ),
    // COI handling preference
    coiHandling: v.optional(
      v.union(v.literal("broker"), v.literal("member"), v.literal("ignore")),
    ),
    autoGenerateCoi: v.optional(v.boolean()), // when true, generate COI PDFs automatically on request
    policyChangeRequestsEnabled: v.optional(v.boolean()),
    certificateChangeRequestsEnabled: v.optional(v.boolean()),
    // Agent
    agentHandle: v.optional(v.string()),
    // Primary insurance contact for the org
    primaryInsuranceContactId: v.optional(v.id("users")),
    // Manual broker identity for standalone client orgs that are not connected
    // to a broker org.
    brokerCompanyName: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerContactEmail: v.optional(v.string()),
    brokerContactPhone: v.optional(v.string()),
    // Agent settings
    chatEmailNotifications: v.optional(v.boolean()), // send email notifications for chat responses in email threads
    autoSendEmails: v.optional(v.boolean()), // when false, drafted emails from chat require confirmation before sending
    bccRequesterOnAgentEmails: v.optional(v.boolean()), // default true: BCC requesting team member on outbound agent emails
    emailSendDelay: v.optional(v.number()), // seconds before sending emails (default 5, 0 = instant)
    // Onboarding
    onboardingComplete: v.optional(v.boolean()),
    // Internal operator lifecycle for operator-provisioned tenants. Missing legacy value means live.
    operatorStatus: v.optional(v.union(v.literal("onboarding"), v.literal("live"))),
    // Branding
    iconStorageId: v.optional(v.id("_storage")),
    // Dual-org: org type discriminator
    type: v.optional(v.union(v.literal("broker"), v.literal("client"), v.literal("partner"))),
    partnerKind: v.optional(v.literal("program_admin")),
    // Partner type — only meaningful when type === "broker"
    partnerType: v.optional(
      v.union(
        v.literal("broker"),
        v.literal("program_admin"),
        v.literal("carrier"),
        v.literal("other"),
      ),
    ),
    // Set on client orgs only — ID of the managing broker org
    brokerOrgId: v.optional(v.id("organizations")),
    // Client-org lifecycle: "draft" = broker is preparing, "invited" = invite sent and pending,
    // undefined = legacy/active (accepted or pre-dates this field).
    inviteStatus: v.optional(v.union(v.literal("draft"), v.literal("invited"))),
    // Draft/invite contact details captured by broker before the client accepts.
    primaryContactName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    inviteCustomMessage: v.optional(v.string()),
    // Broker user who created the draft.
    draftCreatedByUserId: v.optional(v.id("users")),
    // Broker slug for URLs, [a-z0-9-]{3,40}, unique
    slug: v.optional(v.string()),
    // Broker branding
    whiteLabelingEnabled: v.optional(v.boolean()),
    brandingColor: v.optional(v.string()), // hex e.g. "#4F46E5"
    brandingMode: v.optional(v.union(v.literal("light"), v.literal("dark"))),
    brandingTextOnAccent: v.optional(
      v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
    ),
    agentDisplayName: v.optional(v.string()),
  })
    .index("by_agentHandle", ["agentHandle"])
    .index("by_type", ["type"])
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_slug", ["slug"]),

  partnerPrograms: defineTable({
    partnerOrgId: v.id("organizations"),
    name: v.string(),
    aliases: v.array(v.string()),
    description: v.optional(v.string()),
    categoryLabels: v.optional(v.array(v.string())),
    securityPanel: v.optional(v.array(v.object({
      name: v.string(),
      participationPercent: v.number(),
    }))),
    defaultTemplateId: v.optional(v.id("coiTemplates")),
    approvalMode: v.optional(
      v.union(
        v.literal("auto_approve_all"),
        v.literal("require_approval_all"),
        v.literal("llm_review"),
      ),
    ),
    approvalRuleText: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_partnerOrgId", ["partnerOrgId"])
    .index("by_status", ["status"]),

  coiTemplates: defineTable({
    partnerOrgId: v.id("organizations"),
    programId: v.optional(v.id("partnerPrograms")),
    name: v.string(),
    templateKind: v.union(
      v.literal("standard_glass"),
      v.literal("custom_glass"),
      v.literal("pdf_overlay"),
    ),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    outputFileName: v.optional(v.string()),
    fieldMappings: v.optional(v.any()),
    certifiedNotice: v.optional(v.string()),
    fallbackToStandard: v.optional(v.boolean()),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_partnerOrgId", ["partnerOrgId"])
    .index("by_programId", ["programId"])
    .index("by_status", ["status"]),

  partnerProgramEmbeddings: defineTable({
    partnerOrgId: v.id("organizations"),
    programId: v.id("partnerPrograms"),
    matchText: v.string(),
    embedding: v.array(v.float64()),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_partnerOrgId", ["partnerOrgId"])
    .index("by_programId", ["programId"])
    .index("by_status", ["status"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["partnerOrgId", "status"],
    }),

  standingAuthorizations: defineTable({
    partnerOrgId: v.id("organizations"),
    programId: v.id("partnerPrograms"),
    templateId: v.id("coiTemplates"),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("revoked")),
    allowedPolicyTypes: v.optional(v.array(v.string())),
    allowedCoverageCodes: v.optional(v.array(v.string())),
    authorizationText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_partnerOrgId", ["partnerOrgId"])
    .index("by_programId", ["programId"])
    .index("by_templateId", ["templateId"])
    .index("by_status", ["status"]),

  // Org memberships — links users to orgs
  orgMemberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  })
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"])
    .index("by_orgId_userId", ["orgId", "userId"]),

  operatorAuthNonces: defineTable({
    nonce: v.string(),
    timestamp: v.number(),
    expiresAt: v.number(),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiresAt", ["expiresAt"]),

  operatorProfiles: defineTable({
    userId: v.id("users"),
    email: v.string(),
    role: v.union(v.literal("operator"), v.literal("owner")),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_status", ["status"]),

  operatorImpersonationSessions: defineTable({
    operatorUserId: v.id("users"),
    targetOrgId: v.id("organizations"),
    targetRole: v.union(v.literal("admin"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("ended")),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_operator_status", ["operatorUserId", "status"])
    .index("by_targetOrgId", ["targetOrgId"]),

  operatorAuditEvents: defineTable({
    operatorUserId: v.id("users"),
    type: v.union(
      v.literal("operator_bootstrap"),
      v.literal("broker_created"),
      v.literal("broker_status_changed"),
      v.literal("broker_launch_email_sent"),
      v.literal("client_created"),
      v.literal("client_status_changed"),
      v.literal("client_launch_email_sent"),
      v.literal("mga_created"),
      v.literal("mga_status_changed"),
      v.literal("mga_launch_email_sent"),
      v.literal("impersonation_started"),
      v.literal("impersonation_stopped"),
      v.literal("setup_write"),
    ),
    targetOrgId: v.optional(v.id("organizations")),
    targetUserId: v.optional(v.id("users")),
    summary: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_operatorUserId_createdAt", ["operatorUserId", "createdAt"])
    .index("by_targetOrgId_createdAt", ["targetOrgId", "createdAt"]),

  brokerModelSettings: defineTable({
    brokerOrgId: v.id("organizations"),
    providerKeys: v.optional(
      v.object({
        openai: v.optional(v.string()),
        anthropic: v.optional(v.string()),
        google: v.optional(v.string()),
        xai: v.optional(v.string()),
        mistral: v.optional(v.string()),
        cohere: v.optional(v.string()),
        moonshot: v.optional(v.string()),
        deepseek: v.optional(v.string()),
      }),
    ),
    routes: v.optional(
      v.object({
        chat: v.optional(modelRouteValidator),
        email_draft: v.optional(modelRouteValidator),
        email_reply: v.optional(modelRouteValidator),
        extraction: v.optional(modelRouteValidator),
        classification: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
        security: v.optional(modelRouteValidator),
        mailbox_coordinator: v.optional(modelRouteValidator),
        application_authoring: v.optional(modelRouteValidator),
        embeddings: v.optional(modelRouteValidator),
      }),
    ),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_brokerOrgId", ["brokerOrgId"]),

  globalModelSettings: defineTable({
    key: v.literal("default"),
    routes: v.optional(
      v.object({
        chat: v.optional(modelRouteValidator),
        email_draft: v.optional(modelRouteValidator),
        email_reply: v.optional(modelRouteValidator),
        extraction: v.optional(modelRouteValidator),
        classification: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
        security: v.optional(modelRouteValidator),
        mailbox_coordinator: v.optional(modelRouteValidator),
        application_authoring: v.optional(modelRouteValidator),
        embeddings: v.optional(modelRouteValidator),
      }),
    ),
    webRetrieval: v.optional(webRetrievalValidator),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  connectedEmailAccounts: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    scope: v.union(v.literal("user"), v.literal("org")),
    label: v.optional(v.string()),
    emailAddress: v.string(),
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
    username: v.string(),
    encryptedPassword: v.string(),
    encryptionKeyVersion: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("error"),
      v.literal("revoked"),
    ),
    lastError: v.optional(v.string()),
    lastTestedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_userId", ["userId"])
    .index("by_orgId_status", ["orgId", "status"]),

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
      v.literal("imessage"),
    ),
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.id("policies")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_type", ["orgId", "type"]),

  // Applications, passport, integrations, email-inbox, and org-documents tables
  // were removed as part of the v0.2.0 scope simplification. See git history.

  // Org invitations — pending invites
  orgInvitations: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_orgId", ["orgId"]),

  brokerClientAssignments: defineTable({
    orgId: v.id("organizations"), // broker org
    clientOrgId: v.id("organizations"), // client org
    producerId: v.id("users"), // broker user
    role: v.union(v.literal("primary"), v.literal("secondary")),
    contactNameOverride: v.optional(v.string()),
    contactEmailOverride: v.optional(v.string()),
    contactPhoneOverride: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_orgId_clientOrgId", ["orgId", "clientOrgId"])
    .index("by_orgId_producerId", ["orgId", "producerId"])
    .index("by_clientOrgId", ["clientOrgId"]),

  policyDeliverySettings: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.optional(v.id("organizations")),
    enabled: v.boolean(),
    channels: v.array(policyDeliveryChannelValidator),
    defaultAction: policyDeliveryActionValidator,
    deliverBeforeClientAcceptance: v.boolean(),
    copyInstructions: v.optional(v.string()),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_brokerOrgId_clientOrgId", ["brokerOrgId", "clientOrgId"]),

  policyDeliveryRules: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.optional(v.id("organizations")),
    name: v.string(),
    enabled: v.boolean(),
    priority: v.number(),
    filters: policyDeliveryRuleFiltersValidator,
    llmRuleText: v.optional(v.string()),
    action: policyDeliveryActionValidator,
    channels: v.optional(v.array(policyDeliveryChannelValidator)),
    copyInstructions: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_brokerOrgId_clientOrgId", ["brokerOrgId", "clientOrgId"])
    .index("by_brokerOrgId_priority", ["brokerOrgId", "priority"]),

  policyDeliveryJobs: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyFileId: v.optional(v.id("policyFiles")),
    sourceKind: policyDeliverySourceKindValidator,
    idempotencyKey: v.string(),
    status: policyDeliveryStatusValidator,
    action: policyDeliveryActionValidator,
    channels: v.array(policyDeliveryChannelValidator),
    ruleId: v.optional(v.id("policyDeliveryRules")),
    ruleName: v.optional(v.string()),
    decisionSummary: v.optional(v.string()),
    decisionDetails: v.optional(v.any()),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    emailSentAt: v.optional(v.number()),
    imessageSentAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brokerOrgId_status_updatedAt", ["brokerOrgId", "status", "updatedAt"])
    .index("by_clientOrgId_updatedAt", ["clientOrgId", "updatedAt"])
    .index("by_clientOrgId_status_updatedAt", ["clientOrgId", "status", "updatedAt"])
    .index("by_policyId", ["policyId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

  policyDeliveryAttempts: defineTable({
    jobId: v.id("policyDeliveryJobs"),
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    channel: policyDeliveryChannelValidator,
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_jobId", ["jobId"])
    .index("by_brokerOrgId_createdAt", ["brokerOrgId", "createdAt"])
    .index("by_clientOrgId_createdAt", ["clientOrgId", "createdAt"]),

  connectedOrgRelationships: defineTable({
    // A client/customer org can view selected insurance system-of-record data
    // from a vendor org after the vendor approves the relationship. This is
    // intentionally one directional and read-only; no org inherits onward
    // access from either side.
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("revoked"),
    ),
    requestedByUserId: v.id("users"),
    approvedByUserId: v.optional(v.id("users")),
    revokedByUserId: v.optional(v.id("users")),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clientOrgId", ["clientOrgId"])
    .index("by_vendorOrgId", ["vendorOrgId"])
    .index("by_clientOrgId_vendorOrgId", ["clientOrgId", "vendorOrgId"])
    .index("by_vendorOrgId_status", ["vendorOrgId", "status"])
    .index("by_clientOrgId_status", ["clientOrgId", "status"]),

  connectedOrgInvitations: defineTable({
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.optional(v.id("organizations")),
    relationshipId: v.optional(v.id("connectedOrgRelationships")),
    vendorEmail: v.string(),
    requestedByUserId: v.id("users"),
    inviteTokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("revoked"),
    ),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    otpCode: v.optional(v.string()),
    otpCodeExpiresAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["inviteTokenHash"])
    .index("by_clientOrgId", ["clientOrgId"])
    .index("by_vendorEmail", ["vendorEmail"])
    .index("by_vendorOrgId", ["vendorOrgId"]),

  requirementSourceDocuments: defineTable({
    orgId: v.id("organizations"),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: v.union(
      v.literal("lease_agreement"),
      v.literal("client_contract"),
      v.literal("vendor_requirements"),
      v.literal("other"),
    ),
    title: v.string(),
    sourceTextExcerpt: v.optional(v.string()),
    parserBackend: v.optional(
      v.union(
        v.literal("docling"),
        v.literal("pdfjs"),
        v.literal("mammoth"),
        v.literal("plain_text"),
      ),
    ),
    parserVersion: v.optional(v.string()),
    parsedAt: v.optional(v.number()),
    parsingMs: v.optional(v.number()),
    status: pipelineStatusValidator,
    pipelineError: v.optional(v.string()),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"]),

  insuranceRequirements: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    category: v.union(
      v.literal("general_liability"),
      v.literal("auto"),
      v.literal("workers_comp"),
      v.literal("umbrella"),
      v.literal("professional"),
      v.literal("cyber"),
      v.literal("property"),
      v.literal("other"),
    ),
    requirementText: v.string(),
    // Coverage-like fields mirror policies.coverages so requirement checks can
    // compare structured values instead of parsing unrelated schemas.
    name: v.optional(v.string()),
    coverageCode: v.optional(v.string()),
    limit: v.optional(v.string()),
    limitAmount: v.optional(v.number()),
    limitType: v.optional(v.string()),
    limitValueType: v.optional(v.string()),
    deductible: v.optional(v.string()),
    deductibleAmount: v.optional(v.number()),
    deductibleType: v.optional(v.string()),
    deductibleValueType: v.optional(v.string()),
    originalContent: v.optional(v.string()),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("bulk_import"),
        v.literal("lease_agreement"),
        v.literal("client_contract"),
        v.literal("vendor_requirements"),
        v.literal("other"),
      ),
    ),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
    appliesTo: v.union(
      v.literal("vendors"),
      v.literal("own_org"),
      v.literal("both"),
    ),
    minimumRequired: v.boolean(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"]),

  vendorComplianceChecks: defineTable({
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    relationshipId: v.id("connectedOrgRelationships"),
    requirementId: v.id("insuranceRequirements"),
    status: v.union(
      v.literal("met"),
      v.literal("missing"),
      v.literal("expiring_soon"),
      v.literal("expired"),
      v.literal("needs_review"),
    ),
    matchedPolicyIds: v.array(v.id("policies")),
    expiresAt: v.optional(v.string()),
    checkedAt: v.number(),
    checkedBy: v.union(
      v.literal("system"),
      v.literal("user"),
      v.literal("agent"),
    ),
    notes: v.optional(v.string()),
  })
    .index("by_clientOrgId", ["clientOrgId"])
    .index("by_vendorOrgId", ["vendorOrgId"])
    .index("by_relationshipId", ["relationshipId"])
    .index("by_requirementId", ["requirementId"])
    .index("by_clientOrgId_vendorOrgId", ["clientOrgId", "vendorOrgId"]),
  clientInvitations: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    prefillPassport: v.optional(v.any()),
    invitedBy: v.id("users"),
    inviteTokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("revoked"),
    ),
    clientOrgId: v.optional(v.id("organizations")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    otpCode: v.optional(v.string()),
    otpCodeExpiresAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["inviteTokenHash"])
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_status", ["status"]),

  policies: defineTable({
    ...pipelineFields(),
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    // Provenance — who uploaded and from which side
    uploadedBySide: v.optional(
      v.union(
        v.literal("broker"),
        v.literal("client"),
        v.literal("agent_email"),
      ),
    ),
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
    partnerOrgId: v.optional(v.id("organizations")),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    partnerMatchSource: v.optional(
      v.union(
        v.literal("alias"),
        v.literal("manual"),
        v.literal("standing_authorization"),
      ),
    ),
    brokerAgency: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerLicenseNumber: v.optional(v.string()),
    // Structured entity objects (cl-sdk 0.11+)
    insurer: v.optional(
      v.object({
        legalName: v.string(),
        naicNumber: v.optional(v.string()),
        amBestRating: v.optional(v.string()),
        amBestNumber: v.optional(v.string()),
        admittedStatus: v.optional(v.string()),
        stateOfDomicile: v.optional(v.string()),
      }),
    ),
    producer: v.optional(
      v.object({
        agencyName: v.string(),
        contactName: v.optional(v.string()),
        licenseNumber: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        address: v.optional(
          v.object({
            street1: v.string(),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
          }),
        ),
      }),
    ),
    lossPayees: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.string(),
          address: v.optional(
            v.object({
              street1: v.string(),
              street2: v.optional(v.string()),
              city: v.optional(v.string()),
              state: v.optional(v.string()),
              zip: v.optional(v.string()),
              country: v.optional(v.string()),
            }),
          ),
          relationship: v.optional(v.string()),
          scope: v.optional(v.string()),
        }),
      ),
    ),
    mortgageHolders: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.string(),
          address: v.optional(
            v.object({
              street1: v.string(),
              street2: v.optional(v.string()),
              city: v.optional(v.string()),
              state: v.optional(v.string()),
              zip: v.optional(v.string()),
              country: v.optional(v.string()),
            }),
          ),
          relationship: v.optional(v.string()),
          scope: v.optional(v.string()),
        }),
      ),
    ),
    priorPolicyNumber: v.optional(v.string()),
    programName: v.optional(v.string()),
    isPackage: v.optional(v.boolean()),
    // Insured details (cl-sdk 1.2+)
    insuredDba: v.optional(v.string()),
    insuredAddress: v.optional(
      v.object({
        street1: v.string(),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        country: v.optional(v.string()),
      }),
    ),
    insuredEntityType: v.optional(v.string()), // corporation, llc, partnership, etc.
    insuredFein: v.optional(v.string()),
    additionalNamedInsureds: v.optional(
      v.array(
        v.object({
          name: v.string(),
          relationship: v.optional(v.string()),
          address: v.optional(
            v.object({
              street1: v.string(),
              street2: v.optional(v.string()),
              city: v.optional(v.string()),
              state: v.optional(v.string()),
              zip: v.optional(v.string()),
              country: v.optional(v.string()),
            }),
          ),
        }),
      ),
    ),
    // Coverage structure (cl-sdk 1.2+)
    coverageForm: v.optional(v.string()), // occurrence, claims_made, accident
    retroactiveDate: v.optional(v.string()),
    effectiveTime: v.optional(v.string()),
    limits: v.optional(
      v.object({
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
        employersLiability: v.optional(
          v.object({
            eachAccident: v.string(),
            diseasePolicyLimit: v.string(),
            diseaseEachEmployee: v.string(),
          }),
        ),
        sublimits: v.optional(
          v.array(
            v.object({
              name: v.string(),
              limit: v.string(),
              appliesTo: v.optional(v.string()),
              deductible: v.optional(v.string()),
            }),
          ),
        ),
        sharedLimits: v.optional(
          v.array(
            v.object({
              description: v.string(),
              limit: v.string(),
              coverageParts: v.array(v.string()),
            }),
          ),
        ),
        defenseCostTreatment: v.optional(v.string()), // inside_limits, outside_limits, supplementary
      }),
    ),
    deductibles: v.optional(
      v.object({
        perClaim: v.optional(v.string()),
        perOccurrence: v.optional(v.string()),
        aggregateDeductible: v.optional(v.string()),
        selfInsuredRetention: v.optional(v.string()),
        corridorDeductible: v.optional(v.string()),
        waitingPeriod: v.optional(v.string()),
        appliesTo: v.optional(v.string()),
      }),
    ),
    // Locations, vehicles, classifications (cl-sdk 1.2+)
    locations: v.optional(
      v.array(
        v.object({
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
        }),
      ),
    ),
    vehicles: v.optional(
      v.array(
        v.object({
          number: v.number(),
          year: v.number(),
          make: v.string(),
          model: v.string(),
          vin: v.string(),
          costNew: v.optional(v.string()),
          statedValue: v.optional(v.string()),
          garageLocation: v.optional(v.number()),
          coverages: v.optional(
            v.array(
              v.object({
                type: v.string(),
                limit: v.optional(v.string()),
                deductible: v.optional(v.string()),
                included: v.boolean(),
              }),
            ),
          ),
          radius: v.optional(v.string()),
          vehicleType: v.optional(v.string()),
        }),
      ),
    ),
    classifications: v.optional(
      v.array(
        v.object({
          code: v.string(),
          description: v.string(),
          premiumBasis: v.string(),
          basisAmount: v.optional(v.string()),
          rate: v.optional(v.string()),
          premium: v.optional(v.string()),
          locationNumber: v.optional(v.number()),
        }),
      ),
    ),
    formInventory: v.optional(
      v.array(
        v.object({
          formNumber: v.string(),
          editionDate: v.optional(v.string()),
          title: v.optional(v.string()),
          formType: v.string(), // coverage, endorsement, declarations, application, notice, other
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    taxesAndFees: v.optional(
      v.array(
        v.object({
          name: v.string(),
          amount: v.string(),
          amountValue: v.optional(v.number()),
          type: v.optional(v.string()), // tax, fee, surcharge, assessment
          description: v.optional(v.string()),
        }),
      ),
    ),
    premiumBreakdown: v.optional(
      v.array(
        v.object({
          line: v.string(),
          amount: v.string(),
          amountValue: v.optional(v.number()),
        }),
      ),
    ),
    // Policy metadata
    policyNumber: v.string(),
    policyTypes: v.array(v.string()),
    documentType: v.optional(v.union(v.literal("policy"), v.literal("quote"))),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(
      v.object({
        name: v.string(),
        coverageCode: v.optional(v.string()),
        formEditionDate: v.optional(v.string()),
        limit: v.optional(v.string()),
        limitAmount: v.optional(v.number()),
        limitType: v.optional(v.string()),
        limitValueType: v.optional(v.string()),
        deductible: v.optional(v.string()),
        deductibleAmount: v.optional(v.number()),
        deductibleType: v.optional(v.string()),
        deductibleValueType: v.optional(v.string()),
        formNumber: v.optional(v.string()),
        sir: v.optional(v.string()),
        sublimit: v.optional(v.string()),
        coinsurance: v.optional(v.string()),
        valuation: v.optional(v.string()),
        territory: v.optional(v.string()),
        trigger: v.optional(v.string()),
        retroactiveDate: v.optional(v.string()),
        included: v.optional(v.boolean()),
        coveragePremium: v.optional(v.string()),
        premium: v.optional(v.string()),
        pageNumber: v.optional(v.number()),
        resolvedFromPage: v.optional(v.number()),
        sectionRef: v.optional(v.string()),
        originalContent: v.optional(v.string()),
        resolvedOriginalContent: v.optional(v.string()),
        recordId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        extractionReviewStatus: v.optional(v.string()),
        extractionReviewReason: v.optional(v.string()),
        reviewSourceSpanIds: v.optional(v.array(v.string())),
      }),
    ),
    premium: v.optional(v.string()),
    premiumAmount: v.optional(v.number()),
    totalCost: v.optional(v.string()),
    totalCostAmount: v.optional(v.number()),
    insuredName: v.string(),
    summary: v.optional(v.string()),
    // Provenance — page references for key metadata
    metadataSource: v.optional(
      v.object({
        carrierPage: v.optional(v.number()),
        policyNumberPage: v.optional(v.number()),
        premiumPage: v.optional(v.number()),
        effectiveDatePage: v.optional(v.number()),
      }),
    ),
    // Full document structure with provenance
    // Extracted document structure (sections, endorsements, conditions, etc.)
    // Uses v.any() because the cl-sdk document schema evolves frequently
    document: v.optional(v.any()),
    // Dismissal flag — set when a policy row is dismissed/marked not-insurance.
    // Replaces the old extractionStatus: "not_insurance" value.
    dismissed: v.optional(v.boolean()),
    // Typed declarations (cl-sdk 1.4+) — line-specific structured data
    declarations: v.optional(v.any()),
    // AI analysis results (risk notes, observations, key findings)
    analysis: v.optional(v.any()),
    // cl-sdk 3.0+ fields
    policyTermType: v.optional(v.string()),
    nextReviewDate: v.optional(v.string()),
    minPremium: v.optional(v.string()),
    minPremiumAmount: v.optional(v.number()),
    depositPremium: v.optional(v.string()),
    depositPremiumAmount: v.optional(v.number()),
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
    enrichedSubjectivities: v.optional(v.any()),
    enrichedUnderwritingConditions: v.optional(v.any()),
    warrantyRequirements: v.optional(v.any()),
    // Supplementary extraction (cl-sdk 0.13+) — extra facts not captured by structured extractors
    supplementaryFacts: v.optional(
      v.array(
        v.object({
          key: v.string(),
          value: v.string(),
          subject: v.optional(v.string()),
          context: v.optional(v.string()),
        }),
      ),
    ),
    extractionReview: v.optional(v.any()),
    deletedAt: v.optional(v.number()),
    isDemo: v.optional(v.boolean()),
    // When true, this policy's chunks are excluded from vector search results
    excludeFromSearch: v.optional(v.boolean()),
    // ── Multi-file support ──
    // Denormalized lightweight file list for fast UI rendering (source of truth is policyFiles table)
    files: v.optional(
      v.array(
        v.object({
          fileId: v.id("_storage"),
          fileName: v.string(),
          fileType: v.string(), // declaration, wording, endorsement, schedule, renewal, certificate, unknown
          status: v.string(), // pending, extracting, complete, error, not_insurance
        }),
      ),
    ),
    // Whether the reconciled view is up to date across all files
    reconciliationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("reconciled"),
        v.literal("error"),
      ),
    ),
    reconciliationLog: v.optional(
      v.array(
        v.object({
          timestamp: v.number(),
          message: v.string(),
        }),
      ),
    ),
  })
    .index("by_carrier", ["carrier"])
    .index("by_policyYear", ["policyYear"])
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"])
    .index("by_partnerOrgId", ["partnerOrgId"]),

  // Runtime state for policy extraction. Keep high-churn logs, leases, and
  // large resumable checkpoints off the policy document itself.
  policyExtractionRuns: defineTable({
    policyId: v.id("policies"),
    pipelineStatus: pipelineStatusValidator,
    pipelineError: v.optional(v.string()),
    // Compact checkpoint only. Large payloads are stored as files referenced by
    // policyExtractionArtifacts so heartbeats and logs rewrite small documents.
    pipelineCheckpoint: v.optional(v.any()),
    pipelineLog: v.optional(
      v.array(
        v.object({
          timestamp: v.number(),
          message: v.string(),
          phase: v.optional(v.string()),
          level: v.optional(v.string()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_pipelineStatus_updatedAt", ["pipelineStatus", "updatedAt"]),

  // Storage-backed transient extraction artifacts. These records point at JSON
  // blobs in Convex file storage for cl-sdk checkpoints and pre-embedding
  // chunk/source-span payloads. They are cleaned up on success/cancel/restart.
  policyExtractionArtifacts: defineTable({
    policyId: v.id("policies"),
    kind: v.union(
      v.literal("cl_sdk_checkpoint"),
      v.literal("embedding_payload"),
    ),
    storageId: v.id("_storage"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_policyId_kind", ["policyId", "kind"]),

  policyExtractionTraceSessions: defineTable({
    traceId: v.string(),
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    sourceKind: v.optional(v.string()),
    trigger: v.optional(v.string()),
    fileName: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
    totalDurationMs: v.optional(v.number()),
    modelCallCount: v.optional(v.number()),
    modelDurationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    slowestLabel: v.optional(v.string()),
    slowestKind: v.optional(v.string()),
    slowestDurationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_traceId", ["traceId"])
    .index("by_startedAt", ["startedAt"])
    .index("by_status_startedAt", ["status", "startedAt"])
    .index("by_orgId_startedAt", ["orgId", "startedAt"])
    .index("by_policyId_startedAt", ["policyId", "startedAt"])
    .index("by_expiresAt", ["expiresAt"]),

  policyExtractionTraceEvents: defineTable({
    traceId: v.string(),
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("session"),
      v.literal("phase"),
      v.literal("log"),
      v.literal("model_call"),
      v.literal("embedding_batch"),
      v.literal("worker"),
      v.literal("artifact"),
    ),
    timestamp: v.number(),
    phase: v.optional(v.string()),
    level: v.optional(v.string()),
    message: v.optional(v.string()),
    label: v.optional(v.string()),
    task: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    attempt: v.optional(v.number()),
    status: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    details: v.optional(v.any()),
    expiresAt: v.number(),
  })
    .index("by_traceId_timestamp", ["traceId", "timestamp"])
    .index("by_policyId_timestamp", ["policyId", "timestamp"])
    .index("by_expiresAt", ["expiresAt"]),

  // ── Policy Files (multi-file support) ──

  // Each policy can have multiple source files (declaration, wording, endorsements, etc.)
  policyFiles: defineTable({
    ...pipelineFields(),
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
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
    pageCount: v.optional(v.number()),
    createdAt: v.number(),
    orgId: v.id("organizations"),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_fileId", ["fileId"]),

  certificates: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    source: v.optional(
      v.union(
        v.literal("policy_page"),
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("sms"),
        v.literal("api"),
        v.literal("mcp"),
        v.literal("agent"),
        v.literal("unknown"),
      ),
    ),
    createdByUserId: v.optional(v.id("users")),
    authorityType: v.optional(v.union(v.literal("non_binding"), v.literal("certified"))),
    certificationStatus: v.optional(
      v.union(
        v.literal("not_applicable"),
        v.literal("pending"),
        v.literal("certified"),
        v.literal("declined"),
      ),
    ),
    partnerOrgId: v.optional(v.id("organizations")),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    standingAuthorizationId: v.optional(v.id("standingAuthorizations")),
    approvalId: v.optional(v.id("certificateApprovals")),
    approvalMode: v.optional(
      v.union(
        v.literal("auto_approve_all"),
        v.literal("require_approval_all"),
        v.literal("llm_review"),
      ),
    ),
    approvalAudit: v.optional(v.any()),
    disclaimer: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_fileId", ["fileId"])
    .index("by_partnerOrgId", ["partnerOrgId"]),

  certificateRequestHolds: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(v.array(v.string())),
    source: v.optional(
      v.union(
        v.literal("policy_page"),
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("sms"),
        v.literal("api"),
        v.literal("mcp"),
        v.literal("agent"),
        v.literal("unknown"),
      ),
    ),
    status: v.union(
      v.literal("held"),
      v.literal("policy_change_opened"),
      v.literal("broker_handoff_offered"),
      v.literal("resolved"),
      v.literal("cancelled"),
    ),
    reasonCode: v.union(
      v.literal("policy_change_required"),
      v.literal("missing_policy_evidence"),
      v.literal("ambiguous_policy_evidence"),
      v.literal("conflicting_policy_evidence"),
    ),
    reasonMessage: v.string(),
    requiredChanges: v.array(v.string()),
    evidence: v.optional(v.any()),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_policyChangeCaseId", ["policyChangeCaseId"])
    .index("by_status", ["status"]),

  certificateRequests: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    partnerOrgId: v.id("organizations"),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    source: v.optional(
      v.union(
        v.literal("policy_page"),
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("sms"),
        v.literal("api"),
        v.literal("mcp"),
        v.literal("agent"),
        v.literal("unknown"),
      ),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("cancelled"),
    ),
    createdByUserId: v.optional(v.id("users")),
    approvalId: v.optional(v.id("certificateApprovals")),
    certificateId: v.optional(v.id("certificates")),
    matchCandidates: v.optional(v.any()),
    approvalMode: v.optional(
      v.union(
        v.literal("auto_approve_all"),
        v.literal("require_approval_all"),
        v.literal("llm_review"),
      ),
    ),
    approvalAudit: v.optional(v.any()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_partnerOrgId_status", ["partnerOrgId", "status"])
    .index("by_status", ["status"]),

  certificateApprovals: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    requestId: v.optional(v.id("certificateRequests")),
    certificateId: v.optional(v.id("certificates")),
    partnerOrgId: v.id("organizations"),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    standingAuthorizationId: v.optional(v.id("standingAuthorizations")),
    approvalType: v.union(v.literal("human"), v.literal("standing_authorization")),
    status: v.union(v.literal("approved"), v.literal("declined")),
    approvedByUserId: v.optional(v.id("users")),
    approvalMode: v.optional(
      v.union(
        v.literal("auto_approve_all"),
        v.literal("require_approval_all"),
        v.literal("llm_review"),
      ),
    ),
    audit: v.optional(v.any()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    approvedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_partnerOrgId", ["partnerOrgId"])
    .index("by_certificateId", ["certificateId"])
    .index("by_requestId", ["requestId"]),

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
      // Broker/client lifecycle
      v.literal("client_invitation_accepted"),
      v.literal("client_onboarding_completed"),
      v.literal("client_document_uploaded"),
      v.literal("policy_delivered_by_broker"),
      v.literal("quote_delivered_by_broker"),
      v.literal("vendor_compliance_met"),
      v.literal("vendor_compliance_gap"),
      v.literal("vendor_policy_expiring"),
      v.literal("vendor_policy_expired"),
      v.literal("program_admin_certificate_request"),
      v.literal("program_admin_pce_request"),
      v.literal("policy_declaration_discrepancy"),
      v.literal("policy_change_needs_info"),
      v.literal("policy_change_completed"),
    ),
    title: v.string(),
    body: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
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
    emailStatus: v.optional(
      v.union(
        v.literal("not_scheduled"),
        v.literal("scheduled"),
        v.literal("sent"),
        v.literal("suppressed_by_preference"),
        v.literal("failed"),
      ),
    ),
    emailSentAt: v.optional(v.number()),
    imessageStatus: v.optional(
      v.union(
        v.literal("not_scheduled"),
        v.literal("scheduled"),
        v.literal("sent"),
        v.literal("suppressed_by_preference"),
        v.literal("failed"),
      ),
    ),
    imessageSentAt: v.optional(v.number()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_orgId_type", ["orgId", "type"])
    .index("by_userId", ["userId"])
    .index("by_orgId_coalesceKey_status", ["orgId", "coalesceKey", "status"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    type: v.string(), // matches notifications.type or "__all__"
    channel: notificationChannelValidator,
    enabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_userId_orgId", ["userId", "orgId"])
    .index("by_userId_orgId_type_channel", [
      "userId",
      "orgId",
      "type",
      "channel",
    ]),

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
    actorSide: v.union(
      v.literal("broker"),
      v.literal("client"),
      v.literal("system"),
    ),
    payload: v.optional(v.any()),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("by_brokerOrgId_createdAt", ["brokerOrgId", "createdAt"])
    .index("by_brokerOrgId_clientOrgId_createdAt", [
      "brokerOrgId",
      "clientOrgId",
      "createdAt",
    ])
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

  // Raw source spans from PDFs, emails, attachments, and manual notes.
  // These are stable evidence units used to ground exact policy values.
  sourceSpans: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    spanId: v.string(),
    documentId: v.string(),
    sourceKind: v.union(
      v.literal("policy_pdf"),
      v.literal("application_pdf"),
      v.literal("email"),
      v.literal("attachment"),
      v.literal("manual_note"),
    ),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    sectionId: v.optional(v.string()),
    formNumber: v.optional(v.string()),
    text: v.string(),
    textHash: v.string(),
    bbox: v.optional(v.any()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_spanId", ["spanId"])
    .index("by_policyId_spanId", ["policyId", "spanId"]),

  // Embedded chunks over source spans. Unlike documentChunks, these preserve
  // sourceSpanIds so exact policy facts can cite the raw evidence unit.
  sourceChunks: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    chunkId: v.string(),
    documentId: v.string(),
    sourceSpanIds: v.array(v.string()),
    text: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.array(v.float64()),
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

  policyChangeCases: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    sourceKind: v.union(
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("mcp"),
      v.literal("cli"),
      v.literal("uploaded_document"),
      v.literal("manual"),
    ),
    status: policyChangeStatusValidator,
    summary: v.optional(v.string()),
    affectedPolicyIds: v.optional(v.array(v.id("policies"))),
    pendingQuestions: v.optional(v.array(v.string())),
    internalPceAnalysis: v.optional(v.any()),
    brokerSubmission: v.optional(v.any()),
    completion: v.optional(v.any()),
    items: v.optional(v.any()),
    impacts: v.optional(v.any()),
    missingInfoQuestions: v.optional(v.any()),
    validationIssues: v.optional(v.any()),
    evidenceSourceIds: v.optional(v.array(v.string())),
    packetId: v.optional(v.id("pcePackets")),
    partnerOrgId: v.optional(v.id("organizations")),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    partnerApprovalStatus: v.optional(
      v.union(
        v.literal("not_required"),
        v.literal("pending"),
        v.literal("approved"),
        v.literal("declined"),
      ),
    ),
    partnerApprovedByUserId: v.optional(v.id("users")),
    partnerApprovedAt: v.optional(v.number()),
    stagedPolicyUpdate: v.optional(v.any()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_partnerOrgId_approval", ["partnerOrgId", "partnerApprovalStatus"]),

  policyUpdateRuns: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    caseId: v.optional(v.id("policyChangeCases")),
    sourcePolicyFileIds: v.optional(v.array(v.id("policyFiles"))),
    sourceFileIds: v.optional(v.array(v.id("_storage"))),
    updateMode: v.union(v.literal("append_to_existing")),
    status: v.union(
      v.literal("pending"),
      v.literal("complete"),
      v.literal("needs_review"),
      v.literal("error"),
    ),
    beforeSnapshot: v.optional(v.any()),
    afterSnapshot: v.optional(v.any()),
    fieldDiffs: v.optional(v.array(v.any())),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_caseId", ["caseId"])
    .index("by_status", ["status"]),

  policyDeclarationFacts: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyFileId: v.optional(v.id("policyFiles")),
    fieldPath: v.string(),
    fieldGroup: v.string(),
    displayValue: v.string(),
    normalizedValue: v.string(),
    valueKind: v.union(
      v.literal("string"),
      v.literal("number"),
      v.literal("date"),
      v.literal("money"),
      v.literal("address"),
      v.literal("list"),
      v.literal("unknown"),
    ),
    sourceSpanIds: v.optional(v.array(v.string())),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    observedAt: v.number(),
    active: v.boolean(),
    recordHash: v.string(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_orgId_fieldGroup", ["orgId", "fieldGroup"])
    .index("by_policyId_active", ["policyId", "active"])
    .index("by_recordHash", ["recordHash"]),

  declarationDiscrepancies: defineTable({
    orgId: v.id("organizations"),
    fieldGroup: v.string(),
    likelyCurrentValue: v.optional(v.string()),
    question: v.optional(v.string()),
    plainLanguageSummary: v.optional(v.string()),
    recommendedAction: v.optional(v.string()),
    conflictingValues: v.array(v.any()),
    affectedPolicyIds: v.array(v.id("policies")),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    status: v.union(
      v.literal("open"),
      v.literal("notified"),
      v.literal("confirmed"),
      v.literal("dismissed"),
      v.literal("case_created"),
    ),
    notificationId: v.optional(v.id("notifications")),
    threadId: v.optional(v.id("threads")),
    caseId: v.optional(v.id("policyChangeCases")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_orgId_fieldGroup", ["orgId", "fieldGroup"]),

  pcePackets: defineTable({
    orgId: v.id("organizations"),
    caseId: v.id("policyChangeCases"),
    policyId: v.optional(v.id("policies")),
    artifacts: v.any(),
    validationIssues: v.optional(v.any()),
    createdAt: v.number(),
    submittedAt: v.optional(v.number()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_caseId", ["caseId"])
    .index("by_policyId", ["policyId"]),

  caseMessages: defineTable({
    orgId: v.id("organizations"),
    caseId: v.id("policyChangeCases"),
    direction: v.union(
      v.literal("inbound"),
      v.literal("outbound"),
      v.literal("system"),
    ),
    channel: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("mcp"),
        v.literal("cli"),
        v.literal("uploaded_document"),
        v.literal("manual"),
      ),
    ),
    content: v.string(),
    sourceSpanIds: v.optional(v.array(v.string())),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_caseId", ["caseId"])
    .index("by_orgId", ["orgId"]),

  caseEvidenceLinks: defineTable({
    orgId: v.id("organizations"),
    caseId: v.id("policyChangeCases"),
    itemId: v.optional(v.string()),
    sourceSpanId: v.string(),
    quote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_caseId", ["caseId"])
    .index("by_sourceSpanId", ["sourceSpanId"])
    .index("by_orgId", ["orgId"]),

  caseValidationReports: defineTable({
    orgId: v.id("organizations"),
    caseId: v.id("policyChangeCases"),
    status: v.union(
      v.literal("passed"),
      v.literal("warning"),
      v.literal("failed"),
    ),
    issues: v.any(),
    createdAt: v.number(),
  })
    .index("by_caseId", ["caseId"])
    .index("by_orgId", ["orgId"]),

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
    quoteId: v.optional(v.id("policies")),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
    action: v.string(),
    detail: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"]),

  // ── Unified Threads ──

  threads: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    threadEmail: v.optional(v.string()),
    deliveryContactKey: v.optional(v.string()),
    createdBy: v.id("users"),
    clientMutationId: v.optional(v.string()),
    lastMessageAt: v.number(),
    archivedAt: v.optional(v.number()),
    originChannel: v.optional(
      v.union(v.literal("chat"), v.literal("email"), v.literal("imessage")),
    ),
    emailMode: v.optional(
      v.union(
        v.literal("direct"),
        v.literal("cc"),
        v.literal("forward"),
        v.literal("unknown"),
      ),
    ),
    initialContext: v.optional(
      v.object({
        pageType: v.string(),
        entityId: v.optional(v.string()),
        summary: v.optional(v.string()),
      }),
    ),
    visibility: v.optional(
      v.union(v.literal("broker_visible"), v.literal("client_internal")),
    ),
    threadPhone: v.optional(v.string()),
    imessageChatGuid: v.optional(v.string()),
    imessageIsGroup: v.optional(v.boolean()),
    imessageScope: v.optional(
      v.union(v.literal("single_org"), v.literal("multi_org")),
    ),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_lastMessageAt", ["orgId", "lastMessageAt"])
    .index("by_orgId_clientMutationId", ["orgId", "clientMutationId"])
    .index("by_threadEmail", ["threadEmail"])
    .index("by_threadPhone", ["threadPhone"])
    .index("by_orgId_threadPhone", ["orgId", "threadPhone"])
    .index("by_orgId_deliveryContactKey", ["orgId", "deliveryContactKey"])
    .index("by_imessageChatGuid", ["imessageChatGuid"])
    .index("by_orgId_imessageChatGuid", ["orgId", "imessageChatGuid"]),

  threadMessages: defineTable({
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    clientMutationId: v.optional(v.string()),
    channel: v.union(
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
    ),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    // User messages
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    imessageSenderAddress: v.optional(v.string()),
    imessageParticipantLabel: v.optional(v.string()),
    // Email messages
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    toAddresses: v.optional(v.array(v.string())),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    messageId: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    // Content
    content: v.string(),
    contentHtml: v.optional(v.string()),
    // Reasoning / thinking content (for models that support it)
    reasoning: v.optional(v.string()),
    // Attachments
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.optional(v.id("_storage")),
        }),
      ),
    ),
    // Agent response metadata
    replyToMessageId: v.optional(v.id("threadMessages")),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
    referencedRequirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    referencedMailboxIds: v.optional(v.array(v.id("connectedEmailAccounts"))),
    // Sections cited by the agent (titles captured from lookup_policy_section tool results)
    citedSections: v.optional(v.array(v.string())),
    // Structured coverage names cited by the agent when tool results match policy coverages
    citedCoverageNames: v.optional(v.array(v.string())),
    // Stable raw source spans cited by lookup_policy_section tool results
    citedSourceSpanIds: v.optional(v.array(v.string())),
    // Tool names used while producing the response, in call order
    usedTools: v.optional(v.array(v.string())),
    // Exact tool calls made while producing the response
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    toolArtifacts: v.optional(
      v.array(
        v.object({
          type: v.string(),
          data: v.any(),
        }),
      ),
    ),
    // Status
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("error"),
        v.literal("pending_send"),
        v.literal("draft_email"),
        v.literal("cancelled"),
      ),
    ),
    agentRunStartedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
  })
    .index("by_threadId", ["threadId"])
    .index("by_orgId_clientMutationId", ["orgId", "clientMutationId"])
    .index("by_messageId", ["messageId"])
    .index("by_responseMessageId", ["responseMessageId"])
    .index("by_resendEmailId", ["resendEmailId"])
    .index("by_replyToMessageId", ["replyToMessageId"]),

  imessageInboundEvents: defineTable({
    eventKey: v.string(),
    fromPhone: v.string(),
    chatGuid: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    messageText: v.string(),
    sourceMessageId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error"),
    ),
    response: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventKey", ["eventKey"])
    .index("by_fromPhone", ["fromPhone"]),

  imessageOutboundSends: defineTable({
    idempotencyKey: v.string(),
    orgId: v.optional(v.id("organizations")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_threadMessageId", ["threadMessageId"]),

  imessageChats: defineTable({
    chatGuid: v.string(),
    isGroup: v.boolean(),
    status: v.union(v.literal("active"), v.literal("left")),
    primaryOrgId: v.optional(v.id("organizations")),
    title: v.optional(v.string()),
    participantCount: v.number(),
    lastParticipantSyncAt: v.number(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_chatGuid", ["chatGuid"])
    .index("by_primaryOrgId", ["primaryOrgId"]),

  imessageParticipants: defineTable({
    chatGuid: v.string(),
    address: v.string(),
    displayName: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    role: v.union(v.literal("linked"), v.literal("anonymous")),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_chatGuid", ["chatGuid"])
    .index("by_address", ["address"])
    .index("by_chatGuid_address", ["chatGuid", "address"])
    .index("by_userId", ["userId"]),

  // ── Pending Emails (send delay queue) ──

  pendingEmails: defineTable({
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("sent"),
      v.literal("cancelled"),
    ),
    emailPayload: v.string(), // JSON-serialized Resend payload
    scheduledSendTime: v.number(), // timestamp when it should actually send
    sentMessageId: v.optional(v.string()), // Resend message ID after send
    // For updating the chat message after send
    chatMessageId: v.optional(v.id("threadMessages")),
    threadMessageId: v.optional(v.id("threadMessages")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    // Metadata for the sent email record
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(), // plain content (for thread record)
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.id("_storage"),
        }),
      ),
    ),
    allowMultipleCoiAttachments: v.optional(v.boolean()),
    // For unified thread dual-write
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedQuoteIds: v.optional(v.array(v.id("policies"))),
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
    allowedScopes: v.optional(
      v.array(v.union(v.literal("read"), v.literal("write"))),
    ),
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
