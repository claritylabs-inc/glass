import { tool } from "ai";
import { z } from "zod";
import { PCE_REQUEST_KINDS } from "./pceIntake";
import { REQUIREMENT_EVALUATION_TARGETS } from "./requirementSemantics";

const REQUIREMENT_EVALUATION_TARGET_FILTER_VALUES = [
  ...REQUIREMENT_EVALUATION_TARGETS,
  "all",
] as const;

/**
 * Tool definitions for agentic chat.
 * These schemas are shared between processThreadChat (Convex) and /api/chat (Next.js).
 * Execute functions are wired up in each action separately.
 */

export const lookupPolicy = tool({
  description:
    "Search for insurance policies by carrier name, policy number, policy type, or keywords. Returns matching policy summaries.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query — carrier name, policy number, or keywords"),
    policyType: z
      .string()
      .optional()
      .describe(
        "Filter by policy type (e.g., general_liability, commercial_auto)",
      ),
    carrier: z.string().optional().describe("Filter by carrier/insurer name"),
  }),
});

export const compareCoverages = tool({
  description:
    "Compare two policies side by side — coverage types, limits, deductibles, and premium.",
  inputSchema: z.object({
    policyId1: z.string().describe("Policy reference for the first policy to compare"),
    policyId2: z.string().describe("Policy reference for the second policy to compare"),
  }),
});

export const lookupComplianceRequirements = tool({
  description:
    "Look up the organization's saved insurance compliance requirements. Use this when the user asks what contractors/vendors must carry, asks about my requirements, internal insurance standards, minimum required limits, deductibles, endorsements, certificate instructions, or compliance checklist requirements. Results distinguish obligation owner from evidence target.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Requirement topic to search for, such as contractors, general liability, cyber, auto, workers comp, additional insured, waiver, or a limit amount.",
      ),
    appliesTo: z
      .enum(["vendors", "own_org", "both", "all"])
      .optional()
      .describe(
        "Filter by obligation owner. Use vendors for contractor/vendor obligations, own_org for my requirements owned by this org, both for shared obligations, or all to search every requirement.",
      ),
    evaluationTarget: z
      .enum(REQUIREMENT_EVALUATION_TARGET_FILTER_VALUES)
      .optional()
      .describe(
        "Filter by evidence target: own_policy, connected_vendor_policy, subcontractor_policy, manual_control, not_policy_checkable, or all.",
      ),
  }),
});

export const lookupConnectedVendors = tool({
  description:
    "Look up connected vendor organizations and their compliance status. Use this when the user asks which vendors are non-compliant, compliant, waiting on policies, invited, or asks for vendor status.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Vendor name, website, email, or relationship label to filter by."),
    status: z
      .enum(["all", "compliant", "non_compliant", "attention", "waiting_on_policies"])
      .optional()
      .describe("Optional compliance/status filter."),
  }),
});

export const lookupVendorPolicies = tool({
  description:
    "List policies for a specific connected vendor. Use this before answering questions about a vendor's current insurance, carriers, policy numbers, limits, named insured, or expiration dates.",
  inputSchema: z.object({
    vendorOrgId: z.string().optional().describe("Connected vendor organization ID."),
    vendorName: z.string().optional().describe("Vendor name if the ID is not known."),
    query: z
      .string()
      .optional()
      .describe("Optional carrier, policy number, coverage, or policy type filter."),
  }),
});

export const lookupVendorCompliance = tool({
  description:
    "Return the requirement-by-requirement compliance checklist for connected vendors, including matched policy details, expiration dates, limits, named insured, and the reason each requirement is met or not met. Use this for non-compliant vendor questions and vendor compliance diffs.",
  inputSchema: z.object({
    vendorOrgId: z.string().optional().describe("Connected vendor organization ID."),
    vendorName: z.string().optional().describe("Vendor name if the ID is not known."),
    includeCompliant: z
      .boolean()
      .optional()
      .describe("Include met requirements as well as open issues. Defaults to true for specific vendors and false for all vendors."),
  }),
});

export const sendEmail = tool({
  description:
    "Draft and send an email on behalf of the team. Respects the organization's email settings.",
  inputSchema: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body content (plain text)"),
    cc: z.array(z.string()).optional().describe("CC email addresses"),
  }),
});

export const saveNote = tool({
  description:
    "Save an observation or note about a policy or the organization for future reference.",
  inputSchema: z.object({
    content: z.string().describe("The observation or note to save"),
    type: z
      .enum(["fact", "preference", "risk_note", "observation"])
      .describe("Type of note"),
    policyId: z.string().optional().describe("Related policy reference if applicable"),
  }),
});

export const startApplicationIntake = tool({
  description:
    "Start a broker/client insurance application intake when the user asks for a new policy, renewal application, carrier application, or broker submission packet. In broker portfolio mode, targetOrgId must be the specific client organization, not the broker workspace.",
  inputSchema: z.object({
    targetOrgId: z
      .string()
      .optional()
      .describe("Client organization ID to start the application for. Required when the active scope is a broker portfolio."),
    templateId: z.string().optional().describe("Application template ID if the broker selected one."),
    title: z.string().optional().describe("Short application title, such as General Liability Application."),
    lineOfBusiness: z.string().optional().describe("Line of business, such as general liability, cyber, auto, or workers comp."),
    product: z.string().optional().describe("Specific product or carrier application name when known."),
    requestText: z.string().describe("The user's request or intake instruction."),
    missingQuestions: z
      .array(
        z.object({
          fieldId: z.string(),
          label: z.string(),
          section: z.string().optional(),
          prompt: z.string(),
          required: z.boolean().optional(),
        }),
      )
      .optional()
      .describe("Initial questions the agent already knows must be collected."),
  }),
});

export const answerApplicationQuestions = tool({
  description:
    "Record answers for an active application intake. Use when the user replies with requested application information over chat, email, iMessage/SMS, or MCP.",
  inputSchema: z.object({
    applicationIntakeId: z.string().describe("Application intake ID."),
    answers: z.array(
      z.object({
        fieldId: z.string(),
        label: z.string(),
        section: z.string().optional(),
        value: z.string(),
        sourceSpanIds: z.array(z.string()).optional(),
        userSourceSpanIds: z.array(z.string()).optional(),
      }),
    ),
    message: z.string().optional().describe("Original user message containing the answers."),
  }),
});

export const checkApplicationStatus = tool({
  description:
    "Check status for an active insurance application intake or list recent application intakes in scope. Use only for new-policy, renewal-application, carrier-application, quote-submission, or broker-submission application workflows. Do not use for policy change requests, PCEs, endorsements, or policy-record change status; use check_policy_change_status for those.",
  inputSchema: z.object({
    applicationIntakeId: z.string().optional().describe("Specific application intake ID."),
  }),
});

export const prepareApplicationPacket = tool({
  description:
    "Prepare a broker-ready application packet from collected answers. This does not submit to carriers; it marks the packet ready for broker review/submission when required fields are complete.",
  inputSchema: z.object({
    applicationIntakeId: z.string().describe("Application intake ID."),
    submissionNotes: z.string().optional().describe("Broker-facing notes for carrier submission."),
  }),
});

export const confirmPolicyFact = tool({
  description:
    "Persist a policy fact that was confirmed from original PDF source evidence. Use only after lookup_policy_section returns original-PDF sourceSpanIds that directly support the fact. This can also update a small set of top-level extracted policy fields when the PDF evidence is clear.",
  inputSchema: z.object({
    policyId: z.string().describe("Policy reference for the fact being confirmed"),
    fact: z
      .string()
      .describe("Concise policy fact confirmed from the original PDF"),
    sourceSpanIds: z
      .array(z.string())
      .min(1)
      .describe("Stable source span IDs returned by lookup_policy_section"),
    fieldUpdates: z
      .object({
        carrier: z.string().optional(),
        security: z.string().optional(),
        mga: z.string().optional(),
        broker: z.string().optional(),
        policyNumber: z.string().optional(),
        effectiveDate: z.string().optional(),
        expirationDate: z.string().optional(),
        insuredName: z.string().optional(),
        premium: z.string().optional(),
        totalCost: z.string().optional(),
        minPremium: z.string().optional(),
        depositPremium: z.string().optional(),
        summary: z.string().optional(),
      })
      .optional()
      .describe(
        "Optional top-level extracted fields to update when directly supported by the cited PDF evidence",
      ),
  }),
});

export const lookupPolicySection = tool({
  description:
    "Search within a specific policy's source-native document outline and original PDF evidence for detailed content about a topic. Use this for coverage wording, declarations, forms, endorsements, exclusions, conditions, definitions, certificate wording, or any exact policy language that is not answered by summary data. Returns matching outline entries, source evidence, and sourceSpanIds for original-PDF evidence when available.",
  inputSchema: z.object({
    policyId: z.string().describe("The policy reference to search within. This may be a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy."),
    query: z
      .string()
      .describe(
        "What to search for — coverage name, form number, original heading, topic, clause label, or keywords",
      ),
  }),
});

export const attachPolicyDocument = tool({
  description:
    "Attach or send the original full policy PDF document for a specific policy. Use this when the user asks for a copy of the policy, policy PDF, full policy, declarations PDF, wording, or original policy document in chat/iMessage/SMS. For email delivery, prefer the email_expert tool so it can attach the original policy PDF to the email.",
  inputSchema: z.object({
    policyId: z.string().describe("The policy reference whose original PDF should be attached. This may be a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy."),
  }),
});

export const generateCoi = tool({
  description:
    "Generate a Certificate of Insurance (COI) PDF for a specific policy. Include requestedEndorsements/requestText when the user asks for additional insured, waiver of subrogation, primary and non-contributory, loss payee, mortgagee, special wording, or another endorsement-bearing certificate.",
  inputSchema: z.object({
    policyId: z.string().describe("The policy reference to generate the COI for. This may be a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy."),
    certificateHolder: z
      .string()
      .optional()
      .describe("Name/address of the certificate holder"),
    holderContactName: z
      .string()
      .optional()
      .describe("Specific certificate holder contact name or attention line when the user provides one"),
    holderEmail: z
      .string()
      .optional()
      .describe("Certificate holder email address for renewal delivery when the user provides one"),
    holderPhone: z
      .string()
      .optional()
      .describe("Certificate holder phone number for renewal delivery when the user provides one"),
    requestText: z
      .string()
      .optional()
      .describe("The user's full certificate request, especially any requested endorsement or special wording"),
    requestedEndorsements: z
      .array(z.string())
      .optional()
      .describe("Specific endorsement or special wording requests, such as additional insured, waiver of subrogation, primary and non-contributory, loss payee, or mortgagee"),
    partnerProgramId: z
      .string()
      .optional()
      .describe("Optional program administrator program ID to use when Glass asks the broker to choose a program"),
    explicitReissue: z
      .boolean()
      .optional()
      .describe("Set true only when the user explicitly asks to reissue/regenerate a new certificate version even if one already exists for this holder and current policy version"),
  }),
});

export const createPolicyChangeRequest = tool({
  description:
    "Create a policy change endorsement (PCE) request from the user's instructions. Use this immediately for actual policy-record changes: named insured changes, DBA/entity/FEIN changes, mailing address or location changes, additional insured/endorsement requests, limit or deductible changes, vehicle changes, cancellations, nonrenewals, renewal update packets, or certificate-driven endorsement requirements. A policy number plus the requested new value is enough to open the intake case; missing broker recipient details should be handled later by draft_policy_change_email. Do not use this for ordinary COI generation or certificate-holder-only instructions.",
  inputSchema: z.object({
    requestKind: z
      .enum(PCE_REQUEST_KINDS)
      .describe(
        "Classify the request. Use certificate_holder_only for ordinary COI holder changes with no requested endorsement. Use unclear when the user has not actually asked to change the policy record.",
      ),
    requestText: z
      .string()
      .describe(
        "The user's policy change or endorsement request, including requested values and effective date if provided",
      ),
    policyId: z.string().optional().describe("Related policy reference, if known. This may be a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy."),
    evidenceSourceIds: z
      .array(z.string())
      .optional()
      .describe(
        "Stable source span IDs that support quoted existing policy values",
      ),
  }),
});

export const addPolicyChangeInfo = tool({
  description:
    "Add missing or corrected information to an existing policy change request. Use this when the user answers Glass's follow-up questions or clarifies what changed.",
  inputSchema: z.object({
    caseId: z.string().describe("Existing policy change case ID"),
    infoText: z.string().describe("The additional details or clarification to add"),
    sourceSpanIds: z.array(z.string()).optional().describe("Optional source span IDs supporting the clarification"),
  }),
});

export const checkPolicyChangeStatus = tool({
  description:
    "Check status for policy change requests, PCEs, endorsements, and policy-record change cases, or list recent active change requests in scope. Use this when the user asks about change request status, PCE status, endorsement status, submitted policy changes, or case IDs for policy changes. Do not use check_application_status for these requests.",
  inputSchema: z.object({
    caseId: z
      .string()
      .optional()
      .describe("Specific policy change case ID, if the user supplied one."),
    policyId: z
      .string()
      .optional()
      .describe("Policy reference to filter by, such as a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy."),
    includeClosed: z
      .boolean()
      .optional()
      .describe("Set true only when the user asks for completed, cancelled, declined, closed, or historical policy change requests."),
  }),
});

export const draftPolicyChangeSubmission = tool({
  description:
    "Draft the broker email for an existing policy change request. Use the current conversation's policy change case when a case ID is not explicitly known. If the recipient is unknown, draft the email and ask for the recipient instead of inventing an email address.",
  inputSchema: z.object({
    caseId: z.string().optional().describe("Existing policy change case ID, if known"),
    recipientEmail: z.string().optional().describe("Known recipient email, if explicitly provided or already known"),
    recipientName: z.string().optional().describe("Known recipient name, if available"),
    instructions: z.string().optional().describe("Extra instructions to include in the draft"),
  }),
});

export const completePolicyChangeFromEndorsement = tool({
  description:
    "Complete a policy change after the updated endorsement has been received. Use only with actual endorsement files already stored in the current thread or inbound message. This appends the endorsement to the existing policy and marks the case complete.",
  inputSchema: z.object({
    caseId: z.string().optional().describe("Policy change case ID, if known"),
    policyId: z.string().describe("Existing policy reference to append the endorsement to. This may be a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy."),
    files: z
      .array(z.object({
        fileId: z.string().describe("Stored Convex file ID for the endorsement attachment"),
        fileName: z.string().describe("Attachment filename"),
      }))
      .min(1)
      .describe("Stored endorsement files to append"),
    summary: z.string().optional().describe("Short completion summary"),
    fieldUpdates: z.record(z.string(), z.any()).optional().describe("Only fields explicitly changed by the endorsement"),
  }),
});

export const createImessageGroupChat = tool({
  description:
    "Create a new iMessage group chat after the user explicitly asks for it or clearly approves the assistant's suggestion. Include the current user automatically; recipients can be teammate names, broker/client/vendor names, or explicit phone numbers. If any recipient is ambiguous or lacks a phone number, ask for clarification instead of guessing.",
  inputSchema: z.object({
    recipients: z
      .array(z.string())
      .min(1)
      .describe("People or phone numbers to include besides the current user, such as Adyan, my broker, or +15555550123."),
    openingMessage: z
      .string()
      .min(1)
      .describe("The first message Glass should send into the new group chat."),
    title: z
      .string()
      .optional()
      .describe("Optional concise group title. Leave unset unless the user requested a title."),
    confirmed: z
      .boolean()
      .describe("True only when the user has explicitly asked to create the group or has approved a prior suggestion."),
  }),
});

export const searchConnectedEmail = tool({
  description:
    "Search connected IMAP email accounts live without persisting mailbox contents. Use this iteratively with targeted search terms and date windows when the user asks to find emails, policies, leases, vendor messages, requirements, receipts, or attachments in connected mailboxes.",
  inputSchema: z.object({
    query: z.string().optional().describe("Text to search for in subject, sender, recipients, or message body."),
    mailbox: z.string().optional().describe("Mailbox/folder name. Defaults to INBOX."),
    sinceDays: z.number().int().min(1).max(90).optional().describe("Fallback rolling lookback when dateFrom/dateTo are not known. Defaults to 14."),
    dateFrom: z.string().optional().describe("Inclusive start date for a targeted search window in YYYY-MM-DD format."),
    dateTo: z.string().optional().describe("Inclusive end date for a targeted search window in YYYY-MM-DD format."),
    limit: z.number().int().min(1).max(25).optional().describe("Maximum matching emails to return."),
  }),
});

export const readConnectedEmail = tool({
  description:
    "Read one connected-email message returned by search_connected_email, including bounded body text and attachment metadata.",
  inputSchema: z.object({
    emailRef: z.string().describe("Opaque emailRef returned by search_connected_email."),
  }),
});

export const readConnectedEmailAttachment = tool({
  description:
    "Read text from a specific PDF, DOCX, TXT, Markdown, CSV, or JSON attachment on a connected-email message without persisting the mailbox message. Use after read_connected_email returns attachment metadata and the user needs the attachment contents inspected before deciding whether to import it.",
  inputSchema: z.object({
    emailRef: z.string().describe("Opaque emailRef returned by search_connected_email."),
    filename: z.string().describe("Exact attachment filename returned by read_connected_email."),
  }),
});

export const importConnectedEmailPolicyAttachments = tool({
  description:
    "Import PDF attachments from a connected-email message into the Glass policy library. Use after search/read confirms the attachments are policies, declarations, quotes, binders, COIs, or related insurance documents.",
  inputSchema: z.object({
    emailRef: z.string().describe("Opaque emailRef returned by search_connected_email."),
    filenames: z.array(z.string()).optional().describe("Specific PDF filenames to import. Omit to import all PDF attachments on the email as one policy package."),
  }),
});

export const importConnectedEmailRequirementAttachments = tool({
  description:
    "Import PDF/DOCX/TXT/CSV/JSON attachments and optionally the email body from a connected-email message as source-backed insurance compliance requirements. Use after search/read confirms the email or attachments contain leases, contracts, vendor requirement packets, or other insurance requirement language.",
  inputSchema: z.object({
    emailRef: z.string().describe("Opaque emailRef returned by search_connected_email."),
    filenames: z.array(z.string()).optional().describe("Specific attachment filenames to import. Omit to import all requirement-like attachments on the email."),
    includeEmailBody: z.boolean().optional().describe("Set true when the email body itself contains requirement language that should be imported."),
    sourceType: z
      .enum(["lease_agreement", "client_contract", "vendor_requirements", "other"])
      .optional()
      .describe("Source document type. Infer lease_agreement for leases and client_contract for customer/client contracts."),
    appliesTo: z
      .enum(["vendors", "own_org", "both"])
      .optional()
      .describe("Requirement ownership. Use own_org for the org's lease/client obligations, vendors for vendor/customer standards, or both if it applies to both."),
  }),
});

export const saveConnectedEmailAttachmentsToThread = tool({
  description:
    "Save attachments from a connected-email message into the current Glass thread so they can be reused later and attached to outbound email drafts without searching the mailbox again. Use after search/read identifies documents that are relevant to the user's task.",
  inputSchema: z.object({
    emailRef: z.string().describe("Opaque emailRef returned by search_connected_email."),
    filenames: z.array(z.string()).optional().describe("Specific attachment filenames to save. Omit to save all attachments on the email that fit size limits."),
  }),
});

export const saveConnectedEmailMessageToThread = tool({
  description:
    "Export the connected-email message itself into the current Glass thread as an attachable .eml proof document. Use this when the user asks to attach, forward, preserve, or provide proof of an email whose relevant content is in the email body rather than an attachment, such as a cancellation email, receipt, confirmation, notice, or correspondence.",
  inputSchema: z.object({
    emailRef: z.string().describe("Opaque emailRef returned by search_connected_email or read_connected_email."),
    filename: z
      .string()
      .optional()
      .describe("Optional filename for the saved email export. Defaults to a subject-based .eml name."),
  }),
});

export const sendConnectedVendorInvite = tool({
  description:
    "Send a connected-vendor access invitation to a vendor email address so the org can monitor that vendor's insurance records. Use only when the user asks to invite or connect a vendor, or explicitly approves doing so.",
  inputSchema: z.object({
    vendorEmail: z.string().email().describe("Vendor contact email address to invite."),
    relationshipLabel: z.string().optional().describe("Optional vendor/company label for the connected-org relationship."),
    note: z.string().optional().describe("Optional note to include in the vendor invitation email."),
  }),
});

export const coordinateMailboxTask = tool({
  description:
    "Delegate a complex connected-mailbox workflow to the Glass mailbox coordinator. Use this for multi-step requests like finding policies and importing them, finding a lease and extracting insurance requirements, or investigating vendor email history.",
  inputSchema: z.object({
    task: z.string().min(1).describe("The full mailbox task to complete, including any target vendor, address, policy, lease, or date details."),
  }),
});

export const webResearch = tool({
  description:
    "Search or retrieve public web content using the operator-configured browsing provider. Use only for public/current web facts, company websites, news, or source-backed public research. Do not include private policy text, mailbox bodies, policy numbers, source spans, personal data, or confidential customer data in the query.",
  inputSchema: z.object({
    query: z
      .string()
      .max(500)
      .optional()
      .describe("Public web search query. Omit when retrieving a specific URL."),
    url: z
      .string()
      .optional()
      .describe("Specific public http(s) URL to retrieve. Use this for known public pages."),
    goal: z
      .string()
      .max(500)
      .optional()
      .describe("Short public research goal, such as verifying company services or recent public news."),
    allowedDomains: z
      .array(z.string())
      .max(5)
      .optional()
      .describe("Optional public domains to restrict search results to."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Maximum public sources to return. Defaults to 5."),
  }),
});

export const renderEmailPreview = tool({
  description:
    "Render an outbound email draft as a visual artifact using a browser renderer. Use this when the user asks to screenshot, print, preview, inspect formatting, verify layout, or see what an email draft will look like. Returns a PNG screenshot or PDF printout attached to the current thread.",
  inputSchema: z.object({
    draftId: z
      .string()
      .optional()
      .describe("Specific pending email draft ID. Omit to render the current draft in this thread."),
    format: z
      .enum(["png", "pdf"])
      .optional()
      .describe("Render format. Use png for screenshots and pdf for printouts. Defaults to png."),
  }),
});

export const extractPolicyAttachment = tool({
  description:
    "Extract a policy from one OR MORE PDF attachments that were included with the email. " +
    "When multiple PDFs appear in the same email and together describe the same policy " +
    "(e.g. COI + declarations + policy wording), pass ALL of them in a single call so they " +
    "are combined into one policy record. Only split into separate calls if the email contains " +
    "attachments for DIFFERENT policies.",
  inputSchema: z.object({
    files: z
      .array(
        z.object({
          storageId: z
            .string()
            .describe("Convex storage ID of the PDF attachment"),
          fileName: z.string().describe("Original filename of the attachment"),
        }),
      )
      .min(1)
      .describe("One entry per PDF that belongs to this policy"),
  }),
});
