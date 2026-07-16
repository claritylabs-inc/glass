"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import type { PolicyUploadMode } from "@/components/policy-upload-mode-toggle";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { AgentContactCallout } from "@/components/agent-contact-callout";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { toast } from "sonner";
import { ArchiveRestore, Upload } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  useCachedPolicyList,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import {
  showPolicyExtractionQueuedToast,
  showPolicyExtractionReadyToast,
} from "@/components/shared/extraction-banner";
import { preparePolicyUploadCandidates } from "@/lib/policy-upload-duplicates";

const AGENT_DOMAIN = getPublicAgentDomain();

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
  const searchParams = useSearchParams();
  const showArchived = searchParams.get("view") === "archived";
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pendingExtractionToastsRef = useRef<
    Record<string, { fileName?: string | null }>
  >({});

  const policies = useCachedPolicyList(showArchived);
  const viewerOrg = useCachedViewerOrg();

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const checkDuplicateUploadByHash = useMutation(
    api.policies.checkDuplicateUploadByHash,
  );
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload,
  );
  const restorePolicy = useMutation(api.policies.restore);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function handleRestore(policyId: string) {
    setRestoringId(policyId);
    try {
      await restorePolicy({ id: policyId as Id<"policies"> });
      toast.success("Policy restored");
    } catch {
      toast.error("Failed to restore policy");
    } finally {
      setRestoringId(null);
    }
  }

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
            documentType: policy.documentType ?? "policy",
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
      uploadMode: PolicyUploadMode = "combined",
    ): Promise<void> => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        const orgId = viewerOrg?.org?._id as Id<"organizations"> | undefined;
        if (!orgId) throw new Error("No organization");
        const candidates = await preparePolicyUploadCandidates(
          files,
          (fileSha256) => checkDuplicateUploadByHash({ orgId, fileSha256 }),
        );
        if (!candidates) return;

        const storageIds: Id<"_storage">[] = [];
        for (let i = 0; i < candidates.length; i++) {
          toast.info(`Uploading ${i + 1} of ${candidates.length}…`);
          const id = await uploadOne(candidates[i].file);
          storageIds.push(id as Id<"_storage">);
        }

        if (candidates.length > 1 && uploadMode === "combined") {
          toast.info(`Merging ${candidates.length} files…`);
        }

        if (uploadMode === "separate") {
          for (let i = 0; i < storageIds.length; i++) {
            const result = (await extractFromUpload({
              fileId: storageIds[i],
              fileName: candidates[i].file.name,
              fileSha256: candidates[i].fileSha256,
            })) as
              | { error: string }
              | { success: true; type: string; id: string };

            if ("error" in result) {
              throw new Error(result.error);
            }
            showPolicyExtractionQueuedToast({
              policyId: result.id,
              documentType: "policy",
              fileName: candidates[i].file.name,
            });
            pendingExtractionToastsRef.current[result.id] = {
              fileName: candidates[i].file.name,
            };
            resolvePendingExtractionToasts(policies as PolicyListToastRow[] | undefined);
          }
        } else {
          const result = (await extractFromUpload({
            fileId: storageIds[0],
            fileName: candidates[0].file.name,
            fileSha256: candidates[0].fileSha256,
            additionalFiles: storageIds.slice(1).map((fileId, i) => ({
              fileId,
              fileName: candidates[i + 1].file.name,
              fileSha256: candidates[i + 1].fileSha256,
            })),
          })) as
            | { error: string }
            | { success: true; type: string; id: string };

          if ("error" in result) {
            throw new Error(result.error);
          }
          const displayFileName =
            candidates.length > 1
              ? `${candidates[0].file.name.replace(/\.pdf$/i, "")} + ${candidates.length - 1} more.pdf`
              : candidates[0].file.name;
          showPolicyExtractionQueuedToast({
            policyId: result.id,
            documentType: "policy",
            fileName: displayFileName,
          });
          pendingExtractionToastsRef.current[result.id] = {
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
    [
      viewerOrg,
      checkDuplicateUploadByHash,
      uploadOne,
      extractFromUpload,
      policies,
      resolvePendingExtractionToasts,
    ],
  );

  const handleDrawerUpload = useCallback(
    async (files: File[], uploadMode: PolicyUploadMode) => {
      await uploadMany(files, uploadMode);
      setUploaderOpen(false);
    },
    [uploadMany],
  );

  const handleEmptyStateFiles = useCallback(
    (files: File[], uploadMode: PolicyUploadMode) => {
      void uploadMany(files, uploadMode);
    },
    [uploadMany],
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
        !showArchived ? (
          <PillButton
            size="compact"
            variant="secondary"
            onClick={() => setUploaderOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </PillButton>
        ) : null
      }
      rightPanel={
        !showArchived ? (
          <PolicyUploadDrawer
            open={uploaderOpen}
            onClose={() => setUploaderOpen(false)}
            onUpload={handleDrawerUpload}
            uploading={uploading}
          />
        ) : null
      }
    >
      <div className="space-y-4">
        <Tabs
          value={showArchived ? "archived" : "active"}
          onValueChange={(value) =>
            router.push(
              value === "archived" ? "/policies?view=archived" : "/policies",
            )
          }
        >
          <TabsList variant="pill">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        {!showArchived && isViewerOrgLoading ? (
          <div className="mb-6 sm:min-h-56" aria-hidden="true" />
        ) : !showArchived ? (
          <AgentContactCallout
            broker={brokerForCallout}
            fallbackAgentHandle={fallbackHandle}
            dismissKey="glass:agent-contact-callout:policies"
          />
        ) : null}
        {isLoading ? (
          <div className="min-h-32" aria-hidden="true" />
        ) : list.length === 0 && showArchived ? (
          <div className="py-16 text-center text-base text-muted-foreground/50">
            No archived policies
          </div>
        ) : list.length === 0 ? (
          <PolicyEmptyState
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
                generalAgent={p.generalAgent?.agencyName ?? p.mga}
                policyNumber={p.policyNumber}
                fileName={p.fileName}
                effectiveDate={p.effectiveDate}
                expirationDate={p.expirationDate}
                pipelineStatus={p.pipelineStatus}
                extractionDataStage={p.extractionDataStage}
                uploadedBySide={p.uploadedBySide}
                href={`/policies/${p._id}`}
                trailingAction={showArchived ? (
                  <PillButton
                    size="compact"
                    variant="secondary"
                    disabled={restoringId === p._id}
                    onClick={() => void handleRestore(p._id)}
                  >
                    <ArchiveRestore className="size-3.5" />
                    {restoringId === p._id ? "Restoring..." : "Restore"}
                  </PillButton>
                ) : undefined}
              />
            ))}
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
