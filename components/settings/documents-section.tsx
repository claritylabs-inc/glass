"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsActions } from "@/app/settings/page";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { PolicyExtractionsLog } from "@/components/policy-extractions-log";
import { PillButton } from "@/components/ui/pill-button";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { Id } from "@/convex/_generated/dataModel";

/* ── DocumentsSection (main export) ── */
export function DocumentsSection() {
  const router = useRouter();
  const pathname = usePathname();
  const orgData = useQuery(api.orgs.viewerOrg);

  const policies = useQuery(api.policies.list, {});
  const contextDocs = useQuery(api.intelligence.listUploadedDocuments);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextFileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const removePolicy = useMutation(api.policies.remove);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload
  );
  const extractFromDocument = useAction(
    api.actions.extractFromDocument.extractFromDocument
  );

  const EXT_TYPE_MAP: Record<string, string> = {
    ".md": "text/markdown",
    ".mdx": "text/mdx",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const uploadToStorage = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    const url = await generateUploadUrl();
    const contentType =
      file.type || EXT_TYPE_MAP[ext] || "application/octet-stream";
    const result = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: file,
    });
    const { storageId } = await result.json();
    return storageId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateUploadUrl]);

  const handleInsuranceUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Insurance documents must be PDF files");
      return;
    }
    setUploading(true);
    try {
      const storageId = await uploadToStorage(file);
      toast.success("Uploaded, extracting policy...");
      router.push(`${pathname}?section=documents`);
      const outcome = await extractFromUpload({
        fileId: storageId,
        fileName: file.name,
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
      } else {
        toast.success(
          `${outcome.type === "quote" ? "Quote" : "Policy"} extracted successfully`
        );
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [uploadToStorage, extractFromUpload, router, pathname]);

  const handleContextUpload = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    const supported = [
      ".pdf", ".md", ".mdx", ".csv", ".doc", ".docx", ".xls", ".xlsx",
    ];
    if (!supported.includes(ext)) {
      toast.error("Supported: PDF, Word, Excel, CSV, Markdown");
      return;
    }
    setUploading(true);
    try {
      const storageId = await uploadToStorage(file);
      toast.success("Uploaded, extracting business context...");
      const outcome = await extractFromDocument({
        fileId: storageId,
        fileName: file.name,
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
      } else {
        toast.success(`${outcome.entries} intelligence entries extracted`);
        router.push(`${pathname}?section=intelligence`);
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (contextFileInputRef.current) contextFileInputRef.current.value = "";
    }
  }, [uploadToStorage, extractFromDocument, router, pathname]);

  // Header actions
  const { setActions } = useSettingsActions();

  useEffect(() => {
    setActions(
      <div className="flex items-center gap-2">
        <PillButton
          size="compact"
          variant="secondary"
          onClick={() => contextFileInputRef.current?.click()}
          disabled={uploading}
        >
          Upload document
        </PillButton>
        <PillButton
          size="compact"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Upload policy"}
        </PillButton>
      </div>
    );
    return () => setActions(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading]);

  // Build unified document list
  const uploadedPolicies = (policies ?? []).filter(
    (p: { fileId?: string; emailId?: string }) => p.fileId && !p.emailId
  );

  const loading = policies === undefined || contextDocs === undefined;

  return (
    <div className="space-y-6">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleInsuranceUpload(f);
        }}
      />
      <input
        ref={contextFileInputRef}
        type="file"
        accept=".pdf,.md,.mdx,.csv,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleContextUpload(f);
        }}
      />

      {/* ── Uploaded documents list ── */}
      <section>
        {loading && (
          <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-foreground/6">
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="divide-y divide-foreground/4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Skeleton className="h-4 w-48 mb-1.5" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && uploadedPolicies.length === 0 && (!contextDocs || contextDocs.length === 0) && (
          <FadeIn when={true} delay={0.2} duration={0.6}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  if (file.name.toLowerCase().endsWith(".pdf")) {
                    handleInsuranceUpload(file);
                  } else {
                    handleContextUpload(file);
                  }
                }
              }}
              className={`rounded-lg border bg-card overflow-hidden transition-colors ${
                dragging ? "border-primary/40 bg-primary/[0.02]" : "border-foreground/6"
              }`}
            >
              <div className="px-5 py-3.5 border-b border-foreground/6">
                <h3 className="!mb-0 text-sm font-medium text-foreground">Uploaded documents</h3>
              </div>
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground/60">
                  No documents uploaded yet
                </p>
                <p className="text-xs text-muted-foreground/40 mt-0.5">
                  {dragging ? "Drop to upload" : "Drag a file here or use the upload buttons above"}
                </p>
              </div>
            </div>
          </FadeIn>
        )}

        {!loading && (uploadedPolicies.length > 0 || (contextDocs && contextDocs.length > 0)) && (
          <FadeIn when={true} delay={0.2} duration={0.6}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  if (file.name.toLowerCase().endsWith(".pdf")) {
                    handleInsuranceUpload(file);
                  } else {
                    handleContextUpload(file);
                  }
                }
              }}
              className={`rounded-lg border bg-card overflow-hidden transition-colors ${
                dragging ? "border-primary/40 bg-primary/[0.02]" : "border-foreground/6"
              }`}
            >
              <div className="px-5 py-3.5 border-b border-foreground/6">
                <h3 className="!mb-0 text-sm font-medium text-foreground">Uploaded documents</h3>
              </div>

              <div className="divide-y divide-foreground/4">
                {/* Insurance documents */}
                {uploadedPolicies.map((doc: { _id: string; fileName?: string; carrier?: string; security?: string; documentType?: string; extractionStatus?: string }) => (
                  <div
                    key={doc._id}
                    className="px-5 py-3 flex items-center gap-3 group hover:bg-foreground/[0.015] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {doc.fileName || doc.carrier || "Document"}
                      </p>
                      <p className="text-xs text-muted-foreground/50 truncate mt-0.5">
                        {doc.carrier ? `${doc.security || doc.carrier}` : ""}
                        {doc.extractionStatus === "complete"
                          ? doc.carrier ? " · Extracted" : "Extracted"
                          : doc.extractionStatus === "extracting"
                            ? doc.carrier ? " · Extracting..." : "Extracting..."
                            : ""}
                      </p>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 shrink-0">
                      {doc.documentType === "quote" ? "Quote" : "Policy"}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        setRemovingId(doc._id);
                        try {
                          await removePolicy({ id: doc._id as Id<"policies"> });
                          toast.success("Document removed");
                        } catch {
                          toast.error("Failed to remove document");
                        } finally {
                          setRemovingId(null);
                        }
                      }}
                      disabled={removingId === doc._id}
                      className="p-1 text-muted-foreground/20 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {/* Context documents */}
                {contextDocs?.map((doc) => (
                  <div
                    key={doc.sourceRef}
                    className="px-5 py-3 flex items-center gap-3 hover:bg-foreground/[0.015] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {doc.sourceLabel || "Document"}
                      </p>
                      <p className="text-xs text-muted-foreground/50 truncate mt-0.5">
                        {doc.entryCount} {doc.entryCount === 1 ? "entry" : "entries"} extracted
                      </p>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-foreground/[0.06] text-muted-foreground shrink-0">
                      Context
                    </span>
                  </div>
                ))}
              </div>

              {/* Drop hint footer */}
              <div className={`border-t border-foreground/4 px-5 py-2 bg-foreground/[0.01] transition-colors ${dragging ? "bg-primary/[0.04]" : ""}`}>
                <p className="text-xs text-muted-foreground/40">
                  {dragging ? "Drop to upload" : "Drag files here to upload"}
                </p>
              </div>
            </div>
          </FadeIn>
        )}
      </section>

      {/* ── Extraction log ── */}
      <section>
        <PolicyExtractionsLog />
      </section>
    </div>
  );
}
