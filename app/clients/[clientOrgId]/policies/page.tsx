"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Upload } from "lucide-react";

type DocTypeTab = "policy" | "quote";

export default function ClientPoliciesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const [docTypeTab, setDocTypeTab] = useState<DocTypeTab>("policy");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const policies = useQuery((api as any).policies.listForBroker, {
    clientOrgId: clientOrgId as Id<"organizations">,
    documentType: docTypeTab,
  });

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const createBrokerUpload = useMutation((api as any).policies.createBrokerUpload);
  const extractFromUpload = useAction(api.actions.extractFromUpload.extractFromUpload);
  const extractApplicationPdfPublic = useAction(
    (api as any).actions.extractApplicationPdf.extractApplicationPdfPublic,
  );

  const handleUpload = useCallback(
    async (file: File, documentType: "policy" | "quote" | "application", note: string) => {
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

        if (documentType === "application") {
          // Route to extractApplicationPdf — creates an applications v2 draft
          await extractApplicationPdfPublic({
            clientOrgId: clientOrgId as Id<"organizations">,
            fileId: storageId,
          });
          toast.success("Application extracted — review the draft in Applications.");
        } else {
          // Policy or quote — create a broker upload row then extract
          const policyId = await createBrokerUpload({
            clientOrgId: clientOrgId as Id<"organizations">,
            fileId: storageId,
            fileName: file.name,
            documentType,
            note: note || undefined,
          });
          await extractFromUpload({ fileId: storageId, fileName: file.name, policyId });
          toast.success("Upload started — the client will see it shortly.");
        }
      } catch (err) {
        toast.error("Upload failed. Please try again.");
        console.error(err);
      } finally {
        setUploading(false);
      }
    },
    [clientOrgId, generateUploadUrl, createBrokerUpload, extractFromUpload, extractApplicationPdfPublic],
  );

  const isLoading = policies === undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs
          value={docTypeTab}
          onValueChange={(v) => setDocTypeTab(v as DocTypeTab)}
        >
          <TabsList variant="pill">
            <TabsTrigger value="policy">Policies</TabsTrigger>
            <TabsTrigger value="quote">Quotes</TabsTrigger>
          </TabsList>
        </Tabs>
        <PillButton
          type="button"
          size="compact"
          variant="secondary"
          onClick={() => setUploaderOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload {docTypeTab === "quote" ? "quote" : "policy"}
        </PillButton>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : (policies as any[]).length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground/60">
            No {docTypeTab === "quote" ? "quotes" : "policies"} yet.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
          {(policies as any[]).map((p: any) => (
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
        showApplicationOption={true}
      />
    </div>
  );
}
