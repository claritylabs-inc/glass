"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useAction } from "convex/react";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import type { PolicyUploadMode } from "@/components/policy-upload-mode-toggle";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { Badge } from "@/components/ui/badge";
import { OperationalPanel } from "@/components/ui/operational-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { useClientDetailActions } from "../layout";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  useCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

type DocType = "policy" | "quote";

type BrokerPolicyRow = {
  _id: Id<"policies">;
  carrier?: string | null;
  mga?: string | null;
  policyNumber?: string | null;
  fileName?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  pipelineStatus?: string | null;
  uploadedBySide?: "broker" | "client" | "email_scan" | "agent_email" | null;
  premium?: string | null;
};

function cleanField(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^extracting/i.test(trimmed)) return undefined;
  return trimmed;
}

function formatDate(value?: string | null) {
  const cleaned = cleanField(value);
  if (!cleaned) return "No date";
  const parsed = dayjs(cleaned, ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD"], true);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : cleaned;
}

function displayStatus(status?: string | null) {
  if (!status) return "Processing";
  return status.replace(/_/g, " ");
}

function displayUploadedBy(side?: BrokerPolicyRow["uploadedBySide"]) {
  if (side === "broker") return "Broker";
  if (side === "client") return "Client";
  if (side === "email_scan") return "Email scan";
  if (side === "agent_email") return "Agent email";
  return "Unknown";
}

export default function ClientPoliciesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const router = useRouter();
  const [docType, setDocType] = useState<DocType>("policy");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { setActions, setRightPanel } = useClientDetailActions();

  const label = docType === "quote" ? "quote" : "policy";

  // Broker's own agent email (shown in empty state for easy forwarding)
  const viewerOrg = useCachedQuery("orgs.viewerOrg", api.orgs.viewerOrg, {});
  const AGENT_DOMAIN = getPublicAgentDomain();
  const agentHandle = viewerOrg?.org?.agentHandle;
  const agentEmail = agentHandle ? `${agentHandle}@${AGENT_DOMAIN}` : null;

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

  const policies = useCachedQuery(
    "policies.listForBroker",
    api.policies.listForBroker,
    clientOrgId
      ? {
          clientOrgId: clientOrgId as Id<"organizations">,
          documentType: docType,
        }
      : "skip",
  );

  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const createBrokerUpload = useMutation(api.policies.createBrokerUpload);
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload,
  );
  const upsertBrokerPolicies = useUpsertCachedQuery<
    BrokerPolicyRow[],
    { clientOrgId: Id<"organizations">; documentType: DocType }
  >("policies.listForBroker");

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
    async (files: File[], uploadMode: PolicyUploadMode = "combined") => {
      if (!clientOrgId || files.length === 0) return;
      setUploading(true);
      try {
        const storageIds: string[] = [];
        for (let i = 0; i < files.length; i++) {
          toast.info(`Uploading ${i + 1} of ${files.length}…`);
          storageIds.push(await uploadStorage(files[i]));
        }

        if (uploadMode === "separate") {
          for (let i = 0; i < storageIds.length; i++) {
            const policyId = (await createBrokerUpload({
              clientOrgId: clientOrgId as Id<"organizations">,
              fileId: storageIds[i] as Id<"_storage">,
              fileName: files[i].name,
              documentType: docType,
            })) as Id<"policies">;
            await upsertBrokerPolicies(
              { clientOrgId: clientOrgId as Id<"organizations">, documentType: docType },
              (current) => [
                {
                  _id: policyId,
                  fileName: files[i].name,
                  carrier: "Extracting...",
                  policyNumber: "Extracting...",
                  pipelineStatus: "processing",
                  uploadedBySide: "broker",
                },
                ...(current ?? []).filter((policy) => policy._id !== policyId),
              ],
            );

            const result = await extractFromUpload({
              fileId: storageIds[i] as Id<"_storage">,
              fileName: files[i].name,
              policyId,
            });
            if (
              result &&
              typeof result === "object" &&
              "error" in result &&
              typeof result.error === "string"
            ) {
              throw new Error(result.error);
            }
          }
        } else {
          const policyId = (await createBrokerUpload({
            clientOrgId: clientOrgId as Id<"organizations">,
            fileId: storageIds[0] as Id<"_storage">,
            fileName: files[0].name,
            documentType: docType,
          })) as Id<"policies">;
          await upsertBrokerPolicies(
            { clientOrgId: clientOrgId as Id<"organizations">, documentType: docType },
            (current) => [
              {
                _id: policyId,
                fileName:
                  files.length > 1
                    ? `${files[0].name.replace(/\.pdf$/i, "")} + ${files.length - 1} more.pdf`
                    : files[0].name,
                carrier: "Extracting...",
                policyNumber: "Extracting...",
                pipelineStatus: "processing",
                uploadedBySide: "broker",
              },
              ...(current ?? []).filter((policy) => policy._id !== policyId),
            ],
          );

          if (files.length > 1) toast.info(`Merging ${files.length} files…`);
          const result = await extractFromUpload({
            fileId: storageIds[0] as Id<"_storage">,
            fileName: files[0].name,
            policyId,
            additionalFiles: storageIds.slice(1).map((fileId, i) => ({
              fileId: fileId as Id<"_storage">,
              fileName: files[i + 1].name,
            })),
          });
          if (
            result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
          ) {
            throw new Error(result.error);
          }
        }

        toast.success(
          uploadMode === "separate" && files.length > 1
            ? `${files.length} ${docType === "quote" ? "quotes" : "policies"} started — the client will see them shortly.`
            : "Upload started — the client will see it shortly.",
        );
      } catch (err) {
        toast.error("Upload failed. Please try again.");
        console.error(err);
      } finally {
        setUploading(false);
      }
    },
    [
      clientOrgId,
      docType,
      uploadStorage,
      createBrokerUpload,
      extractFromUpload,
      upsertBrokerPolicies,
    ],
  );

  useEffect(() => {
    setRightPanel(
      <PolicyUploadDrawer
        open={uploaderOpen}
        onClose={() => setUploaderOpen(false)}
        onUpload={handleUpload}
        uploading={uploading}
        docType={docType}
      />,
    );
    return () => setRightPanel(null);
  }, [setRightPanel, uploaderOpen, uploading, docType, handleUpload]);

  const isLoading = policies === undefined;
  const rows = (policies ?? []) as BrokerPolicyRow[];

  return (
    <div className="space-y-4">
      <Tabs value={docType} onValueChange={(v) => setDocType(v as DocType)}>
        <TabsList variant="pill">
          <TabsTrigger value="policy">Policies</TabsTrigger>
          <TabsTrigger value="quote">Quotes</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="min-h-32" aria-hidden="true" />
      ) : rows.length === 0 ? (
        <PolicyEmptyState
          docType={docType}
          agentEmail={agentEmail}
          uploading={uploading}
          onUpload={handleUpload}
        />
      ) : (
        <OperationalPanel>
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[22%] px-4 text-label text-muted-foreground">
                  Carrier
                </TableHead>
                <TableHead className="w-[16%] text-label text-muted-foreground">
                  Policy no.
                </TableHead>
                <TableHead className="w-[20%] text-label text-muted-foreground">
                  Term
                </TableHead>
                <TableHead className="w-[12%] text-label text-muted-foreground">
                  Premium
                </TableHead>
                <TableHead className="w-[12%] text-label text-muted-foreground">
                  Uploaded by
                </TableHead>
                <TableHead className="w-[10%] text-label text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="w-[18%] px-4 text-label text-muted-foreground">
                  File
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((policy) => {
                const carrier =
                  cleanField(policy.mga) ??
                  cleanField(policy.carrier) ??
                  "Untitled policy";
                const policyNumber =
                  cleanField(policy.policyNumber) ?? "No policy number";
                return (
                  <TableRow
                    key={policy._id}
                    tabIndex={0}
                    onClick={() =>
                      router.push(
                        `/clients/${clientOrgId}/policies/${policy._id}`,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      router.push(
                        `/clients/${clientOrgId}/policies/${policy._id}`,
                      );
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <TableCell className="px-4">
                      <p className="truncate font-medium text-foreground">
                        {carrier}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">
                      {policyNumber}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(policy.effectiveDate)} -{" "}
                      {formatDate(policy.expirationDate)}
                    </TableCell>
                    <TableCell className="max-w-28 truncate text-muted-foreground">
                      {cleanField(policy.premium) ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {displayUploadedBy(policy.uploadedBySide)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="font-normal text-muted-foreground"
                      >
                        {displayStatus(policy.pipelineStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-60 px-4 truncate text-muted-foreground">
                      {cleanField(policy.fileName) ?? "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </OperationalPanel>
      )}
    </div>
  );
}
