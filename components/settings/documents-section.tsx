"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsActions } from "@/app/settings/page";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Id } from "@/convex/_generated/dataModel";

type DocumentTab = "org-context" | "policy-extractions";

const CONTEXT_SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".md",
  ".mdx",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
] as const;

function formatCreatedAt(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function extractionStatusLabel(status?: string) {
  switch (status) {
    case "extracting":
      return "Extracting";
    case "paused":
      return "Paused";
    case "error":
      return "Failed";
    case "pending":
      return "Queued";
    case "not_insurance":
      return "Dismissed";
    case "complete":
      return "Extracted";
    default:
      return "Awaiting extraction";
  }
}

/* ── DocumentsSection (main export) ── */
export function DocumentsSection() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DocumentTab>("org-context");

  const policies = useQuery(api.policies.list, {});
  const contextDocs = useQuery(api.intelligence.listUploadedDocuments);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextFileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const removePolicy = useMutation(api.policies.remove);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [runningActionKey, setRunningActionKey] = useState<string | null>(null);
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload
  );
  const extractFromDocument = useAction(
    api.actions.extractFromDocument.extractFromDocument
  );
  const pauseExtraction = useMutation(api.policies.pauseExtraction);
  const resumeExtraction = useMutation(api.policies.resumeExtraction);
  const cancelExtraction = useMutation(api.policies.cancelExtraction);
  const retryExtraction = useAction(api.actions.retryExtraction.retryExtraction);

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
  }, [uploadToStorage, extractFromUpload]);

  const handleContextUpload = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!CONTEXT_SUPPORTED_EXTENSIONS.includes(ext as (typeof CONTEXT_SUPPORTED_EXTENSIONS)[number])) {
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
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (contextFileInputRef.current) contextFileInputRef.current.value = "";
    }
  }, [uploadToStorage, extractFromDocument]);

  // Header actions
  const { setActions } = useSettingsActions();

  useEffect(() => {
    const policyAction = (
      <PillButton
        size="compact"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading..." : "Upload policy"}
      </PillButton>
    );

    const contextAction = (
      <PillButton
        size="compact"
        onClick={() => contextFileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading..." : "Upload org document"}
      </PillButton>
    );

    setActions(
      <div className="flex items-center gap-2">
        {activeTab === "org-context" ? contextAction : policyAction}
        {activeTab === "org-context" ? policyAction : contextAction}
      </div>
    );
    return () => setActions(null);
  }, [activeTab, setActions, uploading]);

  // Build unified document list
  const uploadedPolicies = (policies ?? [])
    .filter((p: { fileId?: string; emailId?: string }) => p.fileId && !p.emailId)
    .sort(
      (a: { _creationTime?: number }, b: { _creationTime?: number }) =>
        (b._creationTime ?? 0) - (a._creationTime ?? 0)
    );

  const loading = policies === undefined || contextDocs === undefined;
  const activePolicyCount = uploadedPolicies.filter((doc: { extractionStatus?: string }) =>
    ["extracting", "paused", "pending"].includes(doc.extractionStatus ?? "")
  ).length;
  const completedPolicyCount = uploadedPolicies.filter(
    (doc: { extractionStatus?: string }) => doc.extractionStatus === "complete"
  ).length;

  return (
    <div className="space-y-5">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setActiveTab("policy-extractions");
            handleInsuranceUpload(f);
          }
        }}
      />
      <input
        ref={contextFileInputRef}
        type="file"
        accept=".pdf,.md,.mdx,.csv,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setActiveTab("org-context");
            handleContextUpload(f);
          }
        }}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as DocumentTab)}
        className="space-y-5"
      >
        <TabsList variant="pill">
          <TabsTrigger value="org-context">Org context</TabsTrigger>
          <TabsTrigger value="policy-extractions">Policy extractions</TabsTrigger>
        </TabsList>

        <TabsContent value="org-context" className="space-y-4">
          {loading ? (
            <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-foreground/6">
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="divide-y divide-foreground/4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <Skeleton className="h-4 w-56 mb-1.5" />
                      <Skeleton className="h-3 w-36" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <FadeIn when={true} delay={0.2} duration={0.6}>
              <div
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
                className={`rounded-lg border bg-card overflow-hidden transition-colors ${
                  dragging ? "border-primary/40 bg-primary/[0.02]" : "border-foreground/6"
                }`}
              >
                <div className="px-5 py-3.5 border-b border-foreground/6 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="!mb-0 text-sm font-medium text-foreground">Org context documents</h3>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-foreground/[0.05] text-muted-foreground shrink-0">
                    {contextDocs?.length ?? 0} files
                  </span>
                </div>

                {!contextDocs || contextDocs.length === 0 ? (
                  <div className="px-6 py-9 text-center">
                    <p className="text-sm text-muted-foreground/65">No org context documents yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-foreground/4">
                    {contextDocs.map((doc) => (
                      <div
                        key={doc.sourceRef}
                        className="px-5 py-3 flex items-center gap-3 hover:bg-foreground/[0.015] transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {doc.sourceLabel || "Document"}
                          </p>
                          <p className="text-xs text-muted-foreground/55 truncate mt-0.5">
                            {doc.entryCount} {doc.entryCount === 1 ? "entry" : "entries"} extracted · {formatCreatedAt(doc.createdAt)}
                          </p>
                        </div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 shrink-0">
                          Context
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  className={`border-t border-foreground/4 px-5 py-2 bg-foreground/[0.01] transition-colors ${dragging ? "bg-primary/[0.04]" : ""}`}
                >
                  <p className="text-xs text-muted-foreground/40">{dragging ? "Drop to upload" : "Drag files here to upload"}</p>
                </div>
              </div>
            </FadeIn>
          )}
        </TabsContent>

        <TabsContent value="policy-extractions" className="space-y-4">
          {loading ? (
            <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-foreground/6">
                <Skeleton className="h-4 w-44" />
              </div>
              <div className="divide-y divide-foreground/4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <Skeleton className="h-4 w-56 mb-1.5" />
                      <Skeleton className="h-3 w-44" />
                    </div>
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <FadeIn when={true} delay={0.2} duration={0.6}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (!file) return;
                  if (!file.name.toLowerCase().endsWith(".pdf")) {
                    toast.error("Policy extraction accepts PDF files only");
                    return;
                  }
                  handleInsuranceUpload(file);
                }}
                className={`rounded-lg border bg-card overflow-hidden transition-colors ${
                  dragging ? "border-primary/40 bg-primary/[0.02]" : "border-foreground/6"
                }`}
              >
                <div className="px-5 py-3.5 border-b border-foreground/6 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="!mb-0 text-sm font-medium text-foreground">Policy extraction queue</h3>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-foreground/[0.05] text-muted-foreground shrink-0">
                    {uploadedPolicies.length} files
                  </span>
                </div>

                {uploadedPolicies.length === 0 ? (
                  <div className="px-6 py-9 text-center">
                    <p className="text-sm text-muted-foreground/65">No policy uploads yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-foreground/4">
                    {uploadedPolicies.map((doc: {
                      _id: string;
                      fileName?: string;
                      carrier?: string;
                      security?: string;
                      documentType?: string;
                      extractionStatus?: string;
                      extractionError?: string;
                      fileId?: string;
                      emailId?: string;
                      isDemo?: boolean;
                    }) => (
                      <div
                        key={doc._id}
                        className="px-5 py-3.5 group hover:bg-foreground/[0.015] transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {doc.fileName || doc.carrier || "Document"}
                            </p>
                            <p className="text-xs text-muted-foreground/55 truncate mt-0.5">
                              {doc.carrier ? `${doc.security || doc.carrier} · ` : ""}
                              {extractionStatusLabel(doc.extractionStatus)}
                            </p>
                            {doc.extractionStatus === "error" && doc.extractionError ? (
                              <p className="text-xs text-red-500/70 mt-1 line-clamp-2">
                                {doc.extractionError}
                              </p>
                            ) : null}

                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              {doc.extractionStatus === "extracting" && (
                                <button
                                  type="button"
                                  disabled={runningActionKey !== null}
                                  onClick={async () => {
                                    setRunningActionKey(`pause-${doc._id}`);
                                    try {
                                      await pauseExtraction({ id: doc._id as Id<"policies"> });
                                      toast.success("Extraction paused");
                                    } catch {
                                      toast.error("Failed to pause extraction");
                                    } finally {
                                      setRunningActionKey(null);
                                    }
                                  }}
                                  className="px-2 py-0.5 rounded-md border border-foreground/12 text-xs text-muted-foreground hover:bg-foreground/[0.03] disabled:opacity-50"
                                >
                                  Pause
                                </button>
                              )}

                              {doc.extractionStatus === "paused" && (
                                <button
                                  type="button"
                                  disabled={runningActionKey !== null}
                                  onClick={async () => {
                                    setRunningActionKey(`resume-${doc._id}`);
                                    try {
                                      await resumeExtraction({ id: doc._id as Id<"policies"> });
                                      toast.success("Extraction resumed");
                                    } catch {
                                      toast.error("Failed to resume extraction");
                                    } finally {
                                      setRunningActionKey(null);
                                    }
                                  }}
                                  className="px-2 py-0.5 rounded-md border border-foreground/12 text-xs text-muted-foreground hover:bg-foreground/[0.03] disabled:opacity-50"
                                >
                                  Resume
                                </button>
                              )}

                              {(doc.extractionStatus === "paused" ||
                                doc.extractionStatus === "error" ||
                                doc.extractionStatus === "pending") && (
                                <button
                                  type="button"
                                  disabled={runningActionKey !== null}
                                  onClick={async () => {
                                    setRunningActionKey(`dismiss-${doc._id}`);
                                    try {
                                      await cancelExtraction({ id: doc._id as Id<"policies"> });
                                      toast.success("Extraction dismissed");
                                    } catch {
                                      toast.error("Failed to dismiss extraction");
                                    } finally {
                                      setRunningActionKey(null);
                                    }
                                  }}
                                  className="px-2 py-0.5 rounded-md border border-red-200 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  Dismiss
                                </button>
                              )}

                              {(doc.fileId || doc.emailId) && !doc.isDemo &&
                                (doc.extractionStatus === "complete" || doc.extractionStatus === "error") && (
                                  <button
                                    type="button"
                                    disabled={runningActionKey !== null}
                                    onClick={async () => {
                                      setRunningActionKey(`retry-${doc._id}`);
                                      try {
                                        await retryExtraction({
                                          policyId: doc._id as Id<"policies">,
                                          mode: "full",
                                        });
                                        toast.success("Re-extraction started");
                                      } catch {
                                        toast.error("Failed to re-extract");
                                      } finally {
                                        setRunningActionKey(null);
                                      }
                                    }}
                                    className="px-2 py-0.5 rounded-md border border-foreground/12 text-xs text-muted-foreground hover:bg-foreground/[0.03] disabled:opacity-50"
                                  >
                                    Re-extract
                                  </button>
                                )}

                              {doc.extractionStatus === "complete" && (
                                <button
                                  type="button"
                                  onClick={() => router.push(`/policies/${doc._id}`)}
                                  className="px-2 py-0.5 rounded-md border border-foreground/12 text-xs text-foreground hover:bg-foreground/[0.03]"
                                >
                                  View
                                </button>
                              )}
                            </div>
                          </div>

                          {doc.extractionStatus === "extracting" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 shrink-0">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Extracting
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 shrink-0">
                              {doc.documentType === "quote" ? "Quote" : "Policy"}
                            </span>
                          )}

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
                            className="p-1 text-muted-foreground/25 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  className={`border-t border-foreground/4 px-5 py-2 bg-foreground/[0.01] transition-colors ${dragging ? "bg-primary/[0.04]" : ""}`}
                >
                  <p className="text-xs text-muted-foreground/40">{dragging ? "Drop a PDF to upload" : "Drag PDF files here to upload"}</p>
                </div>
              </div>
            </FadeIn>
          )}

        </TabsContent>
      </Tabs>
    </div>
  );
}
