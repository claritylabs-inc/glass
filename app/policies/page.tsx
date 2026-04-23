"use client";

import { useState, useCallback, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { toast } from "sonner";
import { Upload, Copy, Mail, FileText, X } from "lucide-react";

const AGENT_DOMAIN =
  process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

const DOC_TYPE_TABS = [
  { id: "policy", label: "Policies" },
  { id: "quote", label: "Quotes" },
] as const;

type DocTypeTab = (typeof DOC_TYPE_TABS)[number]["id"];

function PoliciesLoadingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 mb-4">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0"
          >
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-24 hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentEmailCard({ email }: { email: string }) {
  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(email)
      .then(() => toast.success("Copied to clipboard"))
      .catch(() => toast.error("Couldn't copy to clipboard"));
  }, [email]);

  return (
    <div className="rounded-lg border border-foreground/6 bg-card p-4">
      <div className="flex items-start gap-3">
        <Mail className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-body-sm font-medium">
              Email or forward to your agent
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-foreground/8 bg-popover px-2 py-0.5 text-label-sm font-medium text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
            >
              <span className="truncate max-w-[280px]">{email}</span>
              <Copy className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
          </div>
          <p className="text-label-sm text-muted-foreground mt-1.5">
            Forward any policy email with attachments and Glass will extract it
            automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyStateDropZone({
  onFiles,
  uploading,
  docType,
}: {
  onFiles: (files: File[]) => void;
  uploading: boolean;
  docType: DocTypeTab;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [staged, setStaged] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const pdfs: File[] = [];
    let rejected = 0;
    for (const f of incoming) {
      if (f.name.toLowerCase().endsWith(".pdf")) pdfs.push(f);
      else rejected++;
    }
    if (rejected > 0) {
      toast.error(
        rejected === 1
          ? "Skipped a non-PDF file."
          : `Skipped ${rejected} non-PDF files.`,
      );
    }
    if (pdfs.length === 0) return;
    setStaged((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [
        ...prev,
        ...pdfs.filter((f) => !existing.has(`${f.name}:${f.size}`)),
      ];
    });
  }, []);

  const removeAt = useCallback((i: number) => {
    setStaged((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const handleUpload = useCallback(() => {
    if (staged.length === 0) return;
    onFiles(staged);
    setStaged([]);
  }, [staged, onFiles]);

  return (
    <div className="space-y-3">
      <div
        className={`rounded-lg border-2 border-dashed transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-foreground/12"
        } px-6 py-10 text-center`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files);
          if (dropped.length > 0) addFiles(dropped);
        }}
      >
        <div className="mx-auto w-8 h-8 flex items-center justify-center rounded-md bg-foreground/[0.04] text-muted-foreground mb-3">
          <Upload className="h-4 w-4" />
        </div>
        <p className="text-body-sm text-foreground font-medium">
          Drag and drop {docType === "quote" ? "quote" : "policy"} PDFs
        </p>
        <p className="text-label-sm text-muted-foreground mt-1">
          or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-foreground hover:underline cursor-pointer"
          >
            click to choose files
          </button>
        </p>
        <p className="text-label-sm text-muted-foreground/60 mt-2">
          Multiple PDFs will be combined into a single {docType}.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) addFiles(picked);
            e.target.value = "";
          }}
        />
      </div>

      {staged.length > 0 ? (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          {staged.map((file, i) => (
            <div
              key={`${file.name}:${file.size}:${i}`}
              className="flex items-center gap-2 px-3 py-2 border-t border-foreground/4 first:border-t-0"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-body-sm truncate flex-1">{file.name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={uploading}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Remove ${file.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {staged.length > 0 ? (
        <PillButton
          variant="primary"
          className="w-full"
          disabled={uploading}
          onClick={handleUpload}
        >
          {uploading
            ? "Uploading…"
            : staged.length > 1
              ? `Upload ${staged.length} files`
              : "Upload"}
        </PillButton>
      ) : null}
    </div>
  );
}

export default function PoliciesPage() {
  const [docTypeTab, setDocTypeTab] = useState<DocTypeTab>("policy");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const policies = useQuery(api.policies.listForClient, {
    documentType: docTypeTab,
  });
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload,
  );
  const addFileToPolicy = useAction(
    api.actions.addFileToPolicy.addFileToPolicy,
  );

  const uploadOne = useCallback(
    async (file: File): Promise<string> => {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      return storageId;
    },
    [generateUploadUrl],
  );

  const uploadMany = useCallback(
    async (
      files: File[],
      documentType: "policy" | "quote",
    ): Promise<void> => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        // First file creates the policy.
        toast.info(`Uploading 1 of ${files.length}…`);
        const firstStorageId = await uploadOne(files[0]);
        const firstResult = (await extractFromUpload({
          fileId: firstStorageId as Id<"_storage">,
          fileName: files[0].name,
        })) as
          | { error: string }
          | { success: true; type: string; id: string };

        if ("error" in firstResult) {
          throw new Error(firstResult.error);
        }
        const policyId = firstResult.id as Id<"policies">;

        for (let i = 1; i < files.length; i++) {
          toast.info(`Uploading ${i + 1} of ${files.length}…`);
          const storageId = await uploadOne(files[i]);
          const r = (await addFileToPolicy({
            policyId,
            fileId: storageId as Id<"_storage">,
            fileName: files[i].name,
          })) as { error: string } | { success: true };
          if ("error" in r) throw new Error(r.error);
        }

        toast.success(
          `${documentType === "quote" ? "Quote" : "Policy"} uploaded — extraction running in the background.`,
        );
      } catch (err) {
        console.error(err);
        toast.error("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [uploadOne, extractFromUpload, addFileToPolicy],
  );

  const handleDrawerUpload = useCallback(
    async (files: File[], documentType: "policy" | "quote") => {
      await uploadMany(files, documentType);
      setUploaderOpen(false);
    },
    [uploadMany],
  );

  const handleEmptyStateFiles = useCallback(
    (files: File[]) => {
      void uploadMany(files, docTypeTab);
    },
    [uploadMany, docTypeTab],
  );

  const isLoading = policies === undefined;
  const list = (policies ?? []) as Array<{
    _id: string;
    carrier?: string | null;
    policyNumber?: string | null;
    effectiveDate?: string | null;
    expirationDate?: string | null;
    pipelineStatus?: string;
    uploadedBySide?: string;
  }>;

  const agentHandle =
    viewerOrg?.brokerOrg?.agentHandle ?? viewerOrg?.org?.agentHandle ?? null;
  const agentEmail = agentHandle ? `${agentHandle}@${AGENT_DOMAIN}` : null;

  return (
    <AppShell
      actions={
        <PillButton
          size="compact"
          variant="secondary"
          onClick={() => setUploaderOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </PillButton>
      }
      rightPanel={
        <PolicyUploadDrawer
          open={uploaderOpen}
          onClose={() => setUploaderOpen(false)}
          onUpload={handleDrawerUpload}
          uploading={uploading}
        />
      }
    >
      <div className="space-y-4">
        <Tabs
          value={docTypeTab}
          onValueChange={(v) => setDocTypeTab(v as DocTypeTab)}
        >
          <TabsList variant="pill">
            {DOC_TYPE_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <PoliciesLoadingSkeleton />
        ) : list.length === 0 ? (
          <div className="space-y-4">
            {agentEmail ? <AgentEmailCard email={agentEmail} /> : null}
            <EmptyStateDropZone
              onFiles={handleEmptyStateFiles}
              uploading={uploading}
              docType={docTypeTab}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(list as any[]).map((p: any) => (
              <PolicyListItem
                key={p._id}
                carrier={p.carrier}
                policyNumber={p.policyNumber}
                effectiveDate={p.effectiveDate}
                expirationDate={p.expirationDate}
                pipelineStatus={p.pipelineStatus}
                uploadedBySide={p.uploadedBySide}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
