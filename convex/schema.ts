import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { pipelineFields } from "@claritylabs/cl-pipelines/convex";
import { agentStepsValidator } from "./lib/agentSteps";

const modelProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("fireworks"),
  v.literal("moonshot"),
  v.literal("deepseek"),
);

const modelRouteValidator = v.object({
  provider: modelProviderValidator,
  model: v.string(),
});

const webRetrievalProviderValidator = v.union(
  v.literal("parallel"),
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

const orgRoleValidator = v.union(v.literal("admin"), v.literal("member"));

const operatorInitiatedMessageValidator = v.object({
  operatorUserId: v.id("users"),
  operatorEmail: v.optional(v.string()),
  operatorName: v.optional(v.string()),
  impersonationSessionId: v.id("operatorImpersonationSessions"),
  targetOrgId: v.id("organizations"),
  targetOrgName: v.string(),
  targetRole: orgRoleValidator,
  displayLabel: v.string(),
  initiatedAt: v.number(),
});

const pipelineStatusValidator = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("complete"),
  v.literal("error"),
);

const extractionDataStageValidator = v.union(
  v.literal("placeholder"),
  v.literal("preview"),
  v.literal("final"),
);

const notificationChannelValidator = v.union(
  // Legacy preference rows can contain in_app. In-app notifications are now
  // always created for supported events and are not a user-configurable channel.
  v.literal("in_app"),
  v.literal("email"),
  v.literal("imessage"),
);

const connectedEmailAutomationValidator = v.object({
  policyImports: v.boolean(),
  requirementImports: v.boolean(),
  companyMemory: v.boolean(),
});

const publicDemoChannelValidator = v.union(
  v.literal("email"),
  v.literal("imessage"),
);

const publicDemoLeadStageValidator = v.union(
  v.literal("new"),
  v.literal("engaged"),
  v.literal("qualified"),
  v.literal("booking_intent"),
  v.literal("cta_sent"),
  v.literal("signup_intent"),
  v.literal("not_fit"),
  v.literal("rate_limited"),
);

const publicDemoCtaStatusValidator = v.union(
  v.literal("not_shown"),
  v.literal("asked_for_email"),
  v.literal("cal_link_sent"),
  v.literal("signup_link_sent"),
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

const certificateSourceValidator = v.union(
  v.literal("policy_page"),
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("sms"),
  v.literal("api"),
  v.literal("mcp"),
  v.literal("agent"),
  v.literal("unknown"),
);

const certificateHolderAddressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const orgMailingAddressValidator = v.object({
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const policyDetailPartyValidator = v.object({
  name: v.string(),
  address: orgMailingAddressValidator,
});

const policyDetailOverridesValidator = v.object({
  operationsDescription: v.optional(v.string()),
  insured: v.optional(
    v.object({
      name: v.string(),
      address: orgMailingAddressValidator,
      additionalNamedInsureds: v.array(v.string()),
    }),
  ),
  producer: v.optional(
    v.object({
      name: v.string(),
      address: orgMailingAddressValidator,
      contactName: v.string(),
      licenseNumber: v.string(),
      phone: v.string(),
      email: v.string(),
    }),
  ),
  insurer: v.optional(v.object({
    name: v.string(),
    address: orgMailingAddressValidator,
    naicNumber: v.string(),
  })),
  generalAgent: v.optional(v.object({
    name: v.string(),
    address: orgMailingAddressValidator,
    licenseNumber: v.string(),
  })),
  // Read compatibility for overrides saved before General Agent nomenclature.
  mga: v.optional(policyDetailPartyValidator),
});

const organizationProfileOverridesValidator = v.object({
  namedInsured: v.optional(v.string()),
  mailingAddress: orgMailingAddressValidator,
  dba: v.optional(v.string()),
  entityType: v.optional(
    v.union(
      v.literal("sole_proprietorship"),
      v.literal("partnership"),
      v.literal("corporation"),
      v.literal("s_corporation"),
      v.literal("limited_liability_company"),
      v.literal("trust_estate"),
      v.literal("tax_exempt_organization"),
      v.literal("government_entity"),
      v.literal("other"),
    ),
  ),
  taxId: v.optional(v.string()),
  fein: v.optional(v.string()),
  businessNumber: v.optional(v.string()),
  operationsDescription: v.string(),
  additionalNamedInsureds: v.optional(v.array(v.string())),
});

const orgProfileFactSourceValidator = v.object({
  policyId: v.id("policies"),
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
  sourceNodeIds: v.optional(v.array(v.string())),
  sourceSpanIds: v.optional(v.array(v.string())),
  effectiveDate: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  policyYear: v.optional(v.number()),
  observedAt: v.number(),
});

const orgProfileScalarFactValidator = v.object({
  value: v.string(),
  source: orgProfileFactSourceValidator,
});

const orgProfileAddressFactValidator = v.object({
  value: orgMailingAddressValidator,
  source: orgProfileFactSourceValidator,
});

const policyVersionKindValidator = v.union(
  v.literal("new_policy"),
  v.literal("policy_change"),
  v.literal("re_extraction"),
  v.literal("renewal"),
);

const certificateParentStatusValidator = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("archived"),
);

const certificateVersionStatusValidator = v.union(
  v.literal("draft"),
  v.literal("issued"),
  v.literal("superseded"),
  v.literal("void"),
);

const certificateRequestKindValidator = v.union(
  v.literal("holder"),
  v.literal("additional_insured"),
);

const certificateFormCodeValidator = v.union(
  v.literal("acord25"),
  v.literal("acord24"),
  v.literal("acord27"),
  v.literal("acord28"),
  v.literal("acord29"),
  v.literal("acord30"),
  v.literal("acord31"),
);

const certificateEmailDraftValidator = v.object({
  subject: v.string(),
  body: v.string(),
  recipientEmail: v.optional(v.string()),
  recipientName: v.optional(v.string()),
});

const certificateWorkflowJobStatusValidator = v.union(
  v.literal("review_required"),
  v.literal("blocked_missing_contact"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("cancelled"),
  v.literal("failed"),
);

const certificateWorkflowJobKindValidator = v.union(
  v.literal("renewal_reissue"),
  v.literal("manual_review"),
);

const certificateHolderRelationshipKindValidator = v.union(
  v.literal("additional_insured"),
  v.literal("loss_payee"),
  v.literal("mortgagee"),
  v.literal("allowed_holder"),
);

const policyDeliveryRuleFiltersValidator = v.object({
  carriers: v.optional(v.array(v.string())),
  securities: v.optional(v.array(v.string())),
  underwriters: v.optional(v.array(v.string())),
  linesOfBusiness: v.optional(v.array(v.string())),
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
    accountKind: v.optional(
      v.union(v.literal("customer"), v.literal("operator")),
    ),
    // Personal profile fields
    title: v.optional(v.string()),
    // Onboarding & admin
    onboardingComplete: v.optional(v.boolean()),
    isAdmin: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  userEmailChangeRequests: defineTable({
    targetUserId: v.id("users"),
    requestedByUserId: v.id("users"),
    oldEmail: v.optional(v.string()),
    newEmail: v.string(),
    codeHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
    requestedAt: v.number(),
    expiresAt: v.number(),
    confirmedAt: v.optional(v.number()),
    confirmedByUserId: v.optional(v.id("users")),
    cancelledAt: v.optional(v.number()),
    cancelledByUserId: v.optional(v.id("users")),
  })
    .index("by_target_status", ["targetUserId", "status"])
    .index("by_newEmail_status", ["newEmail", "status"])
    .index("by_requestedBy", ["requestedByUserId"]),

  // Organizations — owns company data, agent, broker info
  organizations: defineTable({
    name: v.string(),
    website: v.optional(v.string()),
    context: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
    mailingAddress: v.optional(orgMailingAddressValidator),
    profileFacts: v.optional(
      v.object({
        namedInsured: v.optional(orgProfileScalarFactValidator),
        mailingAddress: v.optional(orgProfileAddressFactValidator),
        dba: v.optional(orgProfileScalarFactValidator),
        entityType: v.optional(orgProfileScalarFactValidator),
        taxId: v.optional(orgProfileScalarFactValidator),
        fein: v.optional(orgProfileScalarFactValidator),
        businessNumber: v.optional(orgProfileScalarFactValidator),
        operationsDescription: v.optional(orgProfileScalarFactValidator),
        additionalNamedInsureds: v.optional(v.array(orgProfileScalarFactValidator)),
      }),
    ),
    profileFactsUpdatedAt: v.optional(v.number()),
    profileOverrides: v.optional(organizationProfileOverridesValidator),
    profileOverridesUpdatedAt: v.optional(v.number()),
    profileOverridesUpdatedByUserId: v.optional(v.id("users")),
    // Relationship context — helps categorize intelligence entries
    clientsContext: v.optional(v.string()), // who the org's clients/customers are
    vendorsContext: v.optional(v.string()), // key vendors and service providers
    insuranceContext: v.optional(v.string()), // brokers, carriers, insurance relationships
    investorsContext: v.optional(v.string()), // investors, shareholders, funding
    partnersContext: v.optional(v.string()), // joint ventures, affiliates, partners
    relatedLegalEntities: v.optional(
      v.array(
        v.object({
          legalName: v.string(),
          relationship: v.optional(
            v.union(
              v.literal("current"),
              v.literal("fka"),
              v.literal("dba"),
              v.literal("subsidiary"),
              v.literal("parent"),
              v.literal("affiliate"),
              v.literal("other"),
            ),
          ),
          incorporationNumber: v.optional(v.string()),
          taxId: v.optional(v.string()),
          jurisdiction: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    // Client-org verification: which sender emails/domains count as "this client"
    // when routing inbound email sent to the broker's agent handle.
    allowedEmails: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    emailVerification: v.optional(
      v.union(v.literal("strict"), v.literal("domain"), v.literal("open")),
    ),
    // Legacy ignored certificate settings retained for existing organization records.
    coiHandling: v.optional(
      v.union(v.literal("broker"), v.literal("member"), v.literal("ignore")),
    ),
    autoGenerateCoi: v.optional(v.boolean()),
    policyChangeRequestsEnabled: v.optional(v.boolean()),
    certificateChangeRequestsEnabled: v.optional(v.boolean()),
    // Agent
    agentHandle: v.optional(v.string()),
    // Primary insurance contact for the org
    primaryInsuranceContactId: v.optional(v.id("users")),
    // Agent settings
    chatEmailNotifications: v.optional(v.boolean()), // send email notifications for chat responses in email threads
    autoSendEmails: v.optional(v.boolean()), // when false, drafted emails from chat require confirmation before sending
    bccRequesterOnAgentEmails: v.optional(v.boolean()), // default true: BCC requesting team member on outbound agent emails
    emailSendDelay: v.optional(v.number()), // seconds before sending emails (default 5, 0 = instant)
    featureFlags: v.optional(v.record(v.string(), v.boolean())),
    // Onboarding
    onboardingComplete: v.optional(v.boolean()),
    // Internal operator lifecycle for operator-provisioned tenants. Missing legacy value means live.
    operatorStatus: v.optional(
      v.union(v.literal("onboarding"), v.literal("live")),
    ),
    // Branding
    iconStorageId: v.optional(v.id("_storage")),
    // Dual-org: org type discriminator
    type: v.optional(v.union(v.literal("broker"), v.literal("client"))),
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
      v.literal("impersonation_started"),
      v.literal("impersonation_stopped"),
      v.literal("impersonation_chat_message"),
      v.literal("memory_cleared"),
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
        fireworks: v.optional(v.string()),
        moonshot: v.optional(v.string()),
        deepseek: v.optional(v.string()),
      }),
    ),
    routes: v.optional(
      v.object({
        chat: v.optional(modelRouteValidator),
        chat_vision: v.optional(modelRouteValidator),
        voice_transcription: v.optional(modelRouteValidator),
        email_draft: v.optional(modelRouteValidator),
        email_reply: v.optional(modelRouteValidator),
        extraction: v.optional(modelRouteValidator),
        extraction_preview: v.optional(modelRouteValidator),
        extraction_coverage_recovery: v.optional(modelRouteValidator),
        classification: v.optional(modelRouteValidator),
        requirement_extraction: v.optional(modelRouteValidator),
        org_memory_extraction: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
        security: v.optional(modelRouteValidator),
        mailbox_coordinator: v.optional(modelRouteValidator),
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
        chat_vision: v.optional(modelRouteValidator),
        voice_transcription: v.optional(modelRouteValidator),
        email_draft: v.optional(modelRouteValidator),
        email_reply: v.optional(modelRouteValidator),
        extraction: v.optional(modelRouteValidator),
        extraction_preview: v.optional(modelRouteValidator),
        extraction_coverage_recovery: v.optional(modelRouteValidator),
        classification: v.optional(modelRouteValidator),
        requirement_extraction: v.optional(modelRouteValidator),
        org_memory_extraction: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
        security: v.optional(modelRouteValidator),
        mailbox_coordinator: v.optional(modelRouteValidator),
        embeddings: v.optional(modelRouteValidator),
        extraction_quality: v.optional(modelRouteValidator),
        extraction_form_inventory: v.optional(modelRouteValidator),
        extraction_coverage_cleanup: v.optional(modelRouteValidator),
        // Staging has this deprecated key persisted. Runtime code no longer reads or writes it.
        extraction_visual_table_repair: v.optional(modelRouteValidator),
        fallback: v.optional(modelRouteValidator),
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
    automation: v.optional(connectedEmailAutomationValidator),
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
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_status", ["status"]),

  connectedEmailScanStates: defineTable({
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    mailbox: v.string(),
    uidValidity: v.optional(v.string()),
    lastUid: v.optional(v.number()),
    lastAttemptedAt: v.number(),
    lastSuccessfulAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_accountId_mailbox", ["accountId", "mailbox"])
    .index("by_orgId", ["orgId"]),

  connectedEmailAutomationItems: defineTable({
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    mailbox: v.string(),
    uid: v.number(),
    messageKey: v.string(),
    emailRef: v.string(),
    sourceMessageId: v.optional(v.string()),
    subject: v.string(),
    from: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    classification: v.union(
      v.literal("ignore"),
      v.literal("policy_document"),
      v.literal("insurance_requirements"),
      v.literal("company_context"),
      v.literal("multiple"),
      v.literal("review_needed"),
    ),
    confidence: v.number(),
    reason: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    attempts: v.number(),
    actionSummary: v.optional(v.string()),
    needsReview: v.optional(v.boolean()),
    reviewReason: v.optional(v.string()),
    policyIds: v.optional(v.array(v.id("policies"))),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    memoryIds: v.optional(v.array(v.id("orgMemory"))),
    threadId: v.optional(v.id("threads")),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_accountId_messageKey", ["accountId", "messageKey"])
    .index("by_threadId", ["threadId"])
    .index("by_threadId_and_emailRef", ["threadId", "emailRef"])
    .index("by_orgId_updatedAt", ["orgId", "updatedAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

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
    sourceRef: v.optional(v.string()),
    confidence: v.optional(v.number()),
    observedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_type", ["orgId", "type"])
    .index("by_org_sourceRef", ["orgId", "sourceRef"]),

  // Passport, integrations, email-inbox, and org-documents tables
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
    orgId: v.optional(v.id("organizations")), // connected broker org; omitted for standalone external contacts
    clientOrgId: v.id("organizations"), // client org
    brokerCompanyName: v.optional(v.string()),
    producerId: v.optional(v.id("users")), // optional broker user
    role: v.union(v.literal("primary"), v.literal("secondary")),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
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
    .index("by_brokerOrgId_status_updatedAt", [
      "brokerOrgId",
      "status",
      "updatedAt",
    ])
    .index("by_clientOrgId_updatedAt", ["clientOrgId", "updatedAt"])
    .index("by_clientOrgId_status_updatedAt", [
      "clientOrgId",
      "status",
      "updatedAt",
    ])
    .index("by_policyId", ["policyId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

  policyDeliveryAttempts: defineTable({
    jobId: v.id("policyDeliveryJobs"),
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    channel: policyDeliveryChannelValidator,
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
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
        v.literal("liteparse"),
        v.literal("pdfjs"),
        v.literal("mammoth"),
        v.literal("plain_text"),
      ),
    ),
    parsedAt: v.optional(v.number()),
    status: pipelineStatusValidator,
    pipelineError: v.optional(v.string()),
    createdByUserId: v.id("users"),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"]),

  insuranceRequirements: defineTable({
    orgId: v.id("organizations"),
    // Legacy staging/prod rows from the pre-redesign requirement model do not
    // have kind/scope yet. Keep these optional until all environments have run
    // the compliance requirement shape backfill.
    kind: v.optional(v.union(
      v.literal("coverage"),
      v.literal("insurer"),
      v.literal("condition"),
    )),
    scope: v.optional(v.union(v.literal("own_org"), v.literal("vendors"))),
    title: v.string(),
    requirementText: v.string(),
    lineOfBusiness: v.optional(v.string()),
    limits: v.optional(
      v.array(
        v.object({
          kind: v.string(),
          amount: v.number(),
          label: v.optional(v.string()),
        }),
      ),
    ),
    maxDeductible: v.optional(
      v.object({
        amount: v.number(),
        label: v.optional(v.string()),
      }),
    ),
    coverageForm: v.optional(
      v.union(v.literal("occurrence"), v.literal("claims_made")),
    ),
    retroactiveDateOnOrBefore: v.optional(v.string()),
    provisions: v.optional(v.array(v.string())),
    requiredForms: v.optional(v.array(v.string())),
    minAmBestRating: v.optional(v.string()),
    minAmBestFinancialSize: v.optional(v.string()),
    admittedRequired: v.optional(v.boolean()),
    conditionType: v.optional(
      v.union(
        v.literal("cancellation_notice"),
        v.literal("certificate_delivery"),
        v.literal("claims_reporting"),
        v.literal("subcontractor_insurance"),
        v.literal("other"),
      ),
    ),
    noticeDays: v.optional(v.number()),
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
    status: v.union(v.literal("active"), v.literal("archived")),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Deprecated legacy requirement fields. Do not write these in new code.
    category: v.optional(v.string()),
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
    appliesTo: v.optional(
      v.union(
        v.literal("vendors"),
        v.literal("own_org"),
        v.literal("both"),
      ),
    ),
    evaluationTarget: v.optional(
      v.union(
        v.literal("own_policy"),
        v.literal("connected_vendor_policy"),
        v.literal("subcontractor_policy"),
        v.literal("manual_control"),
        v.literal("not_policy_checkable"),
      ),
    ),
    evaluationReason: v.optional(v.string()),
    semanticReviewStatus: v.optional(
      v.union(
        v.literal("system_classified"),
        v.literal("needs_review"),
        v.literal("user_confirmed"),
      ),
    ),
    manualComplianceReview: v.optional(
      v.object({
        status: v.union(
          v.literal("met"),
          v.literal("missing"),
          v.literal("expiring_soon"),
          v.literal("expired"),
          v.literal("needs_review"),
        ),
        matchedPolicyIds: v.array(v.id("policies")),
        expiresAt: v.optional(v.string()),
        daysUntilExpiration: v.optional(v.number()),
        notes: v.optional(v.string()),
        checkedAt: v.number(),
        checkedByUserId: v.id("users"),
      }),
    ),
    minimumRequired: v.optional(v.boolean()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_status_scope", ["status", "scope"]),

  complianceChecks: defineTable({
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    subjectOrgId: v.id("organizations"),
    relationshipId: v.optional(v.id("connectedOrgRelationships")),
    status: v.union(
      v.literal("met"),
      v.literal("not_met"),
      v.literal("expiring_soon"),
      v.literal("expired"),
      v.literal("unverified"),
    ),
    reasons: v.optional(v.array(v.string())),
    matchedPolicyIds: v.array(v.id("policies")),
    matchedSummary: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
    evidence: v.optional(
      v.object({
        note: v.optional(v.string()),
        fileId: v.optional(v.id("_storage")),
        fileName: v.optional(v.string()),
        validUntil: v.optional(v.string()),
      }),
    ),
    checkedAt: v.number(),
    // Carried across monitor snapshots to gate seven-day reminders.
    alertedAt: v.optional(v.number()),
    checkedBy: v.union(
      v.literal("system"),
      v.literal("user"),
      v.literal("agent"),
    ),
    checkedByUserId: v.optional(v.id("users")),
  })
    .index("by_requirementId_subjectOrgId", [
      "requirementId",
      "subjectOrgId",
    ])
    .index("by_orgId_subjectOrgId", ["orgId", "subjectOrgId"])
    .index("by_relationshipId", ["relationshipId"])
    .index("by_requirementId_subjectOrgId_checkedBy_checkedAt", [
      "requirementId",
      "subjectOrgId",
      "checkedBy",
      "checkedAt",
    ]),
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
    uploadFileSha256s: v.optional(v.array(v.string())),
    extractionDataStage: v.optional(extractionDataStageValidator),
    extractionDataStageUpdatedAt: v.optional(v.number()),
    extractionPreviewVersion: v.optional(v.string()),
    extractionPreviewModel: v.optional(v.string()),
    extractionPreviewError: v.optional(v.string()),
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
    // Broker-authored corrections remain separate from source-backed extraction.
    policyDetailOverrides: v.optional(policyDetailOverridesValidator),
    policyDetailOverridesUpdatedAt: v.optional(v.number()),
    policyDetailOverridesUpdatedByUserId: v.optional(v.id("users")),
    // Entity fields
    carrier: v.string(), // backward compat — prefer security for new extractions
    security: v.optional(v.string()), // insurer/underwriter company (e.g. "Lloyd's Underwriters")
    underwriter: v.optional(v.string()), // named individual underwriter (e.g. "Libby Rudd")
    // Read compatibility for policies extracted before generalAgent.
    mga: v.optional(v.string()),
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
    insurer: v.optional(
      v.object({
        legalName: v.string(),
        naicNumber: v.optional(v.string()),
        amBestRating: v.optional(v.string()),
        amBestNumber: v.optional(v.string()),
        admittedStatus: v.optional(v.string()),
        stateOfDomicile: v.optional(v.string()),
        address: v.optional(
          v.object({
            street1: v.string(),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
            formatted: v.optional(v.string()),
          }),
        ),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
      }),
    ),
    producer: v.optional(
      v.object({
        agencyName: v.string(),
        contactName: v.optional(v.string()),
        licenseNumber: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
        address: v.optional(
          v.object({
            street1: v.string(),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
            formatted: v.optional(v.string()),
          }),
        ),
      }),
    ),
    generalAgent: v.optional(
      v.object({
        agencyName: v.string(),
        licenseNumber: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
        address: v.optional(
          v.object({
            street1: v.string(),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
            formatted: v.optional(v.string()),
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
              formatted: v.optional(v.string()),
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
              formatted: v.optional(v.string()),
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
        formatted: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
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
              formatted: v.optional(v.string()),
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
    coverageSchedules: v.optional(
      v.array(
        v.object({
          name: v.string(),
          kind: v.union(
            v.literal("vehicle"),
            v.literal("property"),
            v.literal("location"),
            v.literal("other"),
          ),
          description: v.optional(v.string()),
          items: v.array(
            v.object({
              label: v.string(),
              description: v.optional(v.string()),
              values: v.array(
                v.object({
                  label: v.string(),
                  value: v.string(),
                }),
              ),
              sourceSpanIds: v.array(v.string()),
            }),
          ),
          sourceSpanIds: v.array(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
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
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
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
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
        }),
      ),
    ),
    premiumBreakdown: v.optional(
      v.array(
        v.object({
          line: v.string(),
          amount: v.string(),
          amountValue: v.optional(v.number()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
        }),
      ),
    ),
    // Policy metadata
    policyNumber: v.string(),
    linesOfBusiness: v.array(v.string()),
    documentType: v.optional(v.literal("policy")),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(
      v.object({
        name: v.string(),
        lineOfBusiness: v.optional(v.string()),
        endorsementNumber: v.optional(v.string()),
        coverageCode: v.optional(v.string()),
        formEditionDate: v.optional(v.string()),
        limit: v.optional(v.string()),
        limitAmount: v.optional(v.number()),
        limitType: v.optional(v.string()),
        limitValueType: v.optional(v.string()),
        limits: v.optional(
          v.array(
            v.object({
              label: v.string(),
              value: v.string(),
              amount: v.optional(v.number()),
              appliesTo: v.optional(v.string()),
              kind: v.optional(v.string()),
              sourceNodeIds: v.optional(v.array(v.string())),
              sourceSpanIds: v.optional(v.array(v.string())),
            }),
          ),
        ),
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
        documentNodeId: v.optional(v.string()),
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
    documentMetadata: v.optional(v.any()),
    documentOutline: v.optional(v.any()),
    sourceTreeVersion: v.optional(v.string()),
    sourceTreeStatus: v.optional(
      v.union(
        v.literal("missing"),
        v.literal("queued"),
        v.literal("running"),
        v.literal("ready"),
        v.literal("failed"),
      ),
    ),
    sourceTreeUpdatedAt: v.optional(v.number()),
    sourceTreeError: v.optional(v.string()),
    operationalProfile: v.optional(v.any()),
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
    // Supplementary extraction (cl-sdk 0.13+) — extra facts not captured by structured extractors
    supplementaryFacts: v.optional(
      v.array(
        v.object({
          key: v.string(),
          value: v.string(),
          subject: v.optional(v.string()),
          context: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
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
    currentPolicyVersionId: v.optional(v.id("policyVersions")),
  })
    .index("by_carrier", ["carrier"])
    .index("by_policyYear", ["policyYear"])
    .index("by_userId", ["userId"])
    .index("by_orgId", ["orgId"]),

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

  // Narrow queue for external Railway extraction workers. Claim polling reads
  // this table instead of scanning all running pipeline records.
  policyExtractionQueue: defineTable({
    policyId: v.id("policies"),
    runId: v.id("policyExtractionRuns"),
    status: v.union(v.literal("queued"), v.literal("leased")),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // Lightweight first-read queue. Preview workers populate bounded canonical
  // fields before the full source-backed extraction pipeline completes.
  policyExtractionPreviewQueue: defineTable({
    policyId: v.id("policies"),
    runId: v.id("policyExtractionRuns"),
    status: v.union(v.literal("queued"), v.literal("leased")),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // Storage-backed transient extraction artifacts. These records point at JSON
  // blobs in Convex file storage for pre-embedding chunk/source-span payloads,
  // external worker completion payloads, and legacy cl-sdk checkpoint cleanup.
  policyExtractionArtifacts: defineTable({
    policyId: v.id("policies"),
    kind: v.union(
      v.literal("cl_sdk_checkpoint"),
      v.literal("embedding_payload"),
      v.literal("external_completion_payload"),
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

  policyVersions: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    versionNumber: v.number(),
    versionKind: policyVersionKindValidator,
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    sourcePolicyFileIds: v.optional(v.array(v.id("policyFiles"))),
    sourceFileIds: v.optional(v.array(v.id("_storage"))),
    caseId: v.optional(v.id("policyChangeCases")),
    extractionRunId: v.optional(v.id("policyExtractionRuns")),
    snapshot: v.optional(v.any()),
    fieldDiffs: v.optional(v.array(v.any())),
    summary: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_policyId_versionNumber", ["policyId", "versionNumber"])
    .index("by_policyId_createdAt", ["policyId", "createdAt"])
    .index("by_caseId", ["caseId"]),

  certificateHolders: defineTable({
    orgId: v.id("organizations"),
    displayName: v.string(),
    normalizedName: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    normalizedEmail: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(certificateHolderAddressValidator),
    normalizedAddressKey: v.optional(v.string()),
    mapboxFeatureId: v.optional(v.string()),
    mapboxMetadata: v.optional(v.any()),
    source: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("extraction"),
        v.literal("certificate_generation"),
        v.literal("migration"),
        v.literal("api"),
        v.literal("mcp"),
        v.literal("agent"),
      ),
    ),
    sourceRef: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_normalizedName", ["orgId", "normalizedName"])
    .index("by_orgId_normalizedEmail", ["orgId", "normalizedEmail"])
    .index("by_orgId_normalizedAddressKey", ["orgId", "normalizedAddressKey"]),

  certificateHolderPolicyLinks: defineTable({
    orgId: v.id("organizations"),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    relationshipKind: certificateHolderRelationshipKindValidator,
    status: v.union(
      v.literal("current"),
      v.literal("historical"),
      v.literal("review_required"),
      v.literal("dismissed"),
    ),
    sourceNodeIds: v.optional(v.array(v.string())),
    sourceSpanIds: v.optional(v.array(v.string())),
    sourceSummary: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_holderId", ["holderId"])
    .index("by_policyId", ["policyId"])
    .index("by_policyId_status", ["policyId", "status"])
    .index("by_policyVersionId", ["policyVersionId"]),

  policyCertificates: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderId: v.id("certificateHolders"),
    status: certificateParentStatusValidator,
    dedupeKey: v.string(),
    currentVersionId: v.optional(v.id("certificateVersions")),
    latestIssuedVersionId: v.optional(v.id("certificateVersions")),
    formCode: v.optional(certificateFormCodeValidator),
    lastIssuedAt: v.optional(v.number()),
    source: v.optional(certificateSourceValidator),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_holderId", ["holderId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_policyId_status", ["policyId", "status"])
    .index("by_dedupeKey", ["dedupeKey"]),

  certificateVersions: defineTable({
    orgId: v.id("organizations"),
    certificateId: v.id("policyCertificates"),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    versionNumber: v.number(),
    status: certificateVersionStatusValidator,
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    holderSnapshot: v.optional(v.any()),
    policySnapshot: v.optional(v.any()),
    policySnapshotHash: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    requestKind: v.optional(certificateRequestKindValidator),
    additionalInsuredName: v.optional(v.string()),
    descriptionOfOperations: v.optional(v.string()),
    formCode: v.optional(certificateFormCodeValidator),
    requestSignature: v.optional(v.string()),
    legacyCertificateId: v.optional(v.id("certificates")),
    issuedAt: v.optional(v.number()),
    supersededAt: v.optional(v.number()),
    voidedAt: v.optional(v.number()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_certificateId", ["certificateId"])
    .index("by_certificateId_versionNumber", ["certificateId", "versionNumber"])
    .index("by_policyId", ["policyId"])
    .index("by_policyVersionId", ["policyVersionId"])
    .index("by_holderId", ["holderId"]),

  certificateWorkflowSettings: defineTable({
    brokerOrgId: v.optional(v.id("organizations")),
    clientOrgId: v.optional(v.id("organizations")),
    populateHoldersFromEndorsements: v.boolean(),
    renewalReissueEnabled: v.boolean(),
    renewalReissueMode: v.literal("review_queue"),
    renewalReviewLeadDays: v.optional(v.number()),
    policyChangeRequestsForHeldCertificatesEnabled: v.optional(v.boolean()),
    channels: v.optional(v.array(policyDeliveryChannelValidator)),
    copyInstructions: v.optional(v.string()),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brokerOrgId", ["brokerOrgId"])
    .index("by_brokerOrgId_clientOrgId", ["brokerOrgId", "clientOrgId"])
    .index("by_clientOrgId", ["clientOrgId"]),

  certificateWorkflowJobs: defineTable({
    orgId: v.id("organizations"),
    brokerOrgId: v.optional(v.id("organizations")),
    certificateId: v.id("policyCertificates"),
    certificateVersionId: v.optional(v.id("certificateVersions")),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    kind: certificateWorkflowJobKindValidator,
    status: certificateWorkflowJobStatusValidator,
    idempotencyKey: v.string(),
    reason: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    reviewNotes: v.optional(v.string()),
    sendNotes: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    sentByUserId: v.optional(v.id("users")),
    cancelledAt: v.optional(v.number()),
    cancelledByUserId: v.optional(v.id("users")),
    cancelReason: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    reviewedByUserId: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_policyId", ["policyId"])
    .index("by_certificateId", ["certificateId"])
    .index("by_holderId", ["holderId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

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
    requestKind: v.optional(certificateRequestKindValidator),
    additionalInsuredName: v.optional(v.string()),
    descriptionOfOperations: v.optional(v.string()),
    formCode: v.optional(certificateFormCodeValidator),
    requestSignature: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_fileId", ["fileId"]),

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
    emailDraft: v.optional(certificateEmailDraftValidator),
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

  // ── Notifications ──

  notifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")), // null = org-wide
    type: v.union(
      // Retired types kept only so historical rows remain schema-compatible.
      v.literal("merge_suggestion"),
      v.literal("policy_declaration_discrepancy"),
      // Active notification types.
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
      v.literal("vendor_compliance_met"),
      v.literal("vendor_compliance_gap"),
      v.literal("vendor_policy_expiring"),
      v.literal("vendor_policy_expired"),
      v.literal("policy_change_needs_info"),
      v.literal("policy_change_completed"),
      v.literal("mailbox_attention"),
      v.literal("own_compliance_gap"),
      v.literal("own_compliance_resolved"),
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
    actionType: v.optional(v.string()),
    actionPayload: v.optional(v.any()),
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

  // Document chunks for semantic search over extracted bound policy content
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
      v.literal("email"),
      v.literal("attachment"),
      v.literal("manual_note"),
    ),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    sectionId: v.optional(v.string()),
    formNumber: v.optional(v.string()),
    sourceUnit: v.optional(v.string()),
    parentSpanId: v.optional(v.string()),
    table: v.optional(v.any()),
    location: v.optional(v.any()),
    text: v.string(),
    textHash: v.string(),
    bbox: v.optional(v.any()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_spanId", ["spanId"])
    .index("by_policyId_spanId", ["policyId", "spanId"])
    .index("by_policyId_parentSpanId", ["policyId", "parentSpanId"]),

  // Source-tree hierarchy over raw source spans. This is the canonical
  // retrieval/index layer for policy wording and source-backed facts.
  sourceNodes: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    nodeId: v.string(),
    documentId: v.string(),
    parentNodeId: v.optional(v.string()),
    kind: v.string(),
    title: v.string(),
    description: v.string(),
    textExcerpt: v.optional(v.string()),
    sourceSpanIds: v.array(v.string()),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    bbox: v.optional(v.any()),
    order: v.number(),
    path: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_nodeId", ["nodeId"])
    .index("by_policyId_nodeId", ["policyId", "nodeId"])
    .index("by_policyId_parentNodeId", ["policyId", "parentNodeId"]),

  // Compatibility chunks over source spans. Source tree nodes are the primary
  // retrieval layer; these preserve span IDs for legacy lookup surfaces.
  sourceChunks: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    chunkId: v.string(),
    documentId: v.string(),
    sourceSpanIds: v.array(v.string()),
    text: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  })
    .index("by_policyId", ["policyId"])
    .index("by_orgId", ["orgId"])
    .index("by_chunkId", ["chunkId"]),

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
    requestDetails: v.optional(v.any()),
    items: v.optional(v.any()),
    impacts: v.optional(v.any()),
    missingInfoQuestions: v.optional(v.any()),
    validationIssues: v.optional(v.any()),
    evidenceSourceIds: v.optional(v.array(v.string())),
    packetId: v.optional(v.id("pcePackets")),
    stagedPolicyUpdate: v.optional(v.any()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_orgId_status", ["orgId", "status"]),

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
    structuredValue: v.optional(v.any()),
    valueKind: v.union(
      v.literal("string"),
      v.literal("number"),
      v.literal("date"),
      v.literal("money"),
      v.literal("address"),
      v.literal("list"),
      v.literal("unknown"),
    ),
    sourceNodeIds: v.optional(v.array(v.string())),
    sourceSpanIds: v.optional(v.array(v.string())),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    policyYear: v.optional(v.number()),
    observedAt: v.number(),
    active: v.boolean(),
    recordHash: v.string(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_orgId_fieldGroup", ["orgId", "fieldGroup"])
    .index("by_policyId_active", ["policyId", "active"])
    .index("by_recordHash", ["recordHash"]),

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

  publicDemoConversations: defineTable({
    channel: publicDemoChannelValidator,
    senderHash: v.string(),
    senderContact: v.optional(v.string()),
    agentAddress: v.optional(v.string()),
    leadName: v.optional(v.string()),
    leadCompany: v.optional(v.string()),
    leadEmail: v.optional(v.string()),
    leadUseCase: v.optional(v.string()),
    stage: publicDemoLeadStageValidator,
    ctaStatus: publicDemoCtaStatusValidator,
    turnCount: v.number(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel_senderHash", ["channel", "senderHash"])
    .index("by_lastMessageAt", ["lastMessageAt"])
    .index("by_stage_lastMessageAt", ["stage", "lastMessageAt"])
    .index("by_ctaStatus_lastMessageAt", ["ctaStatus", "lastMessageAt"])
    .index("by_leadEmail", ["leadEmail"]),

  publicDemoChatLogs: defineTable({
    conversationId: v.id("publicDemoConversations"),
    channel: publicDemoChannelValidator,
    direction: v.union(
      v.literal("inbound"),
      v.literal("outbound"),
      v.literal("system"),
    ),
    subject: v.optional(v.string()),
    content: v.string(),
    contentHtml: v.optional(v.string()),
    modelProvider: v.optional(v.string()),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    ctaUrl: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()),
    deliveryId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_conversationId_createdAt", ["conversationId", "createdAt"])
    .index("by_channel_createdAt", ["channel", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  publicDemoSalesTranscripts: defineTable({
    conversationId: v.id("publicDemoConversations"),
    channel: publicDemoChannelValidator,
    senderContact: v.optional(v.string()),
    leadName: v.optional(v.string()),
    leadCompany: v.optional(v.string()),
    leadEmail: v.optional(v.string()),
    leadUseCase: v.optional(v.string()),
    stage: publicDemoLeadStageValidator,
    ctaStatus: publicDemoCtaStatusValidator,
    summary: v.string(),
    objections: v.array(v.string()),
    nextStep: v.string(),
    curatedTurns: v.array(
      v.object({
        speaker: v.string(),
        content: v.string(),
        at: v.number(),
      }),
    ),
    createdAt: v.number(),
    lastUpdatedAt: v.number(),
  })
    .index("by_conversationId", ["conversationId"])
    .index("by_lastUpdatedAt", ["lastUpdatedAt"])
    .index("by_channel_lastUpdatedAt", ["channel", "lastUpdatedAt"])
    .index("by_stage_lastUpdatedAt", ["stage", "lastUpdatedAt"]),

  policyAuditLog: defineTable({
    policyId: v.optional(v.id("policies")),
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
      v.union(
        v.literal("broker_visible"),
        v.literal("client_internal"),
        v.literal("user_private"),
      ),
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
    operatorInitiated: v.optional(operatorInitiatedMessageValidator),
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
    // Ordered activity timeline: reasoning segments interleaved with tool calls
    agentSteps: v.optional(agentStepsValidator),
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
    referencedRequirementIds: v.optional(
      v.array(v.id("insuranceRequirements")),
    ),
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

  appCardAccessLinks: defineTable({
    orgId: v.id("organizations"),
    tokenHash: v.string(),
    kind: v.union(
      v.literal("policy"),
      v.literal("certificate"),
      v.literal("policy_change"),
    ),
    policyId: v.optional(v.id("policies")),
    certificateId: v.optional(v.id("certificates")),
    policyCertificateId: v.optional(v.id("policyCertificates")),
    certificateVersionId: v.optional(v.id("certificateVersions")),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    label: v.optional(v.string()),
    sourceThreadId: v.optional(v.id("threads")),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_orgId", ["orgId"])
    .index("by_policyId", ["policyId"])
    .index("by_certificateId", ["certificateId"])
    .index("by_policyCertificateId", ["policyCertificateId"])
    .index("by_policyChangeCaseId", ["policyChangeCaseId"]),

  imessageChats: defineTable({
    chatGuid: v.string(),
    isGroup: v.boolean(),
    status: v.union(v.literal("active"), v.literal("left")),
    primaryOrgId: v.optional(v.id("organizations")),
    title: v.optional(v.string()),
    participantCount: v.number(),
    contactCardSentAt: v.optional(v.number()),
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
    fromHeader: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    renderedText: v.optional(v.string()),
    renderedHtml: v.optional(v.string()),
    scheduledSendTime: v.number(), // timestamp when it should actually send
    sentMessageId: v.optional(v.string()), // Resend message ID after send
    sendBlockedReason: v.optional(v.string()),
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
  })
    .index("by_threadId", ["threadId"])
    .index("by_status", ["status"]),

  emailDeliveryAttempts: defineTable({
    orgId: v.id("organizations"),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    source: v.union(
      v.literal("pending_email"),
      v.literal("email_subagent"),
      v.literal("policy_delivery"),
      v.literal("inbound_email"),
    ),
    provider: v.literal("resend"),
    deliveryMode: v.optional(v.string()),
    status: v.union(
      v.literal("attempting"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    messageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_pendingEmailId", ["pendingEmailId"])
    .index("by_orgId", ["orgId"])
    .index("by_status", ["status"]),

  // ── Presence ──

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

  publicDemoRateCounters: defineTable({
    rateKey: v.string(),
    windowStart: v.number(),
    count: v.number(),
    lastRequestAt: v.number(),
  }).index("by_rateKey", ["rateKey"]),

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
