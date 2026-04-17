"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Upload, FileText, Trash2 } from "lucide-react";
import { PolicyExtractionsLog } from "@/components/policy-extractions-log";
import { Id } from "@/convex/_generated/dataModel";

/* ── UploadedDocumentsInline ── */
function UploadedDocumentsInline() {
  const policies = useQuery(api.policies.list, {});
  const removePolicy = useMutation(api.policies.remove);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const uploaded = (policies ?? []).filter(
    (p: { fileId?: string; emailId?: string }) => p.fileId && !p.emailId
  );

  if (uploaded.length === 0) return null;

  return (
    <div className="divide-y divide-foreground/4 border-b border-foreground/6">
      {uploaded.map((doc: { _id: string; fileName?: string; carrier?: string; security?: string; documentType?: string; extractionStatus?: string }) => (
        <div
          key={doc._id}
          className="px-4 py-2.5 flex items-center gap-3 group hover:bg-foreground/[0.015] transition-colors"
        >
          <FileText className="w-4 h-4 text-muted-foreground/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-body-sm text-foreground truncate">
              {doc.fileName || doc.carrier || "Document"}
            </p>
            <p className="text-label-sm text-muted-foreground/50 truncate">
              {doc.documentType === "quote" ? "Quote" : "Policy"}
              {doc.carrier ? ` · ${doc.security || doc.carrier}` : ""}
              {doc.extractionStatus === "complete"
                ? " · Extracted"
                : doc.extractionStatus === "extracting"
                  ? " · Extracting..."
                  : ""}
            </p>
          </div>
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
    </div>
  );
}

/* ── UploadedContextDocsInline ── */
function UploadedContextDocsInline() {
  const docs = useQuery(api.intelligence.listUploadedDocuments);

  if (!docs || docs.length === 0) return null;

  return (
    <div className="divide-y divide-foreground/4 border-b border-foreground/6">
      {docs.map((doc) => (
        <div
          key={doc.sourceRef}
          className="px-4 py-2.5 flex items-center gap-3 hover:bg-foreground/[0.015] transition-colors"
        >
          <FileText className="w-4 h-4 text-muted-foreground/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-body-sm text-foreground truncate">
              {doc.sourceLabel || "Document"}
            </p>
            <p className="text-label-sm text-muted-foreground/50 truncate">
              {doc.entryCount} {doc.entryCount === 1 ? "entry" : "entries"} extracted
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── DocumentsSection (main export) ── */
export function DocumentsSection() {
  const router = useRouter();
  const pathname = usePathname();
  const orgData = useQuery(api.orgs.viewerOrg);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextFileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
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

  const uploadToStorage = async (file: File) => {
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
  };

  const handleInsuranceUpload = async (file: File) => {
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
  };

  const handleContextUpload = async (file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    const supported = [
      ".pdf",
      ".md",
      ".mdx",
      ".csv",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
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
  };

  return (
    <div className="space-y-10">
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

      {/* ── Upload areas ── */}
      <section>
        <div className="mb-3">
          <h3 className="text-body-sm font-medium text-foreground !mb-0">
            Uploaded Documents
          </h3>
          <p className="text-label-sm text-muted-foreground/60">
            Upload insurance policies and business context documents
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Insurance Documents */}
          <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-foreground/6 bg-foreground/[0.015]">
              <p className="text-label-sm font-medium text-muted-foreground">
                Insurance Documents
              </p>
              <p className="text-[11px] text-muted-foreground/50">
                Policies and certificates
              </p>
            </div>
            <UploadedDocumentsInline />
            <div className="p-3 mt-auto">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleInsuranceUpload(file);
                }}
                className={`rounded-lg border-2 border-dashed transition-all cursor-pointer px-4 py-3.5 group ${
                  dragging
                    ? "border-primary/40 bg-primary/[0.04]"
                    : "border-foreground/8 hover:border-foreground/15 bg-foreground/[0.01] hover:bg-foreground/[0.025]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      dragging
                        ? "bg-primary/10"
                        : "bg-foreground/[0.04] group-hover:bg-foreground/[0.08]"
                    }`}
                  >
                    <Upload
                      className={`w-3.5 h-3.5 transition-colors ${
                        dragging
                          ? "text-primary"
                          : "text-muted-foreground/40 group-hover:text-muted-foreground/60"
                      }`}
                    />
                  </div>
                  <div className="text-left">
                    <p className="text-body-sm font-medium text-foreground">
                      {uploading ? "Uploading..." : "Upload or drag a PDF"}
                    </p>
                    <p className="text-[11px] text-muted-foreground/50">
                      Policy or certificate
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Business Context */}
          <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-foreground/6 bg-foreground/[0.015]">
              <p className="text-label-sm font-medium text-muted-foreground">
                Business Context
              </p>
              <p className="text-[11px] text-muted-foreground/50">
                Enrich your intelligence profile
              </p>
            </div>
            <UploadedContextDocsInline />
            <div className="p-3 mt-auto">
              <div
                onClick={() => contextFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleContextUpload(file);
                }}
                className={`rounded-lg border-2 border-dashed transition-all cursor-pointer px-4 py-3.5 group ${
                  dragging
                    ? "border-primary/40 bg-primary/[0.04]"
                    : "border-foreground/8 hover:border-foreground/15 bg-foreground/[0.01] hover:bg-foreground/[0.025]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      dragging
                        ? "bg-primary/10"
                        : "bg-foreground/[0.04] group-hover:bg-foreground/[0.08]"
                    }`}
                  >
                    <Upload
                      className={`w-3.5 h-3.5 transition-colors ${
                        dragging
                          ? "text-primary"
                          : "text-muted-foreground/40 group-hover:text-muted-foreground/60"
                      }`}
                    />
                  </div>
                  <div className="text-left">
                    <p className="text-body-sm font-medium text-foreground">
                      {uploading ? "Uploading..." : "Upload or drag a document"}
                    </p>
                    <p className="text-[11px] text-muted-foreground/50">
                      {orgData?.org?.industry
                        ? `e.g. incorporation docs, pitch deck, ${orgData.org.industry.toLowerCase()} certificates`
                        : "e.g. incorporation docs, pitch deck, financials"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Extraction log ── */}
      <section>
        <PolicyExtractionsLog />
      </section>
    </div>
  );
}
