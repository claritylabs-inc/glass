"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { useClientDetailActions } from "../layout";

type DocType = "policy" | "quote";

export default function ClientPoliciesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const [docType, setDocType] = useState<DocType>("policy");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { setActions, setRightPanel } = useClientDetailActions();

  const label = docType === "quote" ? "quote" : "policy";
  const plural = docType === "quote" ? "quotes" : "policies";

  useEffect(() => {
    setActions(
      <PillButton
        type="button"
        size="compact"
        variant="primary"
        onClick={() => setUploaderOpen(true)}
      >
        <Upload className="h-3.5 w-3.5" />
        Upload {label}
      </PillButton>,
    );
    return () => setActions(null);
  }, [setActions, label]);

  const policies = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).policies.listForBroker,
    clientOrgId
      ? {
          clientOrgId: clientOrgId as Id<"organizations">,
          documentType: docType,
        }
      : "skip",
  );

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createBrokerUpload = useMutation((api as any).policies.createBrokerUpload);
  const extractFromUpload = useAction(api.actions.extractFromUpload.extractFromUpload);
  const addFileToPolicy = useAction(api.actions.addFileToPolicy.addFileToPolicy);

  const uploadStorage = useCallback(
    async (file: File): Promise<string> => {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Storage upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      return storageId;
    },
    [generateUploadUrl],
  );

  const handleUpload = useCallback(
    async (files: File[], uploadedType: "policy" | "quote", note: string) => {
      if (!clientOrgId || files.length === 0) return;
      setUploading(true);
      try {
        toast.info(`Uploading 1 of ${files.length}…`);
        const firstStorageId = await uploadStorage(files[0]);
        const policyId = (await createBrokerUpload({
          clientOrgId: clientOrgId as Id<"organizations">,
          fileId: firstStorageId,
          fileName: files[0].name,
          documentType: uploadedType,
          note: note || undefined,
        })) as Id<"policies">;
        await extractFromUpload({
          fileId: firstStorageId as Id<"_storage">,
          fileName: files[0].name,
          policyId,
        });

        for (let i = 1; i < files.length; i++) {
          toast.info(`Uploading ${i + 1} of ${files.length}…`);
          const storageId = await uploadStorage(files[i]);
          const r = (await addFileToPolicy({
            policyId,
            fileId: storageId as Id<"_storage">,
            fileName: files[i].name,
          })) as { error: string } | { success: true };
          if ("error" in r) throw new Error(r.error);
        }

        toast.success("Upload started — the client will see it shortly.");
      } catch (err) {
        toast.error("Upload failed. Please try again.");
        console.error(err);
      } finally {
        setUploading(false);
      }
    },
    [
      clientOrgId,
      uploadStorage,
      createBrokerUpload,
      extractFromUpload,
      addFileToPolicy,
    ],
  );

  useEffect(() => {
    setRightPanel(
      <PolicyUploadDrawer
        open={uploaderOpen}
        onClose={() => setUploaderOpen(false)}
        onUpload={handleUpload}
        uploading={uploading}
      />,
    );
    return () => setRightPanel(null);
  }, [setRightPanel, uploaderOpen, uploading, docType, handleUpload]);

  const isLoading = policies === undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (policies as any[]) ?? [];

  return (
    <div className="space-y-4">
      <Tabs value={docType} onValueChange={(v) => setDocType(v as DocType)}>
        <TabsList variant="pill">
          <TabsTrigger value="policy">Policies</TabsTrigger>
          <TabsTrigger value="quote">Quotes</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyStateCard
          icon={<Upload className="w-5 h-5" />}
          title={`No ${plural} yet`}
          description={`Upload a ${label} PDF to extract coverage details automatically.`}
          actionLabel={`Upload ${label}`}
          onAction={() => setUploaderOpen(true)}
        />
      ) : (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {rows.map((p: any) => (
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
  );
}
