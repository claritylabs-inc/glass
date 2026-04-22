"use client";

import { useCallback, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Upload } from "lucide-react";
import { toast } from "sonner";

export function ClientDocsList({
  clientOrgId,
  documentType,
}: {
  clientOrgId: Id<"organizations">;
  documentType: "policy" | "quote";
}) {
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const policies = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).policies.listForBroker,
    { clientOrgId, documentType },
  );

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createBrokerUpload = useMutation((api as any).policies.createBrokerUpload);
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload,
  );
  const extractApplicationPdfPublic = useAction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).actions.extractApplicationPdf.extractApplicationPdfPublic,
  );

  const label = documentType === "quote" ? "quote" : "policy";
  const plural = documentType === "quote" ? "quotes" : "policies";

  const handleUpload = useCallback(
    async (
      file: File,
      uploadedType: "policy" | "quote" | "application",
      note: string,
    ) => {
      setUploading(true);
      try {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        });
        if (!res.ok) throw new Error("Storage upload failed");
        const { storageId } = await res.json();

        if (uploadedType === "application") {
          await extractApplicationPdfPublic({ clientOrgId, fileId: storageId });
          toast.success(
            "Application extracted — review the draft in Applications.",
          );
        } else {
          const policyId = await createBrokerUpload({
            clientOrgId,
            fileId: storageId,
            fileName: file.name,
            documentType: uploadedType,
            note: note || undefined,
          });
          await extractFromUpload({
            fileId: storageId,
            fileName: file.name,
            policyId,
          });
          toast.success("Upload started — the client will see it shortly.");
        }
      } catch (err) {
        toast.error("Upload failed. Please try again.");
        console.error(err);
      } finally {
        setUploading(false);
      }
    },
    [
      clientOrgId,
      generateUploadUrl,
      createBrokerUpload,
      extractFromUpload,
      extractApplicationPdfPublic,
    ],
  );

  const isLoading = policies === undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (policies as any[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PillButton
          type="button"
          size="compact"
          variant="primary"
          onClick={() => setUploaderOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload {label}
        </PillButton>
      </div>

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
              extractionStatus={p.extractionStatus}
              uploadedBySide={p.uploadedBySide}
            />
          ))}
        </div>
      )}

      <PolicyUploadDrawer
        open={uploaderOpen}
        onClose={() => setUploaderOpen(false)}
        onUpload={handleUpload}
        uploading={uploading}
        showApplicationOption={documentType === "policy"}
      />
    </div>
  );
}
