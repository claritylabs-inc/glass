"use client";

import { useState, useCallback } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { EmptyStateCard } from "@/components/ui/empty-state-card";

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

export default function PoliciesPage() {
  const [docTypeTab, setDocTypeTab] = useState<DocTypeTab>("policy");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const policies = useQuery((api as any).policies.listForClient, {
    documentType: docTypeTab,
  });

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload,
  );

  const handleUpload = useCallback(
    async (file: File, documentType: "policy" | "quote" | "application") => {
      if (documentType === "application") {
        toast.info("Application uploads are handled by your broker.");
        return;
      }
      setUploading(true);
      try {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        });
        if (!res.ok) throw new Error("Upload failed");
        const { storageId } = await res.json();
        await extractFromUpload({ fileId: storageId, fileName: file.name });
        toast.success("Upload started — processing in background.");
        setUploaderOpen(false);
      } catch (err) {
        toast.error("Upload failed. Please try again.");
        console.error(err);
      } finally {
        setUploading(false);
      }
    },
    [generateUploadUrl, extractFromUpload],
  );

  const isLoading = policies === undefined;

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
          onUpload={handleUpload}
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
        ) : (policies as any[]).length === 0 ? (
          <EmptyStateCard
            icon={<Upload className="w-5 h-5" />}
            title={`No ${docTypeTab === "quote" ? "quotes" : "policies"} yet`}
            description={`Upload a ${docTypeTab === "quote" ? "quote" : "policy"} PDF and we'll extract the coverage details automatically.`}
            actionLabel="Upload"
            onAction={() => setUploaderOpen(true)}
          />
        ) : (
          <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
            {(policies as any[]).map((p: any) => (
              <PolicyListItem
                key={p._id}
                carrier={p.carrier}
                policyNumber={p.policyNumber}
                effectiveDate={p.effectiveDate}
                expirationDate={p.expirationDate}
                pipelineStatus={(p as any).pipelineStatus}
                uploadedBySide={p.uploadedBySide}
              />
            ))}
          </div>
        )}

      </div>
    </AppShell>
  );
}
