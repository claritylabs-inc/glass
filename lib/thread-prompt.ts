import type { FileUIPart } from "ai";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { Id } from "@/convex/_generated/dataModel";

export type PromptReferenceIds = {
  referencedPolicyIds?: Id<"policies">[];
  referencedQuoteIds?: Id<"policies">[];
  referencedRequirementIds?: Id<"insuranceRequirements">[];
  referencedMailboxIds?: Id<"connectedEmailAccounts">[];
};

export type ThreadPromptAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId: Id<"_storage">;
};

type PromptReferenceKind = NonNullable<
  PromptInputMessage["references"]
>[number]["kind"];

export function inferAttachmentContentType(
  filename: string | undefined,
  mediaType: string | undefined,
) {
  if (mediaType) return mediaType;
  const lowerName = filename?.toLowerCase() ?? "";
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".tsv")) return "text/tab-separated-values";
  if (lowerName.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lowerName.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lowerName.endsWith(".xlsm"))
    return "application/vnd.ms-excel.sheet.macroEnabled.12";
  if (lowerName.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lowerName.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg"))
    return "image/jpeg";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".txt")) return "text/plain";
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown"))
    return "text/markdown";
  if (lowerName.endsWith(".json")) return "application/json";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export function optimisticPromptAttachments(files: FileUIPart[]) {
  if (files.length === 0) return undefined;
  return files.map((file) => ({
    filename: file.filename ?? "file",
    contentType: inferAttachmentContentType(file.filename, file.mediaType),
    size: 0,
  }));
}

export function promptReferenceIds(
  references: PromptInputMessage["references"],
): PromptReferenceIds {
  return {
    referencedPolicyIds: referenceIds<Id<"policies">>(references, "policy"),
    referencedQuoteIds: referenceIds<Id<"policies">>(references, "quote"),
    referencedRequirementIds: referenceIds<Id<"insuranceRequirements">>(
      references,
      "requirement",
    ),
    referencedMailboxIds: referenceIds<Id<"connectedEmailAccounts">>(
      references,
      "mailbox",
    ),
  };
}

export async function uploadPromptFiles(
  files: FileUIPart[],
  generateUploadUrl: () => Promise<string>,
): Promise<ThreadPromptAttachment[]> {
  const attachments: ThreadPromptAttachment[] = [];

  for (const file of files) {
    const uploadUrl = await generateUploadUrl();
    const blob = await fetch(file.url).then((response) => response.blob());
    const contentType = inferAttachmentContentType(
      file.filename,
      file.mediaType,
    );
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: blob,
    });

    if (!response.ok) continue;

    const { storageId } = (await response.json()) as { storageId: string };
    attachments.push({
      filename: file.filename ?? "file",
      contentType,
      size: blob.size,
      fileId: storageId as Id<"_storage">,
    });
  }

  return attachments;
}

function referenceIds<TId extends string>(
  references: PromptInputMessage["references"],
  kind: PromptReferenceKind,
) {
  const ids = (references ?? [])
    .filter((reference) => reference.kind === kind)
    .map((reference) => reference.id as TId);
  return ids.length > 0 ? ids : undefined;
}
