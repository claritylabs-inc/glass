"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import type { PolicyUploadMode } from "@/components/policy-upload-mode-toggle";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { AgentContactCallout } from "@/components/agent-contact-callout";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  useCachedPolicyList,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import {
  showPolicyExtractionQueuedToast,
  showPolicyExtractionReadyToast,
} from "@/components/shared/extraction-banner";

const AGENT_DOMAIN = getPublicAgentDomain();

const DOC_TYPE_TABS = [
  { id: "policy", label: "Policies" },
  { id: "quote", label: "Quotes" },
] as const;

type DocTypeTab = (typeof DOC_TYPE_TABS)[number]["id"];

type PolicyListToastRow = {
  _id: string;
  carrier?: string | null;
  fileName?: string | null;
  policyNumber?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  documentType?: string | null;
  pipelineStatus?: string;
  pipelineError?: string | null;
  extractionDataStage?: string | null;
  extractionPreviewError?: string | null;
  uploadedBySide?: string;
};

export default function PoliciesPage() {
  const router = useRouter();
  const [docTypeTab, setDocTypeTab] = useState<DocTypeTab>("policy");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pendingExtractionToastsRef = useRef<
    Record<string, { documentType: DocTypeTab; fileName?: string | null }>
  >({});

  const policies = useCachedPolicyList(docTypeTab);
  const viewerOrg = useCachedViewerOrg();

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

  const resolvePendingExtractionToasts = useCallback(
    (
      rows: PolicyListToastRow[] | undefined,
    ) => {
      if (!rows) return;
      const pending = pendingExtractionToastsRef.current;
      if (Object.keys(pending).length === 0) return;
      const rowsById = new Map(rows.map((policy) => [policy._id, policy]));
      const readyIds = Object.keys(pending).filter((policyId) =>
        rowsById.has(policyId),
      );
      if (readyIds.length === 0) return;

      for (const policyId of readyIds) {
        const policy = rowsById.get(policyId);
        if (!policy) continue;
        const pendingPolicy = pending[policyId];
        showPolicyExtractionReadyToast(
          {
            ...policy,
            documentType: policy.documentType ?? pendingPolicy.documentType,
            fileName: policy.fileName ?? pendingPolicy.fileName,
          },
          () => router.push(`/policies/${policyId}`),
        );
        delete pending[policyId];
      }
    },
    [router],
  );

  const uploadMany = useCallback(
    async (
      files: File[],
      documentType: "policy" | "quote",
      uploadMode: PolicyUploadMode = "combined",
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

        if (files.length > 1 && uploadMode === "combined") {
          toast.info(`Merging ${files.length} files…`);
        }

        if (uploadMode === "separate") {
          for (let i = 0; i < storageIds.length; i++) {
            const result = (await extractFromUpload({
              fileId: storageIds[i],
              fileName: files[i].name,
            })) as
              | { error: string }
              | { success: true; type: string; id: string };

            if ("error" in result) {
              throw new Error(result.error);
            }
            showPolicyExtractionQueuedToast({
              policyId: result.id,
              documentType,
              fileName: files[i].name,
            });
            pendingExtractionToastsRef.current[result.id] = {
              documentType,
              fileName: files[i].name,
            };
            resolvePendingExtractionToasts(policies as PolicyListToastRow[] | undefined);
          }
        } else {
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
          const displayFileName =
            files.length > 1
              ? `${files[0].name.replace(/\.pdf$/i, "")} + ${files.length - 1} more.pdf`
              : files[0].name;
          showPolicyExtractionQueuedToast({
            policyId: result.id,
            documentType,
            fileName: displayFileName,
          });
          pendingExtractionToastsRef.current[result.id] = {
            documentType,
            fileName: displayFileName,
          };
          resolvePendingExtractionToasts(policies as PolicyListToastRow[] | undefined);
        }

      } catch (err) {
        console.error(err);
        toast.error("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [uploadOne, extractFromUpload, policies, resolvePendingExtractionToasts],
  );

  const handleDrawerUpload = useCallback(
    async (files: File[], uploadMode: PolicyUploadMode) => {
      await uploadMany(files, docTypeTab, uploadMode);
      setUploaderOpen(false);
    },
    [uploadMany, docTypeTab],
  );

  const handleEmptyStateFiles = useCallback(
    (files: File[], uploadMode: PolicyUploadMode) => {
      void uploadMany(files, docTypeTab, uploadMode);
    },
    [uploadMany, docTypeTab],
  );

  const isLoading = policies === undefined;
  const isViewerOrgLoading = viewerOrg === undefined;
  const list = (policies ?? []) as PolicyListToastRow[];

  const agentHandle =
    viewerOrg?.brokerOrg?.agentHandle ?? viewerOrg?.org?.agentHandle ?? null;
  const agentEmail = agentHandle ? `${agentHandle}@${AGENT_DOMAIN}` : null;
  const brokerForCallout = viewerOrg?.brokerOrg ?? null;
  const fallbackHandle = viewerOrg?.org?.agentHandle ?? null;

  useEffect(() => {
    resolvePendingExtractionToasts(policies as PolicyListToastRow[] | undefined);
  }, [policies, resolvePendingExtractionToasts]);

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
        {isViewerOrgLoading ? (
          <div className="mb-6 sm:min-h-56" aria-hidden="true" />
        ) : (
          <AgentContactCallout
            broker={brokerForCallout}
            fallbackAgentHandle={fallbackHandle}
            dismissKey="glass:agent-contact-callout:policies"
          />
        )}
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
          <div className="min-h-32" aria-hidden="true" />
        ) : list.length === 0 ? (
          <PolicyEmptyState
            docType={docTypeTab}
            agentEmail={agentEmail}
            uploading={uploading}
            onUpload={handleEmptyStateFiles}
          />
        ) : (
          <OperationalPanel as="div">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(list as any[]).map((p: any) => (
              <PolicyListItem
                key={p._id}
                carrier={p.carrier}
                administrator={p.mga}
                policyNumber={p.policyNumber}
                fileName={p.fileName}
                effectiveDate={p.effectiveDate}
                expirationDate={p.expirationDate}
                pipelineStatus={p.pipelineStatus}
                extractionDataStage={p.extractionDataStage}
                uploadedBySide={p.uploadedBySide}
                href={`/policies/${p._id}`}
              />
            ))}
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
