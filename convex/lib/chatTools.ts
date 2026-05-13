import { tool } from "ai";
import { z } from "zod";
import { PCE_REQUEST_KINDS } from "./pceIntake";

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
    policyId1: z.string().describe("ID of the first policy to compare"),
    policyId2: z.string().describe("ID of the second policy to compare"),
  }),
});

export const lookupComplianceRequirements = tool({
  description:
    "Look up the organization's saved insurance compliance requirements. Use this when the user asks what contractors/vendors must carry, asks about internal insurance standards, minimum required limits, deductibles, endorsements, certificate instructions, or compliance checklist requirements.",
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
        "Filter by requirement scope. Use vendors for contractor/vendor requirements, own_org for my requirements, both for shared requirements, or all to search every requirement.",
      ),
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
    policyId: z.string().optional().describe("Related policy ID if applicable"),
  }),
});

export const lookupPolicySection = tool({
  description:
    "Search within a specific policy's extracted document for detailed content about a topic. Use this for coverage details, covered reasons, exclusions, conditions, endorsements, definitions, or exact policy language that is not in summary data. Returns matching policy wording and structured entries.",
  inputSchema: z.object({
    policyId: z.string().describe("The policy ID to search within"),
    query: z
      .string()
      .describe(
        "What to search for — coverage name, section title, topic, or keywords",
      ),
  }),
});

export const generateCoi = tool({
  description:
    "Generate a Certificate of Insurance (COI) PDF for a specific policy.",
  inputSchema: z.object({
    policyId: z.string().describe("The policy ID to generate the COI for"),
    certificateHolder: z
      .string()
      .optional()
      .describe("Name/address of the certificate holder"),
  }),
});

export const createPolicyChangeRequest = tool({
  description:
    "Create a policy change endorsement (PCE) request packet from the user's instructions. Use this only for actual policy-record changes: named insured changes, additional insured/endorsement requests, limit or deductible changes, location/vehicle changes, cancellations, nonrenewals, renewal update packets, or certificate-driven endorsement requirements. Do not use this for ordinary COI generation or certificate-holder-only instructions.",
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
    policyId: z.string().optional().describe("Related policy ID, if known"),
    evidenceSourceIds: z
      .array(z.string())
      .optional()
      .describe(
        "Stable source span IDs that support quoted existing policy values",
      ),
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
