"use client";

import { use, useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { ArrowLeft, Download, FileText, Calendar, Shield, DollarSign, Trash2, Upload, ChevronDown, ChevronRight, Loader2, RotateCw, AlertTriangle, Eye, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { ModeBadge } from "@/components/mode-badge";
import { type Conversation } from "@/components/conversation-message";
import dayjs from "dayjs";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { POLICY_TYPE_LABELS, QUOTE_SECTION_TYPE_LABELS, QUOTE_SECTION_TYPE_COLORS } from "@/convex/lib/policyTypes";
import { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { usePdf } from "@/components/pdf-context";
import { usePageContext } from "@/hooks/use-page-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";


function PageRef({ page }: { page: number | undefined }) {
  const pdf = usePdf();
  if (!page) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); pdf.navigateToPage(page); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); pdf.navigateToPage(page); } }}
      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/50 font-mono hover:text-foreground/70 transition-colors cursor-pointer"
    >
      p.{page}
    </span>
  );
}

function ViewPdfButton({ url }: { url?: string | null }) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;
  return (
    <PillButton variant="primary" size="compact" onClick={() => isPdfOpen ? togglePdf() : openWithUrl(url)} className="hidden lg:inline-flex">
      <Eye className="w-3.5 h-3.5" /> {isPdfOpen ? "Hide PDF" : "View PDF"}
    </PillButton>
  );
}

function DocumentSection({ section, highlighted }: { section: any; highlighted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const typeColor = QUOTE_SECTION_TYPE_COLORS[section.type] || QUOTE_SECTION_TYPE_COLORS.other;

  useEffect(() => {
    if (highlighted) {
      setExpanded(true);
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  return (
    <div
      ref={sectionRef}
      className={`border border-foreground/6 rounded-lg overflow-hidden transition-colors ${highlighted ? "ring-2 ring-blue-300 dark:ring-blue-700 bg-blue-50/30 dark:bg-blue-950/20" : ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-foreground/2 transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <span className="text-body-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {section.title}
        </span>
        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${typeColor}`}>
          {QUOTE_SECTION_TYPE_LABELS[section.type] || section.type}
        </span>
        <span className="hidden sm:inline-flex"><PageRef page={section.pageStart} /></span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-foreground/4">
          <div className="flex items-center gap-2 py-2 text-[10px] text-muted-foreground/50">
            Pages {section.pageStart}{section.pageEnd ? `–${section.pageEnd}` : ""}
            {section.coverageType && (
              <span className="bg-foreground/5 px-1.5 py-0.5 rounded">
                {POLICY_TYPE_LABELS[section.coverageType] || section.coverageType}
              </span>
            )}
          </div>
          <div className="text-body-sm text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {section.content}
          </div>
          {section.subsections?.length > 0 && (
            <div className="mt-3 space-y-2 pl-4 border-l-2 border-foreground/6">
              {section.subsections.map((sub: any, j: number) => (
                <div key={j}>
                  <p className="text-label-sm font-medium text-foreground">
                    {sub.title}
                    {sub.sectionNumber && <span className="text-muted-foreground/50 ml-1">({sub.sectionNumber})</span>}
                    <PageRef page={sub.pageNumber} />
                  </p>
                  <p className="text-body-sm text-foreground/70 whitespace-pre-wrap mt-1">
                    {sub.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type QuoteThread = {
  root: Conversation;
  messages: Conversation[];
  latestTime: number;
};

function QuoteThreadsTab({ conversations }: { conversations: Conversation[] | undefined }) {
  const threads = useMemo(() => {
    if (!conversations) return undefined;
    const convs = conversations as unknown as Conversation[];
    const threadMap = new Map<string, QuoteThread>();
    for (const conv of convs) {
      const rootId = (conv.threadId ?? conv._id) as string;
      const existing = threadMap.get(rootId);
      if (existing) {
        existing.messages.push(conv);
        if (conv._creationTime > existing.latestTime) existing.latestTime = conv._creationTime;
      } else {
        threadMap.set(rootId, {
          root: conv.threadId ? convs.find((c) => c._id === conv.threadId) ?? conv : conv,
          messages: [conv],
          latestTime: conv._creationTime,
        });
      }
    }
    for (const thread of threadMap.values()) {
      thread.messages.sort((a, b) => a._creationTime - b._creationTime);
    }
    return Array.from(threadMap.values()).sort((a, b) => b.latestTime - a.latestTime);
  }, [conversations]);

  if (conversations === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (!threads || threads.length === 0) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-12 text-center">
        <MessageSquare className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
        <p className="text-body-sm text-muted-foreground/50 mb-1">No threads about this quote</p>
        <p className="text-label-sm text-muted-foreground/30">
          When Prism references this quote in conversations, they&#39;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-foreground/6 bg-foreground/2">
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Subject</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">From</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Mode</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Messages</th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => {
            const root = thread.root;
            const msgCount = thread.messages.reduce((n, m) => n + 1 + (m.responseBody ? 1 : 0), 0);
            return (
              <tr key={root._id} className="border-b border-foreground/4 last:border-0 hover:bg-foreground/[0.02] transition-colors">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/agent/thread/${root._id}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {root.subject}
                  </Link>
                  <p className="text-label-sm text-muted-foreground/40 mt-0.5">
                    {dayjs(thread.latestTime).format("MMM D, YYYY")}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {root.fromName ?? root.fromEmail}
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell">
                  <ModeBadge mode={root.mode} />
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground/60 tabular-nums">
                  {msgCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightSection = searchParams.get("section");

  const quote = useQuery(api.quotes.get, { id: id as Id<"quotes"> });
  const fileUrl = useQuery(
    api.quotes.getFileUrl,
    quote?.fileId ? { fileId: quote.fileId } : "skip"
  );
  const softDelete = useMutation(api.quotes.softDelete);
  const restore = useMutation(api.quotes.restore);
  const retryAction = useAction(api.actions.retryExtraction.retryQuoteExtraction);

  const conversations = useQuery(
    api.agentConversations.listByQuoteId,
    quote ? { quoteId: quote._id } : "skip",
  );
  const { setPageContext } = usePageContext();
  useEffect(() => {
    if (quote) {
      const types = quote.policyTypes ?? [];
      setPageContext({
        pageType: "quote",
        entityId: quote._id,
        summary: `${quote.security || quote.carrier} ${quote.quoteNumber ?? ""} — ${types.join(", ")}`,
      });
    }
    return () => setPageContext(null);
  }, [quote, setPageContext]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "threads">("details");

  if (quote === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  if (quote === null) {
    return (
      <AppShell>
        <div className="text-center">
          <h2 className="text-lg font-semibold">Quote not found</h2>
          <Link href="/quotes" className="text-body-sm text-blue-600 hover:underline mt-2 inline-block">
            Back to quotes
          </Link>
        </div>
      </AppShell>
    );
  }

  const types = quote.policyTypes ?? ["other"];
  const carrier = quote.security || quote.carrier;
  const isExpired = (() => {
    if (!quote.quoteExpirationDate) return false;
    const expDate = dayjs(quote.quoteExpirationDate, "MM/DD/YYYY");
    return expDate.isValid() && expDate.isBefore(dayjs());
  })();

  const headerActions = (
    <>
      <ViewPdfButton url={fileUrl} />
      {fileUrl && (
        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
          <PillButton size="compact" variant="secondary">
            <Download className="w-3 h-3" /> PDF
          </PillButton>
        </a>
      )}
      {quote.deletedAt ? (
        <PillButton
          size="compact"
          variant="secondary"
          onClick={async () => {
            await restore({ id: quote._id });
            toast.success("Quote restored");
          }}
        >
          Restore
        </PillButton>
      ) : (
        <PillButton size="compact" variant="icon" onClick={() => setDeleteDialogOpen(true)} label="Delete">
          <Trash2 className="w-4 h-4" />
        </PillButton>
      )}
    </>
  );

  return (
    <AppShell breadcrumbDetail={quote.quoteNumber} actions={headerActions}>
          {/* Header */}
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <Link href="/quotes" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to quotes
              </Link>
              <h1 className="!mb-0">{quote.quoteNumber}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  Quote
                </span>
                {isExpired && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 uppercase tracking-wider">
                    <AlertTriangle className="w-3 h-3" /> Expired
                  </span>
                )}
                {quote.deletedAt && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 uppercase tracking-wider">
                    Deleted
                  </span>
                )}
                {types.map((t) => (
                  <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/5 text-muted-foreground">
                    {POLICY_TYPE_LABELS[t] || t}
                  </span>
                ))}
              </div>
            </div>
          </FadeIn>

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-foreground/6 mb-6">
            {([
              { id: "details" as const, label: "Details" },
              { id: "threads" as const, label: "Threads", count: conversations?.length },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground/70"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {tab.label}
                  {tab.count != null && tab.count > 0 && (
                    <span className="text-[10px] font-medium bg-foreground/8 text-muted-foreground px-1.5 py-0.5 rounded-full leading-none">
                      {tab.count}
                    </span>
                  )}
                </span>
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="quote-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>

          {activeTab === "details" && (<>
          {/* Info cards */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {/* Insurer */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-muted-foreground/40" />
                  <span className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">Insurer</span>
                </div>
                <p className="text-body-sm font-semibold">{(quote as any).carrierLegalName || (quote as any).security || carrier}</p>
                {(quote as any).carrierNaicNumber && <p className="text-label-sm text-muted-foreground/60 mt-0.5">NAIC: {(quote as any).carrierNaicNumber}</p>}
                {(quote as any).carrierAdmittedStatus && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mt-1 ${
                    (quote as any).carrierAdmittedStatus === "admitted" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-foreground/[0.04] text-muted-foreground"
                  }`}>
                    {(quote as any).carrierAdmittedStatus === "non_admitted" ? "Non-Admitted" : (quote as any).carrierAdmittedStatus === "surplus_lines" ? "Surplus Lines" : "Admitted"}
                  </span>
                )}
                {quote.mga && <p className="text-label-sm text-muted-foreground/50 mt-0.5">MGA: {quote.mga}</p>}
                {quote.broker && <p className="text-label-sm text-muted-foreground/50 mt-0.5">Broker: {quote.broker}</p>}
              </div>

              {/* Proposed Period */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-muted-foreground/40" />
                  <span className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">Proposed Period</span>
                </div>
                <p className="text-body-sm font-semibold">
                  {quote.proposedEffectiveDate ?? "—"} to {quote.proposedExpirationDate ?? "—"}
                </p>
                {(quote as any).coverageForm && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-foreground/[0.04] text-muted-foreground mt-1">
                    {(quote as any).coverageForm === "claims_made" ? "Claims-Made" : (quote as any).coverageForm === "occurrence" ? "Occurrence" : (quote as any).coverageForm}
                  </span>
                )}
                {quote.quoteExpirationDate && (
                  <p className={`text-label-sm mt-1 ${isExpired ? "text-red-500 font-medium" : "text-muted-foreground/60"}`}>
                    {isExpired ? "Expired" : "Quote expires"}: {quote.quoteExpirationDate}
                  </p>
                )}
              </div>

              {/* Premium */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground/40" />
                  <span className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">Premium Indication</span>
                </div>
                <p className="text-body-sm font-semibold font-mono">{quote.premium ?? "—"}</p>
                {quote.isRenewal && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 mt-1">
                    Renewal
                  </span>
                )}
                {(quote as any).premiumBreakdown?.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {(quote as any).premiumBreakdown.slice(0, 3).map((pb: any, i: number) => (
                      <p key={i} className="text-label-sm text-muted-foreground/50 font-mono">{pb.line}: {pb.amount}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Second row: Insured + Subjectivities count */}
            {(quote.insuredName || (quote as any).enrichedSubjectivities?.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-4">
                  <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Insured</p>
                  <p className="text-body-sm font-semibold">{quote.insuredName}</p>
                  {(quote as any).insuredAddress && (
                    <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                      {typeof (quote as any).insuredAddress === "string" ? (quote as any).insuredAddress : [(quote as any).insuredAddress.street1, (quote as any).insuredAddress.city, (quote as any).insuredAddress.state, (quote as any).insuredAddress.zip].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
                {(quote as any).enrichedSubjectivities?.length > 0 && (
                  <div className="rounded-lg border border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-950/20 p-4">
                    <p className="text-label-sm font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1.5">Subjectivities</p>
                    <p className="text-body-sm font-semibold text-amber-800 dark:text-amber-300">{(quote as any).enrichedSubjectivities.length} conditions</p>
                    <p className="text-label-sm text-amber-600/60 dark:text-amber-400/60 mt-0.5">Review before binding</p>
                  </div>
                )}
                {(quote as any).warrantyRequirements?.length > 0 && (
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-4">
                    <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Warranties</p>
                    <p className="text-body-sm font-semibold">{(quote as any).warrantyRequirements.length} requirements</p>
                  </div>
                )}
              </div>
            )}
          </FadeIn>

          {/* Proposed Coverages */}
          {quote.coverages.length > 0 && (
            <FadeIn when={true} staggerIndex={2} duration={0.6}>
              <div className="mb-6">
                <h3 className="text-body-sm font-semibold mb-3">Proposed Coverages</h3>
                <div className="rounded-lg border border-foreground/6 overflow-hidden">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="border-b border-foreground/6 bg-foreground/2">
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Coverage</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Proposed Limit</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Proposed Deductible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.coverages.map((c, i) => (
                        <tr key={i} className="border-b border-foreground/4 last:border-0">
                          <td className="px-4 py-2.5 font-medium">{c.name}</td>
                          <td className="px-4 py-2.5 font-mono text-xs">{c.proposedLimit}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground hidden sm:table-cell">
                            {c.proposedDeductible ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </FadeIn>
          )}

          {/* Premium Breakdown */}
          {quote.premiumBreakdown && quote.premiumBreakdown.length > 0 && (
            <FadeIn when={true} staggerIndex={3} duration={0.6}>
              <div className="mb-6">
                <h3 className="text-body-sm font-semibold mb-3">Premium Breakdown</h3>
                <div className="rounded-lg border border-foreground/6 overflow-hidden">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="border-b border-foreground/6 bg-foreground/2">
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Line</th>
                        <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.premiumBreakdown.map((pb, i) => (
                        <tr key={i} className="border-b border-foreground/4 last:border-0">
                          <td className="px-4 py-2.5">{pb.line}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs">{pb.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </FadeIn>
          )}

          {/* Subjectivities */}
          {quote.subjectivities && quote.subjectivities.length > 0 && (
            <FadeIn when={true} staggerIndex={4} duration={0.6}>
              <div className="mb-6">
                <h3 className="text-body-sm font-semibold mb-3">Subjectivities</h3>
                <div className="space-y-2">
                  {quote.subjectivities.map((s, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04]">
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm text-foreground">{s.description}</p>
                        {s.category && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mt-1 ${
                            s.category === "pre_binding" ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400" :
                            s.category === "post_binding" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" :
                            "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
                          }`}>
                            {s.category === "pre_binding" ? "Pre-Binding" :
                             s.category === "post_binding" ? "Post-Binding" :
                             "Information"}
                          </span>
                        )}
                      </div>
                      <PageRef page={s.pageNumber} />
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          )}

          {/* Underwriting Conditions */}
          {quote.underwritingConditions && quote.underwritingConditions.length > 0 && (
            <FadeIn when={true} staggerIndex={5} duration={0.6}>
              <div className="mb-6">
                <h3 className="text-body-sm font-semibold mb-3">Underwriting Conditions</h3>
                <div className="space-y-2">
                  {quote.underwritingConditions.map((uc, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04]">
                      <Eye className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-body-sm text-foreground flex-1">{uc.description}</p>
                      <PageRef page={uc.pageNumber} />
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          )}

          {/* Document Sections */}
          {quote.document?.sections && quote.document.sections.length > 0 && (
            <FadeIn when={true} staggerIndex={6} duration={0.6}>
              <div className="mb-6">
                <h3 className="text-body-sm font-semibold mb-3">
                  Document Sections ({quote.document.sections.length})
                </h3>
                <div className="space-y-2">
                  {quote.document.sections.map((section: any, i: number) => (
                    <DocumentSection
                      key={i}
                      section={section}
                      highlighted={highlightSection === section.title}
                    />
                  ))}
                </div>
              </div>
            </FadeIn>
          )}

          {/* Extraction log */}
          {quote.extractionLog && quote.extractionLog.length > 0 && (
            <FadeIn when={true} staggerIndex={7} duration={0.6}>
              <div className="mb-6">
                <h3 className="text-body-sm font-semibold mb-3">Extraction Log</h3>
                <div className="rounded-lg border border-foreground/6 bg-foreground/2 p-4">
                  <div className="space-y-1 text-xs font-mono text-muted-foreground">
                    {quote.extractionLog.map((entry, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-muted-foreground/40 shrink-0">
                          {dayjs(entry.timestamp).format("HH:mm:ss")}
                        </span>
                        <span>{entry.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </FadeIn>
          )}

          {/* Retry button for error state */}
          {quote.extractionStatus === "error" && (
            <FadeIn when={true} staggerIndex={8} duration={0.6}>
              <div className="flex items-center gap-2 mb-6">
                <PillButton
                  variant="secondary"
                  disabled={retrying}
                  onClick={async () => {
                    setRetrying(true);
                    try {
                      const result = await retryAction({ quoteId: quote._id });
                      if ((result as any)?.success) {
                        toast.success("Re-extraction complete");
                      } else {
                        toast.error((result as any)?.error || "Retry failed");
                      }
                    } finally {
                      setRetrying(false);
                    }
                  }}
                >
                  {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                  Retry Extraction
                </PillButton>
                {quote.extractionError && (
                  <p className="text-label-sm text-red-500">{quote.extractionError}</p>
                )}
              </div>
            </FadeIn>
          )}
          </>)}

          {activeTab === "threads" && (
            <QuoteThreadsTab conversations={conversations} />
          )}

      {/* Delete dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete quote?</DialogTitle>
            <DialogDescription>
              This will remove the quote from your list. You can restore it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={async () => {
                await softDelete({ id: quote._id });
                toast.success("Quote deleted");
                setDeleteDialogOpen(false);
                router.push("/quotes");
              }}
            >
              Delete
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
