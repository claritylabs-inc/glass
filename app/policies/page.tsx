"use client";

import { useState, useCallback } from "react";
import { useAction, useMutation } from "convex/react";
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
import { useUpsertCachedQuery } from "@/lib/sync/use-cached-query";

const AGENT_DOMAIN = getPublicAgentDomain();

const DOC_TYPE_TABS = [
  { id: "policy", label: "Policies" },
  { id: "quote", label: "Quotes" },
] as const;

type DocTypeTab = (typeof DOC_TYPE_TABS)[number]["id"];

export default function PoliciesPage() {
  const [docTypeTab, setDocTypeTab] = useState<DocTypeTab>("policy");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const policies = useCachedPolicyList(docTypeTab);
  const viewerOrg = useCachedViewerOrg();
  const upsertPolicyList = useUpsertCachedQuery<
    Array<{
      _id: Id<"policies">;
      fileName?: string | null;
      carrier?: string | null;
      policyNumber?: string | null;
      documentType?: string;
      pipelineStatus?: string;
      uploadedBySide?: string;
      [key: string]: unknown;
    }>,
    { documentType: "policy" | "quote" }
  >("policies.listForClient");

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
            await upsertPolicyList({ documentType }, (current) => [
              {
                _id: result.id as Id<"policies">,
                fileName: files[i].name,
                carrier: "Extracting...",
                policyNumber: "Extracting...",
                documentType,
                pipelineStatus: "processing",
                uploadedBySide: "client",
              },
              ...(current ?? []).filter((policy) => policy._id !== result.id),
            ]);
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
          await upsertPolicyList({ documentType }, (current) => [
            {
              _id: result.id as Id<"policies">,
              fileName:
                files.length > 1
                  ? `${files[0].name.replace(/\.pdf$/i, "")} + ${files.length - 1} more.pdf`
                  : files[0].name,
              carrier: "Extracting...",
              policyNumber: "Extracting...",
              documentType,
              pipelineStatus: "processing",
              uploadedBySide: "client",
            },
            ...(current ?? []).filter((policy) => policy._id !== result.id),
          ]);
        }

        toast.success(
          uploadMode === "separate" && files.length > 1
            ? `${files.length} ${documentType === "quote" ? "quotes" : "policies"} uploaded — extraction running in the background.`
            : `${documentType === "quote" ? "Quote" : "Policy"} uploaded — extraction running in the background.`,
        );
      } catch (err) {
        console.error(err);
        toast.error("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [uploadOne, extractFromUpload, upsertPolicyList],
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
  const list = (policies ?? []) as Array<{
    _id: string;
    carrier?: string | null;
    fileName?: string | null;
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
