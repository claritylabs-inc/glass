import type { RequirementScope } from "./complianceTypes";

type AttachmentCandidate = {
  filename: string;
  contentType: string;
  fileId?: unknown;
};

const REQUIREMENT_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
] as const;

const REQUIREMENT_INTENT =
  /\b(?:insurance\s+requirements?|compliance\s+requirements?|coverage\s+requirements?|minimum\s+(?:insurance|coverage)|must\s+carry|meet\s+(?:all\s+)?(?:the\s+)?requirements?|comply\s+with\s+(?:all\s+)?(?:the\s+)?requirements?)\b/i;
const SOURCE_TEXT_CUE =
  /\b(?:agreement|contract|lease|insurance\s+(?:schedule|specifications?)|requirements?\s+(?:document|packet|schedule)|vendor\s+packet)\b/i;
const SOURCE_FILENAME_CUE =
  /(?:agreement|contract|lease|requirement|insurance[-_ ]?(?:schedule|spec)|vendor[-_ ]?packet)/i;
const POLICY_FILENAME_CUE =
  /(?:policy|declaration|binder|endorsement|certificate|\bcoi\b)/i;
const EXPLICIT_ATTACHMENT_CUE =
  /\b(?:attached|attachment|this\s+(?:document|file|pdf)|from\s+(?:this|the)\s+(?:document|file|pdf))\b/i;
const IMPORT_FORBIDDEN =
  /\b(?:do\s+not|don['’]t|dont|without)\b[^.!?\n]{0,100}\b(?:import|save|store|create|persist|change)\b/i;

function supportsRequirementImport(attachment: AttachmentCandidate) {
  const filename = attachment.filename.toLowerCase();
  const contentType = attachment.contentType.toLowerCase();
  return (
    REQUIREMENT_DOCUMENT_EXTENSIONS.some((extension) =>
      filename.endsWith(extension),
    ) ||
    contentType.includes("pdf") ||
    contentType.includes("wordprocessingml") ||
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("csv")
  );
}

export function selectRequirementImportAttachments<
  T extends AttachmentCandidate,
>(messageText: string, attachments: T[]): T[] {
  if (
    IMPORT_FORBIDDEN.test(messageText) ||
    !REQUIREMENT_INTENT.test(messageText)
  ) {
    return [];
  }

  const messageIdentifiesSource = SOURCE_TEXT_CUE.test(messageText);
  const explicitlyPointsToAttachment = EXPLICIT_ATTACHMENT_CUE.test(messageText);
  return attachments.filter((attachment) => {
    if (!attachment.fileId || !supportsRequirementImport(attachment)) {
      return false;
    }
    if (SOURCE_FILENAME_CUE.test(attachment.filename)) return true;
    if (messageIdentifiesSource) return true;
    return (
      explicitlyPointsToAttachment &&
      !POLICY_FILENAME_CUE.test(attachment.filename)
    );
  });
}

export function inferRequirementImportScope(
  messageText: string,
): RequirementScope | undefined {
  if (/\b(?:vendor|contractor|supplier|tenant)s?\b/i.test(messageText)) {
    return "vendors";
  }
  if (
    /\b(?:we|our|ours|us|my|mine)\b[^.!?\n]{0,100}\b(?:meet|comply|carry|required|requirements?|obligations?)\b/i.test(
      messageText,
    ) ||
    /\b(?:requirements?|obligations?)\b[^.!?\n]{0,100}\b(?:we|our|ours|us|my|mine)\b/i.test(
      messageText,
    )
  ) {
    return "own_org";
  }
  return undefined;
}

export function requiredRequirementImportStep(
  stepNumber: number,
  hasRequirementAttachments: boolean,
) {
  if (!hasRequirementAttachments || stepNumber > 1) return undefined;
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
