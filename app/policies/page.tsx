"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { AgentContactCallout } from "@/components/agent-contact-callout";
import { toast } from "sonner";
import { Upload } from "lucide-react";

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

export default function PoliciesPage() {
  const router = useRouter();
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
        const storageIds: Id<"_storage">[] = [];
        for (let i = 0; i < files.length; i++) {
          toast.info(`Uploading ${i + 1} of ${files.length}…`);
          const id = await uploadOne(files[i]);
          storageIds.push(id as Id<"_storage">);
        }

        if (files.length > 1) {
          toast.info(`Merging ${files.length} files…`);
        }

        const result = (await extractFromUpload({
          fileId: storageIds[0],
          fileName: files[0].name,
          additionalFiles: storageIds.slice(1).map((fileId, i) => ({
            fileId,
            fileName: files[i + 1].name,
          })),
        })) as
          | { error: string }
          | { success: true; type: string; id: string };

        if ("error" in result) {
          throw new Error(result.error);
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
    [uploadOne, extractFromUpload],
  );

  const handleDrawerUpload = useCallback(
    async (files: File[]) => {
      await uploadMany(files, docTypeTab);
      setUploaderOpen(false);
    },
    [uploadMany, docTypeTab],
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
  const brokerForCallout = viewerOrg?.brokerOrg ?? null;
  const fallbackHandle = viewerOrg?.org?.agentHandle ?? null;

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
          docType={docTypeTab}
        />
      }
    >
      <div className="space-y-4">
        <AgentContactCallout
          broker={brokerForCallout}
          fallbackAgentHandle={fallbackHandle}
        />
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
          <PolicyEmptyState
            docType={docTypeTab}
            agentEmail={agentEmail}
            uploading={uploading}
            onUpload={handleEmptyStateFiles}
          />
        ) : (
          <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(list as any[]).map((p: any) => (
              <PolicyListItem
                key={p._id}
                carrier={p.carrier}
                administrator={p.mga}
                policyNumber={p.policyNumber}
                effectiveDate={p.effectiveDate}
                expirationDate={p.expirationDate}
                pipelineStatus={p.pipelineStatus}
                uploadedBySide={p.uploadedBySide}
                onClick={() => router.push(`/policies/${p._id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
