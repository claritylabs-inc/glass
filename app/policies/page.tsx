"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PolicyTable } from "@/components/policy-table";
import { useMembershipStatus } from "@/hooks/use-membership-status";
import { PendingApprovalState } from "@/components/pending-approval-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { usePathname, useRouter } from "next/navigation";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

function parseDate(dateStr: string | undefined) {
  if (!dateStr || dateStr === "Unknown") return null;
  const d = dayjs(dateStr, "MM/DD/YYYY");
  return d.isValid() ? d : null;
}

const TABS = [
  { id: "active", label: "Active" },
  { id: "expired", label: "Expired" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function PoliciesLoadingSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-1 mb-4">
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-24 hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PoliciesEmptyState() {
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const extractFromUpload = useAction(api.actions.extractFromUpload.extractFromUpload);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const uploadPolicy = useCallback(async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF policy document.");
      return;
    }

    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Failed to upload file");
      const { storageId } = await uploadRes.json();

      const result = await extractFromUpload({
        fileId: storageId,
        fileName: file.name,
      });

      if ((result as Record<string, unknown>)?.error) {
        toast.error((result as Record<string, unknown>).error as string);
        return;
      }

      toast.success("Policy uploaded. Extraction started.");
      router.replace(`${pathname}?refresh=${Date.now()}`);
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setDragging(false);
    }
  }, [extractFromUpload, generateUploadUrl, pathname, router]);

  return (
    <div className="rounded-lg border border-foreground/6 bg-card p-6">
      <div className="mb-4">
        <p className="text-body-sm font-medium text-foreground">No policies yet</p>
        <p className="text-label-sm text-muted-foreground mt-1">Drop in a policy PDF to start extraction right away.</p>
      </div>

      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) void uploadPolicy(file);
        }}
        className={`w-full rounded-lg border border-dashed px-6 py-10 text-center transition-colors ${dragging ? "border-primary/40 bg-primary/[0.03]" : "border-foreground/10 hover:border-foreground/20 hover:bg-foreground/[0.01]"} ${uploading ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.04]">
          <FileUp className="h-5 w-5 text-foreground/70" />
        </div>
        <p className="text-body-sm font-medium text-foreground">
          {uploading ? "Uploading policy..." : dragging ? "Drop PDF to upload" : "Drag and drop a policy PDF"}
        </p>
        <p className="mt-1 text-label-sm text-muted-foreground">or click to choose a file</p>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadPolicy(file);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

export default function PoliciesPage() {
  const membershipStatus = useMembershipStatus();
  const policies = useQuery(api.policies.list, {});
  const [activeTab, setActiveTab] = useState<TabId>("active");

  if (membershipStatus === "pending") {
    return (
      <AppShell>
        <PendingApprovalState />
      </AppShell>
    );
  }

  const today = dayjs();

  const { activePolicies, expiredPolicies } = useMemo(() => {
    if (!policies) return { activePolicies: undefined, expiredPolicies: undefined };
    const nonQuotes = policies.filter((p: Record<string, unknown>) => p.documentType !== "quote");
    const active = nonQuotes.filter((p: Record<string, unknown>) => {
      const exp = parseDate(p.expirationDate as string | undefined);
      if (!exp) return true;
      return !exp.isBefore(today, "day");
    });
    const expired = nonQuotes.filter((p: Record<string, unknown>) => {
      const exp = parseDate(p.expirationDate as string | undefined);
      if (!exp) return false;
      return exp.isBefore(today, "day");
    });
    return { activePolicies: active, expiredPolicies: expired };
  }, [policies, today]);

  const isLoading = policies === undefined;
  const displayPolicies = activeTab === "active" ? activePolicies : expiredPolicies;
  const hasAnyPolicies = (activePolicies?.length ?? 0) + (expiredPolicies?.length ?? 0) > 0;
  const tablePolicies = displayPolicies as unknown as Parameters<typeof PolicyTable>[0]["policies"];

  return (
    <AppShell>
      {isLoading ? (
        <PoliciesLoadingSkeleton />
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabId)}
          className="mb-4"
        >
          <TabsList variant="pill">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {!isLoading && !hasAnyPolicies ? (
        <PoliciesEmptyState />
      ) : (
        <PolicyTable policies={tablePolicies} />
      )}
    </AppShell>
  );
}
