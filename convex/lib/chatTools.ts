import { tool } from "ai";
import { z } from "zod";

/**
 * Tool definitions for agentic chat.
 * These schemas are shared between processThreadChat (Convex) and /api/chat (Next.js).
 * Execute functions are wired up in each action separately.
 */

export const lookupPolicy = tool({
  description:
    "Search for insurance policies by carrier name, policy number, policy type, or keywords. Returns matching policy summaries.",
  inputSchema: z.object({
    query: z.string().describe("Search query — carrier name, policy number, or keywords"),
    policyType: z.string().optional().describe("Filter by policy type (e.g., general_liability, commercial_auto)"),
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

export const checkApplicationStatus = tool({
  description:
    "Look up the progress of an insurance application session — status, filled fields, pending questions.",
  inputSchema: z.object({
    applicationId: z.string().optional().describe("Application session ID"),
    query: z.string().optional().describe("Search by application title or file name"),
  }),
});

export const saveNote = tool({
  description:
    "Save an observation or note about a policy or the organization for future reference.",
  inputSchema: z.object({
    content: z.string().describe("The observation or note to save"),
    type: z.enum(["fact", "preference", "risk_note", "observation"]).describe("Type of note"),
    policyId: z.string().optional().describe("Related policy ID if applicable"),
  }),
});

export const generateCoi = tool({
  description:
    "Generate a Certificate of Insurance (COI) PDF for a specific policy.",
  inputSchema: z.object({
    policyId: z.string().describe("The policy ID to generate the COI for"),
    certificateHolder: z.string().optional().describe("Name/address of the certificate holder"),
  }),
});
