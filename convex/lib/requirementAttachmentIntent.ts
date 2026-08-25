"use node";

import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateObjectForOrg } from "./models";
import type { RequirementScope } from "./complianceTypes";

type AttachmentCandidate = {
  filename: string;
  contentType: string;
  fileId?: Id<"_storage">;
};

const REQUIREMENT_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
]);

export const RequirementAttachmentDecisionSchema = z.object({
  intent: z.enum([
    "import_new_requirements",
    "analyze_new_requirements",
    "use_existing_requirements",
    "no_import",
    "ambiguous",
  ]),
  intentEvidence: z.string().max(240),
  scope: z.enum(["vendors", "own_org", "mixed", "ambiguous"]),
  selectedFileIds: z.array(z.string()).max(20),
  documents: z
    .array(
      z.object({
        fileId: z.string(),
        classification: z.enum([
          "insurance_requirements",
          "insurance_policy",
          "certificate",
          "other",
        ]),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
  confidence: z.number().min(0).max(1),
});

export type RequirementAttachmentDecision = z.infer<
  typeof RequirementAttachmentDecisionSchema
>;

export type RequirementImportResolution<T extends AttachmentCandidate> = {
  authorization: "auto" | "confirmation" | "none";
  attachments: Array<T & { fileId: Id<"_storage"> }>;
  scope?: RequirementScope;
  decision?: RequirementAttachmentDecision;
};

function supportedRequirementCandidate(attachment: AttachmentCandidate) {
  const extension = attachment.filename.toLowerCase().split(".").pop() ?? "";
  const contentType = attachment.contentType.toLowerCase();
  return (
    REQUIREMENT_DOCUMENT_EXTENSIONS.has(extension) ||
    contentType === "application/pdf" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "text/csv"
  );
}

export function validateRequirementAttachmentDecision<
  T extends AttachmentCandidate,
>(
  value: unknown,
  attachments: T[],
): RequirementImportResolution<T> {
  const parsed = RequirementAttachmentDecisionSchema.safeParse(value);
  if (!parsed.success) return { authorization: "none", attachments: [] };

  const decision = parsed.data;
  const candidates = new Map(
    attachments
      .filter(
        (attachment): attachment is T & { fileId: Id<"_storage"> } =>
          Boolean(attachment.fileId) && supportedRequirementCandidate(attachment),
      )
      .map((attachment) => [String(attachment.fileId), attachment]),
  );
  const classifications = new Map(
    decision.documents.map((document) => [document.fileId, document]),
  );
  const selected = [...new Set(decision.selectedFileIds)].flatMap((fileId) => {
    const attachment = candidates.get(fileId);
    const classification = classifications.get(fileId);
    return attachment &&
      classification?.classification === "insurance_requirements"
      ? [attachment]
      : [];
  });
  const explicitlyUsesNewSource =
    decision.intent === "import_new_requirements" ||
    decision.intent === "analyze_new_requirements";
  if (!explicitlyUsesNewSource || selected.length === 0) {
    return { authorization: "none", attachments: [], decision };
  }

  const scope =
    decision.scope === "vendors" || decision.scope === "own_org"
      ? decision.scope
      : undefined;
  const selectedConfidence = Math.min(
    ...selected.map(
      (attachment) => classifications.get(String(attachment.fileId))!.confidence,
    ),
  );
  const autoAuthorized =
    Boolean(decision.intentEvidence.trim()) &&
    Boolean(scope) &&
    decision.confidence >= 0.9 &&
    selectedConfidence >= 0.9;

  return {
    authorization: autoAuthorized ? "auto" : "confirmation",
    attachments: selected,
    scope,
    decision,
  };
}

export async function decideRequirementAttachmentImport<
  T extends AttachmentCandidate,
>(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    messageText: string;
    attachments: T[];
  },
): Promise<RequirementImportResolution<T>> {
  const candidates = args.attachments.filter(
    (attachment) => attachment.fileId && supportedRequirementCandidate(attachment),
  );
  if (candidates.length === 0) {
    return { authorization: "none", attachments: [] };
  }

  try {
    const { object } = await generateObjectForOrg(
      ctx,
      args.orgId,
      "classification",
      {
        schema: RequirementAttachmentDecisionSchema,
        maxOutputTokens: 700,
        system: `Classify whether the user explicitly wants newly attached files treated as canonical insurance-requirement sources.

Return structured evidence only. Distinguish agreements, leases, contracts, insurance schedules, and requirement packets from insurance policies, binders, declarations, endorsements, and certificates. A request to compare a policy with already-saved requirements is not a request to import the policy. Negated persistence instructions are no_import. Scope must be vendors only when the requirements govern vendors/contractors/suppliers/tenants, own_org only when they govern the user's organization, mixed when both are explicit, and ambiguous otherwise. Select only exact file IDs from the supplied candidates. Confidence measures the entire decision, and each document gets its own classification confidence.`,
        prompt: JSON.stringify({
          message: args.messageText,
          attachments: candidates.map((attachment) => ({
            fileId: String(attachment.fileId),
            filename: attachment.filename,
            contentType: attachment.contentType,
          })),
        }),
      },
    );
    return validateRequirementAttachmentDecision(object, candidates);
  } catch {
    return { authorization: "none", attachments: [] };
  }
}

export function requiredRequirementImportStep(
  stepNumber: number,
  hasAuthorizedRequirementAttachments: boolean,
) {
  if (
    !hasAuthorizedRequirementAttachments ||
    stepNumber < 0 ||
    stepNumber > 1
  ) {
    return undefined;
  }
  return {
    toolChoice: {
      type: "tool" as const,
      toolName:
        stepNumber === 0
          ? ("import_requirement_attachments" as const)
          : ("lookup_compliance_requirements" as const),
    },
  };
}
