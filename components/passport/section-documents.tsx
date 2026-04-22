"use client";

import { useCallback, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { api as _api } from "@/convex/_generated/api";
import { PillButton } from "@/components/ui/pill-button";
import { FileDropZone } from "@/components/ui/file-drop";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

const CONTEXT_SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".md",
  ".mdx",
  ".csv",
  ".docx",
  ".xlsx",
  ".xls",
  ".ods",
  ".txt",
  ".tsv",
  ".json",
] as const;

const CONTEXT_ACCEPT = CONTEXT_SUPPORTED_EXTENSIONS.join(",");

const EXT_TYPE_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".mdx": "text/mdx",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
};

export function SectionDocuments() {
  const router = useRouter();
  const orgDocuments = useQuery(api.orgDocuments.list, {});
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const createOrgDocument = useMutation(api.orgDocuments.create);
  const removeOrgDocument = useMutation(api.orgDocuments.remove);
  const extractFromDocument = useAction(api.actions.extractFromDocument.extractFromDocument);

  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const hasDocuments = (orgDocuments?.length ?? 0) > 0;

  const handleContextUpload = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!CONTEXT_SUPPORTED_EXTENSIONS.includes(ext as (typeof CONTEXT_SUPPORTED_EXTENSIONS)[number])) {
      toast.error("Supported: PDF, DOCX, XLSX/XLS/ODS, CSV/TSV, Markdown, TXT, JSON");
      return;
    }
    setUploading(true);
    try {
      const contentType = file.type || EXT_TYPE_MAP[ext] || "application/octet-stream";
      const url = await generateUploadUrl();
      const result = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });
      const { storageId } = await result.json();
      const documentId = await createOrgDocument({
        storageId,
        fileName: file.name,
        mimeType: file.type || EXT_TYPE_MAP[ext] || undefined,
        size: file.size,
      });
      toast.success("Uploaded, extracting business context...");
      // NOTE: extractFromDocument runs synchronously in one Convex action (not backgrounded).
      // This works for typical documents but can time-out on very large files.
      // Future: migrate to cl-pipelines similar to applicationExtraction.
      const outcome = await extractFromDocument({
        fileId: storageId,
        fileName: file.name,
        documentId,
      });
      if ("error" in outcome) toast.error(outcome.error);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }, [generateUploadUrl, createOrgDocument, extractFromDocument]);

  return (
    <div className="space-y-6">
      <FileDropZone
        onFile={handleContextUpload}
        accept={CONTEXT_ACCEPT}
        disabled={uploading}
        idleLabel="Drop documents here"
        activeLabel="Release to upload"
        busyLabel="Uploading…"
        hint="PDF, DOCX, XLSX, CSV, TXT, and more"
      />

      {orgDocuments && orgDocuments.length > 0 ? (
        <ul className="divide-y divide-foreground/4 rounded-lg border border-foreground/8 overflow-hidden">
          {(orgDocuments as Array<{ _id: string; fileName?: string; sourceLabel?: string; extractionStatus?: string }>).map((doc) => (
            <li key={doc._id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">
                  {doc.sourceLabel || doc.fileName || "Document"}
                </p>
              </div>
              {doc.extractionStatus === "extracting" || doc.extractionStatus === "pending" ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Extracting
                </span>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  setRemovingId(doc._id);
                  try {
                    await removeOrgDocument({ id: doc._id as Parameters<typeof removeOrgDocument>[0]["id"] });
                  } catch {
                    toast.error("Failed to remove document");
                  } finally {
                    setRemovingId(null);
                  }
                }}
                disabled={removingId === doc._id}
                className="text-xs text-muted-foreground/60 hover:text-red-500 transition-colors shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col items-start gap-3">
        <PillButton
          type="button"
          onClick={() => router.push("/onboarding/passport/email")}
          disabled={!hasDocuments}
          className="w-full justify-center text-sm shadow-none sm:w-auto"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </PillButton>
        {!hasDocuments ? (
          <button
            type="button"
            onClick={() => router.push("/onboarding/passport/email")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </div>
  );
}
