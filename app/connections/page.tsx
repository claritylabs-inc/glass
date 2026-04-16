"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ConnectionForm } from "@/components/connection-form";
import { ScanModal } from "@/components/scan-modal";
import { ScanStatus } from "@/components/scan-status";
import { PolicyExtractionsLog } from "@/components/policy-extractions-log";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Upload, RefreshCw, FileText, Sparkles, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { Mail, Trash2, Square, BadgeCheck } from "lucide-react";
import { ConnectionIcon } from "@/components/connection-icon";
import { getScanCoverageLabel } from "@/components/pull-more-dropdown";
import { EmailReviewTable } from "@/components/email-review-table";
import { IntelligenceTab } from "@/components/intelligence-tab";
import { DreamLog } from "@/components/dream-log";
import { EmailScanLog } from "@/components/email-scan-log";
import { ScanCalendarDialog } from "@/components/scan-calendar-dialog";
import { LogoIcon } from "@/components/ui/logo-icon";
import { Id } from "@/convex/_generated/dataModel";
import { SiQuickbooks, SiGusto, SiBrex, SiStripe, SiShopify, SiXero, SiSalesforce, SiHubspot, SiSlack, SiNotion } from "react-icons/si";

/* Brand logos for integrations without react-icons */
function RipplingLogo(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...props} viewBox="0 0 24 21" fill="currentColor"><path d="M3.45 5.99c0-2.38-1.2-4.35-3.45-6h5.23a7.51 7.51 0 0 1 2.96 5.99 7.51 7.51 0 0 1-2.96 5.99c1.7.71 2.66 2.44 2.66 4.91v4.71H4.73v-4.71c0-2.36-1.12-4.01-3.16-4.91C3.83 4.31 5.03 2.34 3.45 5.99zm10.26 0c0-2.38-1.2-4.35-3.45-6h5.23a7.51 7.51 0 0 1 2.96 5.99 7.51 7.51 0 0 1-2.96 5.99c1.7.71 2.66 2.44 2.66 4.91v4.71h-4.74v-4.71c0-2.36-1.12-4.01-3.16-4.91 2.25-1.65 3.46-3.62 3.46-5.99zm10.27 0c0-2.38-1.2-4.35-3.45-6H24a7.51 7.51 0 0 1 0 11.98c1.7.71 2.66 2.44 2.66 4.91v4.71h-4.74v-4.71c0-2.36-1.12-4.01-3.16-4.91 2.25-1.65 3.46-3.62 3.46-5.99z" transform="scale(0.88)"/></svg>;
}
function DeelLogo(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...props} viewBox="0 0 75 72" fill="currentColor"><path d="m23.86 71.96c-4.56 0-8.64-1.12-12.22-3.35-3.59-2.23-6.42-5.28-8.51-9.16C1.04 55.57 0 51.18 0 46.25c0-4.92 1.04-9.29 3.13-13.1 2.09-3.87 4.92-6.89 8.51-9.06 3.59-2.23 7.66-3.35 12.22-3.35 3.65 0 6.85.69 9.58 2.07 2.19 1.1 4.05 2.57 5.58 4.39.35.41 1.07.18 1.07-.36V3.93c0-.26.18-.48.44-.54L51.95.02c.34-.07.66.19.66.54v69.68a.55.55 0 0 1-.55.55H41.91a.55.55 0 0 1-.54-.44l-1.04-5.31c-.09-.47-.71-.61-1.01-.24-1.46 1.76-3.29 3.33-5.49 4.72-2.54 1.64-5.87 2.46-9.98 2.46zm2.64-11.03c4.04 0 7.34-1.35 9.88-4.04 2.61-2.76 3.91-6.27 3.91-10.54s-1.3-7.75-3.91-10.44c-2.54-2.76-5.84-4.14-9.88-4.14-3.98 0-7.27 1.35-9.88 4.04-2.61 2.69-3.91 6.17-3.91 10.44s1.3 7.78 3.91 10.54 5.9 4.14 9.88 4.14z"/><circle cx="66.45" cy="62.09" r="8.43"/></svg>;
}
function CartaLogo(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...props} viewBox="0 0 24 24" fill="currentColor"><rect x="0" y="0" width="24" height="24" rx="2" fillOpacity="0"/><rect x="0.5" y="0.5" width="23" height="23" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none"/><text x="12" y="16.5" textAnchor="middle" fontSize="8" fontWeight="600" fontFamily="system-ui" fill="currentColor">carta</text></svg>;
}
function MercuryLogo(props: React.SVGProps<SVGSVGElement>) {
  return <svg {...props} viewBox="0 0 32 32" fill="currentColor"><path d="M16 0C7.19 0 .02 7.14 0 15.94v.07C0 24.84 7.19 32 16 32s16-7.19 16-15.99C32 7.16 24.83 0 16 0zm0 1.93a14.02 14.02 0 0 1 13.07 19.08c-.88.74-1.99 1.16-3.17 1.16-1.35 0-2.61-.43-3.62-1.18.51-.51.94-1.09 1.29-1.73a3.18 3.18 0 0 0 2.33.97 3.09 3.09 0 0 0 0-6.18c-1.16 0-2.22.67-2.75 1.7-.48-.87-1.13-1.62-1.89-2.2a5.12 5.12 0 0 1 4.64-3.42c.07 0 .14 0 .21.01A14.03 14.03 0 0 0 16 1.93zm-4.01 2.2a5.1 5.1 0 0 1-2.1 4.13 7.83 7.83 0 0 0-3.84 2.34A5.1 5.1 0 0 1 1.93 16a14.03 14.03 0 0 1 10.06-11.87zM16 12.2a3.79 3.79 0 1 1 0 7.58 3.79 3.79 0 0 1 0-7.58zm-9.9 1.83A3.09 3.09 0 1 0 6.1 17.9a3.1 3.1 0 0 0 2.75-1.7c.49.87 1.14 1.62 1.9 2.2a5.12 5.12 0 0 1-4.65 3.42h-.21A14.03 14.03 0 0 0 16 30.07 14.03 14.03 0 0 1 2.93 11C3.81 10.26 4.92 9.84 6.1 9.84c1.35 0 2.61.44 3.63 1.18-.52.51-.95 1.09-1.3 1.73a3.17 3.17 0 0 0-2.33-.97v.24zm13.91 11.84A5.1 5.1 0 0 1 22.1 21.73a7.83 7.83 0 0 0 3.84-2.34A5.1 5.1 0 0 1 30.07 16a14.03 14.03 0 0 1-10.06 11.87z"/></svg>;
}
const INTEGRATIONS: { name: string; desc: string; icon: React.ComponentType<any> }[] = [
  { name: "QuickBooks", desc: "Revenue, payroll, financials", icon: SiQuickbooks },
  { name: "Xero", desc: "Accounting, invoices", icon: SiXero },
  { name: "Gusto", desc: "Employee count, payroll", icon: SiGusto },
  { name: "Rippling", desc: "HR, headcount, benefits", icon: RipplingLogo },
  { name: "Deel", desc: "Global workforce, contractors", icon: DeelLogo },
  { name: "Stripe", desc: "Revenue, payment volume", icon: SiStripe },
  { name: "Brex", desc: "Spend data, corporate cards", icon: SiBrex },
  { name: "Mercury", desc: "Banking, transactions", icon: MercuryLogo },
  { name: "Carta", desc: "Cap table, entity structure", icon: CartaLogo },
  { name: "Shopify", desc: "E-commerce, sales data", icon: SiShopify },
  { name: "Salesforce", desc: "CRM, revenue pipeline", icon: SiSalesforce },
  { name: "HubSpot", desc: "CRM, customer data", icon: SiHubspot },
  { name: "Slack", desc: "Team comms, notifications", icon: SiSlack },
  { name: "Notion", desc: "Docs, company wiki", icon: SiNotion },
];

const TABS = [
  { id: "sources", label: "Sources" },
  { id: "inbox", label: "Inbox" },
  { id: "intelligence", label: "Intelligence" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function RemoveConnectionDialog({
  connectionId,
  connectionLabel,
  open,
  onClose,
}: {
  connectionId: Id<"emailConnections">;
  connectionLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const removeConnection = useMutation(api.connections.remove);
  const counts = useQuery(
    api.connections.countLinkedPolicies,
    open ? { id: connectionId } : "skip"
  );
  const [removing, setRemoving] = useState(false);

  const handleRemove = async (deletePolicies: boolean) => {
    setRemoving(true);
    try {
      await removeConnection({ id: connectionId, deletePolicies });
      onClose();
      toast.success("Connection removed");
    } catch {
      toast.error("Failed to remove connection");
    } finally {
      setRemoving(false);
    }
  };

  const hasPolicies = counts && counts.policyCount > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Remove Connection</DialogTitle>
          <DialogDescription>
            Remove <strong>{connectionLabel}</strong> and its{" "}
            {counts ? counts.emailCount : "..."} emails?
            {hasPolicies && (
              <>
                <br />
                <br />
                This connection has{" "}
                <strong>{counts.policyCount} extracted {counts.policyCount === 1 ? "policy" : "policies"}</strong>.
                Would you like to remove those as well?
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <PillButton variant="secondary" onClick={onClose} disabled={removing}>
            Cancel
          </PillButton>
          {hasPolicies ? (
            <>
              <PillButton variant="secondary" onClick={() => handleRemove(false)} disabled={removing}>
                Keep policies
              </PillButton>
              <PillButton variant="destructive" onClick={() => handleRemove(true)} disabled={removing}>
                {removing ? "Removing..." : "Remove all"}
              </PillButton>
            </>
          ) : (
            <PillButton variant="destructive" onClick={() => handleRemove(false)} disabled={removing}>
              {removing ? "Removing..." : "Remove"}
            </PillButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Handle Google OAuth callback params
  const handleOAuthToast = useCallback(() => {
    const googleParam = searchParams.get("google");
    if (googleParam === "connected") {
      toast.success("Google account connected");
    } else if (googleParam === "error") {
      toast.error(searchParams.get("message") || "Failed to connect Google account");
    }
    if (googleParam) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("google");
      params.delete("message");
      params.delete("sinceDate");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  useEffect(() => {
    handleOAuthToast();
  }, [handleOAuthToast]);

  const initialTab = (searchParams.get("tab") as TabId) || "sources";
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS.some((t) => t.id === initialTab) ? initialTab : "sources"
  );

  const connections = useQuery(api.connections.list);
  const orgData = useQuery(api.orgs.viewerOrg);
  const orgId = orgData?.org?._id;

  const [selectedConnectionId, setSelectedConnectionId] = useState<Id<"emailConnections"> | null>(null);

  // Auto-select first connection for Emails tab
  const firstConnectionId = connections?.[0]?._id ?? null;
  const emailsConnectionId = selectedConnectionId ?? firstConnectionId;

  const [formOpen, setFormOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextFileInputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const extractFromUpload = useAction(api.actions.extractFromUpload.extractFromUpload);
  const extractFromDocument = useAction(api.actions.extractFromDocument.extractFromDocument);

  const EXT_TYPE_MAP: Record<string, string> = {
    ".md": "text/markdown", ".mdx": "text/mdx", ".csv": "text/csv",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const uploadToStorage = async (file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    const url = await generateUploadUrl();
    const contentType = file.type || EXT_TYPE_MAP[ext] || "application/octet-stream";
    const result = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: file,
    });
    const { storageId } = await result.json();
    return storageId;
  };

  // Insurance documents → policy extraction pipeline (PDFs only)
  const handleInsuranceUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Insurance documents must be PDF files");
      return;
    }
    setUploading(true);
    try {
      const storageId = await uploadToStorage(file);
      toast.success("Uploaded, extracting policy...");
      handleTabChange("activity");
      const outcome = await extractFromUpload({ fileId: storageId, fileName: file.name });
      if ("error" in outcome) {
        toast.error(outcome.error);
      } else {
        toast.success(`${outcome.type === "quote" ? "Quote" : "Policy"} extracted successfully`);
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Business context → intelligence extraction pipeline (any supported file)
  const handleContextUpload = async (file: File) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    const supported = [".pdf", ".md", ".mdx", ".csv", ".doc", ".docx", ".xls", ".xlsx"];
    if (!supported.includes(ext)) {
      toast.error("Supported: PDF, Word, Excel, CSV, Markdown");
      return;
    }
    setUploading(true);
    try {
      const storageId = await uploadToStorage(file);
      toast.success("Uploaded, extracting business context...");
      const outcome = await extractFromDocument({ fileId: storageId, fileName: file.name });
      if ("error" in outcome) {
        toast.error(outcome.error);
      } else {
        toast.success(`${outcome.entries} intelligence entries extracted`);
        handleTabChange("intelligence");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (contextFileInputRef.current) contextFileInputRef.current.value = "";
    }
  };

  const [scanTarget, setScanTarget] = useState<{
    id: Id<"emailConnections">;
    provider?: "google" | "imap";
    defaults?: {
      sinceDate?: string;
      untilDate?: string;
      senderDomains?: string[];
      lastScanAt?: number;
    };
  } | null>(null);
  const stopScan = useMutation(api.connections.stopScan);
  const removeDemoData = useMutation(api.seed.removeDemoData);
  const [removeTarget, setRemoveTarget] = useState<{
    id: Id<"emailConnections">;
    label: string;
  } | null>(null);
  const [showRemoveDemo, setShowRemoveDemo] = useState(false);
  const [integrationRequest, setIntegrationRequest] = useState<string | null>(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState<Id<"emails">[]>([]);
  const [consolidating, setConsolidating] = useState(false);
  const consolidate = useAction(api.actions.dreamConsolidation.consolidate);
  const updateClassification = useMutation(api.emails.updateClassification);
  const bulkReclassify = useMutation(api.emails.bulkReclassify);
  const [calendarTarget, setCalendarTarget] = useState<{
    id: Id<"emailConnections">;
    provider?: "google" | "imap";
  } | null>(null);
  const [removingDemo, setRemovingDemo] = useState(false);

  const openScanModal = (conn: NonNullable<typeof connections>[number]) => {
    setScanTarget({
      id: conn._id,
      provider: conn.provider as "google" | "imap" | undefined,
      defaults: {
        sinceDate: conn.lastScanParams?.sinceDate,
        untilDate: conn.lastScanParams?.untilDate,
        senderDomains: conn.lastScanParams?.senderDomains,
        lastScanAt: conn.lastScanAt,
      },
    });
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    const url = tab === "sources" ? "/connections" : `/connections?tab=${tab}`;
    router.replace(url, { scroll: false });
  };

  const handleBulkClassify = async (isInsurance: boolean) => {
    for (const id of selectedEmailIds) {
      await updateClassification({ id, isInsuranceRelated: isInsurance });
    }
    toast.success(`${selectedEmailIds.length} emails updated`);
    setSelectedEmailIds([]);
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    try {
      await consolidate();
      toast.success("Consolidation started — this may take a minute");
      handleTabChange("activity");
    } catch {
      toast.error("Failed to start consolidation");
    } finally {
      setConsolidating(false);
    }
  };

  const handleBulkRescan = async () => {
    await bulkReclassify({ ids: selectedEmailIds });
    toast.success(`${selectedEmailIds.length} emails queued for reclassification`);
    setSelectedEmailIds([]);
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleInsuranceUpload(f); }}
      />
      <input
        ref={contextFileInputRef}
        type="file"
        accept=".pdf,.md,.mdx,.csv,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleContextUpload(f); }}
      />
      {activeTab === "sources" && (
          <PillButton size="compact" onClick={() => setFormOpen(true)}>
            Add Connection <ArrowRight className="w-3 h-3" />
          </PillButton>
      )}
      {activeTab === "inbox" && selectedEmailIds.length > 0 && (
        <>
          <PillButton size="compact" variant="secondary" onClick={() => handleBulkClassify(true)}>
            Mark Insurance
          </PillButton>
          <PillButton size="compact" variant="secondary" onClick={() => handleBulkClassify(false)}>
            Mark Not Insurance
          </PillButton>
          <PillButton size="compact" variant="secondary" onClick={handleBulkRescan}>
            Rescan
          </PillButton>
        </>
      )}
      {activeTab === "intelligence" && (
        <PillButton
          size="compact"
          variant="secondary"
          disabled={consolidating}
          onClick={handleConsolidate}
        >
          {consolidating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Consolidate Context
        </PillButton>
      )}
    </div>
  );

  return (
    <AppShell actions={headerActions}>

          {/* Tabs */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="flex items-center gap-1 border-b border-foreground/6 mb-6 overflow-x-auto scrollbar-hide">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === tab.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/70"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="connections-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                </button>
              ))}
            </div>
          </FadeIn>

          {/* Connections tab */}
          {activeTab === "sources" && (
            <div className="space-y-8">

              {/* ── Email Connections ── */}
              <section>
                <div className="mb-3">
                  <h3 className="text-body-sm font-medium text-foreground !mb-0">Email Connections</h3>
                  <p className="text-label-sm text-muted-foreground/60">Auto-scanned daily for policies and business intelligence</p>
                </div>

              {connections === undefined && (
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-8 h-8 rounded-md shrink-0" />
                        <div className="flex-1 min-w-0">
                          <Skeleton className="h-4 w-36 mb-1.5" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                        <div className="hidden md:flex items-center gap-3">
                          <Skeleton className="h-5 w-16 rounded-full" />
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-8 w-16 rounded-full" />
                          <Skeleton className="h-8 w-8 rounded-md" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {connections && connections.length === 0 && (
                <FadeIn when={true} delay={0.2} duration={0.6}>
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
                    <p className="text-body-sm text-muted-foreground/60">
                      No email connections yet
                    </p>
                  </div>
                </FadeIn>
              )}

              <div className="space-y-3">
                {connections?.map((conn, i) => {
                  const isScanning = conn.scanProgress && conn.scanProgress.phase !== "complete";
                  const isDemo = conn.isDemo === true;

                  return (
                    <FadeIn
                      key={conn._id}
                      when={true}
                      staggerIndex={i + 2}
                      duration={0.6}
                    >
                      <div className={`rounded-lg border px-4 py-3 ${isDemo ? "border-amber-200/60 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/20" : "border-foreground/6 bg-white/60 dark:bg-white/[0.04]"}`}>
                        {/* Desktop layout: single row */}
                        <div className="hidden md:flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            {isDemo ? (
                              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
                                <Mail className="w-4 h-4 text-amber-500" />
                              </div>
                            ) : (
                              <ConnectionIcon imapHost={conn.imapHost} provider={conn.provider} className="w-8 h-8 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-body-sm font-medium text-foreground truncate">
                                  {conn.label}
                                </p>
                                {isDemo && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 shrink-0">
                                    Demo
                                  </span>
                                )}
                                {!isDemo && conn.provider === "google" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-sm font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 shrink-0">
                                    <BadgeCheck className="w-3 h-3" />
                                    OAuth
                                  </span>
                                )}
                              </div>
                              <p className="text-label-sm text-muted-foreground/60 truncate">
                                {conn.provider === "google"
                                  ? conn.email
                                  : `${conn.email} · ${conn.imapHost}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {!isDemo && (
                              <ScanStatus
                                status={conn.lastScanStatus}
                                error={conn.lastScanError}
                                progress={conn.scanProgress}
                              />
                            )}
                            {conn.emailsFound != null && !isScanning && (
                              <span className="text-label-sm text-muted-foreground">
                                {conn.emailsFound} emails ·{" "}
                                {conn.policiesExtracted ?? 0} policies
                              </span>
                            )}
                            {!isDemo && !isScanning && conn.lastScanAt && (
                              <span className="text-label-sm text-muted-foreground/50">
                                {getScanCoverageLabel(conn.lastScanParams?.sinceDate, conn.lastScanAt)}
                              </span>
                            )}
                            {!isDemo && conn.provider === "google" && conn.lastScanStatus === "disconnected" && (
                              <a href={`/api/auth/google/start${orgId ? `?orgId=${orgId}` : ""}`}>
                                <PillButton variant="secondary">
                                  <RefreshCw className="w-3 h-3" />
                                  Reconnect
                                </PillButton>
                              </a>
                            )}
                            {!isDemo && (
                              isScanning ? (
                                <PillButton
                                  variant="destructive"
                                  onClick={() => stopScan({ id: conn._id })}
                                >
                                  <Square className="w-3 h-3" />
                                  Stop
                                </PillButton>
                              ) : (
                                <PillButton
                                  variant="secondary"
                                  onClick={() => setCalendarTarget({
                                    id: conn._id,
                                    provider: conn.provider as "google" | "imap" | undefined,
                                  })}
                                >
                                  Manage
                                </PillButton>
                              )
                            )}
                            <PillButton
                              variant="icon"
                              label="Remove"
                              onClick={() =>
                                isDemo
                                  ? setShowRemoveDemo(true)
                                  : setRemoveTarget({ id: conn._id, label: conn.label })
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </PillButton>
                          </div>
                        </div>

                        {/* Mobile layout: vertical stack */}
                        <div className="md:hidden space-y-3">
                          <div className="flex items-center gap-3">
                            {isDemo ? (
                              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
                                <Mail className="w-4 h-4 text-amber-500" />
                              </div>
                            ) : (
                              <ConnectionIcon imapHost={conn.imapHost} provider={conn.provider} className="w-8 h-8 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-body-sm font-medium text-foreground truncate">
                                  {conn.label}
                                </p>
                                {isDemo && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 shrink-0">
                                    Demo
                                  </span>
                                )}
                                {!isDemo && conn.provider === "google" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-sm font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 shrink-0">
                                    <BadgeCheck className="w-3 h-3" />
                                    OAuth
                                  </span>
                                )}
                              </div>
                              <p className="text-label-sm text-muted-foreground/60 truncate">
                                {conn.provider === "google"
                                  ? conn.email
                                  : `${conn.email} · ${conn.imapHost}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {!isDemo && (
                              <ScanStatus
                                status={conn.lastScanStatus}
                                error={conn.lastScanError}
                                progress={conn.scanProgress}
                              />
                            )}
                            {conn.emailsFound != null && !isScanning && (
                              <span className="text-label-sm text-muted-foreground">
                                {conn.emailsFound} emails · {conn.policiesExtracted ?? 0} policies
                              </span>
                            )}
                            {!isDemo && !isScanning && conn.lastScanAt && (
                              <span className="text-label-sm text-muted-foreground/50">
                                · {getScanCoverageLabel(conn.lastScanParams?.sinceDate, conn.lastScanAt)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {!isDemo && conn.provider === "google" && conn.lastScanStatus === "disconnected" && (
                              <a href={`/api/auth/google/start${orgId ? `?orgId=${orgId}` : ""}`}>
                                <PillButton variant="secondary">
                                  <RefreshCw className="w-3 h-3" />
                                  Reconnect
                                </PillButton>
                              </a>
                            )}
                            {!isDemo && (
                              isScanning ? (
                                <PillButton
                                  variant="destructive"
                                  onClick={() => stopScan({ id: conn._id })}
                                >
                                  <Square className="w-3 h-3" />
                                  Stop
                                </PillButton>
                              ) : (
                                <PillButton
                                  variant="secondary"
                                  onClick={() => setCalendarTarget({
                                    id: conn._id,
                                    provider: conn.provider as "google" | "imap" | undefined,
                                  })}
                                >
                                  Manage
                                </PillButton>
                              )
                            )}
                            <PillButton
                              variant="icon"
                              label="Remove"
                              onClick={() =>
                                isDemo
                                  ? setShowRemoveDemo(true)
                                  : setRemoveTarget({ id: conn._id, label: conn.label })
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </PillButton>
                          </div>
                        </div>
                      </div>
                    </FadeIn>
                  );
                })}
              </div>
              </section>

              {/* ── Documents ── */}
              <section>
                <div className="mb-3">
                  <h3 className="text-body-sm font-medium text-foreground !mb-0">Documents</h3>
                  <p className="text-label-sm text-muted-foreground/60">Upload insurance policies and business context documents</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Insurance Documents card */}
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-foreground/6 bg-foreground/[0.015]">
                      <p className="text-label-sm font-medium text-muted-foreground">Insurance Documents</p>
                      <p className="text-[11px] text-muted-foreground/50">Policies, certificates, and quotes</p>
                    </div>
                    <UploadedDocumentsInline />
                    <div className="p-3 mt-auto">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragging(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) handleInsuranceUpload(file);
                        }}
                        className={`rounded-lg border-2 border-dashed transition-all cursor-pointer px-4 py-3.5 group ${
                          dragging
                            ? "border-primary/40 bg-primary/[0.04]"
                            : "border-foreground/8 hover:border-foreground/15 bg-foreground/[0.01] hover:bg-foreground/[0.025]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            dragging ? "bg-primary/10" : "bg-foreground/[0.04] group-hover:bg-foreground/[0.08]"
                          }`}>
                            <Upload className={`w-3.5 h-3.5 transition-colors ${
                              dragging ? "text-primary" : "text-muted-foreground/40 group-hover:text-muted-foreground/60"
                            }`} />
                          </div>
                          <div className="text-left">
                            <p className="text-body-sm font-medium text-foreground">
                              {uploading ? "Uploading..." : "Upload or drag a PDF"}
                            </p>
                            <p className="text-[11px] text-muted-foreground/50">
                              Policy, certificate, or quote
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Business Context card */}
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-foreground/6 bg-foreground/[0.015]">
                      <p className="text-label-sm font-medium text-muted-foreground">Business Context</p>
                      <p className="text-[11px] text-muted-foreground/50">Enrich your intelligence profile</p>
                    </div>
                    <UploadedContextDocsInline />
                    <div className="p-3 mt-auto">
                      <div
                        onClick={() => contextFileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragging(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) handleContextUpload(file);
                        }}
                        className={`rounded-lg border-2 border-dashed transition-all cursor-pointer px-4 py-3.5 group ${
                          dragging
                            ? "border-primary/40 bg-primary/[0.04]"
                            : "border-foreground/8 hover:border-foreground/15 bg-foreground/[0.01] hover:bg-foreground/[0.025]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            dragging ? "bg-primary/10" : "bg-foreground/[0.04] group-hover:bg-foreground/[0.08]"
                          }`}>
                            <Upload className={`w-3.5 h-3.5 transition-colors ${
                              dragging ? "text-primary" : "text-muted-foreground/40 group-hover:text-muted-foreground/60"
                            }`} />
                          </div>
                          <div className="text-left">
                            <p className="text-body-sm font-medium text-foreground">
                              {uploading ? "Uploading..." : "Upload or drag a document"}
                            </p>
                            <p className="text-[11px] text-muted-foreground/50">
                              {orgData?.org?.industry
                                ? `e.g. incorporation docs, pitch deck, ${orgData.org.industry.toLowerCase()} certificates`
                                : "e.g. incorporation docs, pitch deck, financials"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Integrations ── */}
              <section>
                <div className="mb-3">
                  <h3 className="text-body-sm font-medium text-foreground !mb-0">Integrations</h3>
                  <p className="text-label-sm text-muted-foreground/60">Connect your tools to automatically sync business context</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {INTEGRATIONS.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setIntegrationRequest(item.name)}
                      className="group/int rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-4 py-3 flex items-center gap-3 text-left hover:border-primary/30 hover:bg-primary/[0.02] transition-all cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
                        <item.icon className="w-4 h-4 text-muted-foreground/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm font-medium text-foreground">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground/50 truncate">{item.desc}</p>
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground/40 bg-foreground/[0.04] group-hover/int:bg-primary/10 group-hover/int:text-primary px-2 py-0.5 rounded-full shrink-0 transition-colors">
                        Soon
                      </span>
                    </button>
                  ))}
                </div>

              </section>

            </div>
          )}

          {/* Emails tab */}
          {activeTab === "inbox" && (
            <div className="space-y-4">
              {connections && connections.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                  {connections.map((conn) => {
                    const isSelected = conn._id === emailsConnectionId;
                    return (
                      <button
                        key={conn._id}
                        type="button"
                        onClick={() => setSelectedConnectionId(conn._id)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all cursor-pointer shrink-0 ${
                          isSelected
                            ? "bg-foreground text-background shadow-sm"
                            : "border border-foreground/8 bg-popover text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02]"
                        }`}
                      >
                        <ConnectionIcon
                          imapHost={conn.imapHost}
                          provider={conn.provider}
                          className={`w-7 h-7 shrink-0 ${isSelected ? "!bg-background/20" : ""}`}
                        />
                        <div className="min-w-0">
                          <p className={`text-body-sm font-medium truncate leading-tight ${isSelected ? "text-background" : "text-foreground"}`}>
                            {conn.label}
                          </p>
                          <p className={`text-label-sm truncate leading-tight ${isSelected ? "text-background/60" : "text-muted-foreground/50"}`}>
                            {conn.email}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {emailsConnectionId ? (
                <EmailReviewTable
                  connectionId={emailsConnectionId}
                  onSelectionChange={setSelectedEmailIds}
                />
              ) : (
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
                  <p className="text-body-sm text-muted-foreground/60">
                    No connections available. Add a connection first.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Intelligence tab */}
          {activeTab === "intelligence" && (
            <IntelligenceTab />
          )}

          {/* Activity tab — processing + history combined */}
          {activeTab === "activity" && (
            <div className="space-y-6">
              <EmailScanLog />
              <PolicyExtractionsLog />
              <DreamLog />
            </div>
          )}

      <ConnectionForm open={formOpen} onClose={() => setFormOpen(false)} orgId={orgId} />

      {scanTarget && (
        <ScanModal
          open={true}
          onClose={() => setScanTarget(null)}
          onScanStarted={() => handleTabChange("activity")}
          connectionId={scanTarget.id}
          provider={scanTarget.provider}
          defaults={scanTarget.defaults}
        />
      )}

      {removeTarget && (
        <RemoveConnectionDialog
          connectionId={removeTarget.id}
          connectionLabel={removeTarget.label}
          open={true}
          onClose={() => setRemoveTarget(null)}
        />
      )}

      <Dialog open={showRemoveDemo} onOpenChange={(v) => !v && setShowRemoveDemo(false)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove Demo Data</DialogTitle>
            <DialogDescription>
              This will remove all demo connections, emails, policies, and quotes.
              Your real data will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setShowRemoveDemo(false)} disabled={removingDemo}>
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={removingDemo}
              onClick={async () => {
                setRemovingDemo(true);
                try {
                  await removeDemoData();
                  setShowRemoveDemo(false);
                  toast.success("Demo data removed");
                } catch {
                  toast.error("Failed to remove demo data");
                } finally {
                  setRemovingDemo(false);
                }
              }}
            >
              {removingDemo ? "Removing..." : "Remove demo data"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {calendarTarget && (
        <ScanCalendarDialog
          open={true}
          onClose={() => setCalendarTarget(null)}
          connectionId={calendarTarget.id}
          provider={calendarTarget.provider}
        />
      )}

      {/* Integration request modal */}
      <Dialog open={!!integrationRequest} onOpenChange={(v) => !v && setIntegrationRequest(null)}>
        <DialogContent showCloseButton={false} className="overflow-hidden !p-0 !gap-0">
          {/* Hero header with dot matrix bg */}
          <div className="relative px-6 py-8 overflow-hidden">
            {/* Background image + overlay */}
            <div className="absolute inset-0">
              <img src="/sf-hero.webp" alt="" className="w-full h-full object-cover scale-110 blur-[6px]" />
              <div className="absolute inset-0 bg-black/30" />
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
                {Array.from({ length: 15 }).flatMap((_, row) =>
                  Array.from({ length: 30 }).map((_, col) => (
                    <circle
                      key={`${row}-${col}`}
                      cx={col * 14}
                      cy={row * 14}
                      r={0.6}
                      fill={`rgba(255,255,255,${0.1 + (row / 15) * 0.4})`}
                    />
                  ))
                )}
              </svg>
            </div>

            {/* Logo pair */}
            <div className="relative flex items-center justify-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <LogoIcon size={24} color="#ffffff" static />
              </div>
              <div className="flex items-center gap-1">
                <div className="w-6 h-px bg-white/30" />
                <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
                <div className="w-6 h-px bg-white/30" />
              </div>
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                {(() => {
                  const integration = INTEGRATIONS.find((i) => i.name === integrationRequest);
                  if (!integration) return null;
                  const Icon = integration.icon;
                  return <Icon className="w-5 h-5 text-white" />;
                })()}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            <DialogHeader className="!mb-0">
              <DialogTitle>{integrationRequest} integration</DialogTitle>
              <DialogDescription>
                The {integrationRequest} integration is coming soon. Request early access and we'll notify you when it's ready.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6 !-mx-6 !-mb-6 !px-6 !pb-6 [&>*]:w-full [&>*]:sm:w-auto">
              <PillButton variant="secondary" onClick={() => setIntegrationRequest(null)} className="w-full sm:w-auto">
                Cancel
              </PillButton>
              <a
                href={`mailto:hello@claritylabs.inc?subject=Early access: ${integrationRequest} integration&body=Hi, I'd like early access to the ${integrationRequest} integration on Prism.`}
                onClick={() => {
                  setIntegrationRequest(null);
                  toast.success("Opening email — thanks for your interest!");
                }}
                className="w-full sm:w-auto"
              >
                <PillButton className="w-full sm:w-auto">
                  <Mail className="w-3 h-3" />
                  Request Early Access
                </PillButton>
              </a>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function UploadedDocumentsInline() {
  const policies = useQuery(api.policies.list, {});
  const removePolicy = useMutation(api.policies.remove);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Only show manually uploaded policies (have fileId, no emailId)
  const uploaded = (policies ?? []).filter(
    (p: any) => p.fileId && !p.emailId
  );

  if (uploaded.length === 0) return null;

  return (
    <div className="divide-y divide-foreground/4 border-b border-foreground/6">
      {uploaded.map((doc: any) => (
        <div key={doc._id} className="px-4 py-2.5 flex items-center gap-3 group hover:bg-foreground/[0.015] transition-colors">
          <FileText className="w-4 h-4 text-muted-foreground/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-body-sm text-foreground truncate">{doc.fileName || doc.carrier || "Document"}</p>
            <p className="text-label-sm text-muted-foreground/50 truncate">
              {doc.documentType === "quote" ? "Quote" : "Policy"}
              {doc.carrier ? ` · ${doc.security || doc.carrier}` : ""}
              {doc.extractionStatus === "complete" ? " · Extracted" : doc.extractionStatus === "extracting" ? " · Extracting..." : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              setRemovingId(doc._id);
              try {
                await removePolicy({ id: doc._id });
                toast.success("Document removed");
              } catch {
                toast.error("Failed to remove document");
              } finally {
                setRemovingId(null);
              }
            }}
            disabled={removingId === doc._id}
            className="p-1 text-muted-foreground/20 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function UploadedContextDocsInline() {
  const docs = useQuery(api.intelligence.listUploadedDocuments);

  if (!docs || docs.length === 0) return null;

  return (
    <div className="divide-y divide-foreground/4 border-b border-foreground/6">
      {docs.map((doc) => (
        <div key={doc.sourceRef} className="px-4 py-2.5 flex items-center gap-3 hover:bg-foreground/[0.015] transition-colors">
          <FileText className="w-4 h-4 text-muted-foreground/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-body-sm text-foreground truncate">{doc.sourceLabel || "Document"}</p>
            <p className="text-label-sm text-muted-foreground/50 truncate">
              {doc.entryCount} {doc.entryCount === 1 ? "entry" : "entries"} extracted
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
