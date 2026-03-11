"use client";

import { use, useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { ArrowLeft, Download, FileText, Calendar, Shield, DollarSign, Trash2, Upload, ChevronDown, ChevronRight, Loader2, RotateCw, AlertTriangle, Eye } from "lucide-react";
import dayjs from "dayjs";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { POLICY_TYPE_LABELS, QUOTE_SECTION_TYPE_LABELS, QUOTE_SECTION_TYPE_COLORS } from "@/convex/lib/policyTypes";
import { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

function PageRef({ page }: { page: number | undefined }) {
  if (!page) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/50 font-mono">
      p.{page}
    </span>
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
      className={`border border-foreground/6 rounded-lg overflow-hidden transition-colors ${highlighted ? "ring-2 ring-blue-300 bg-blue-50/30" : ""}`}
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

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  if (quote === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (quote === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 text-center">
            <h2 className="text-lg font-semibold">Quote not found</h2>
            <Link href="/quotes" className="text-body-sm text-blue-600 hover:underline mt-2 inline-block">
              Back to quotes
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const types = quote.policyTypes ?? ["other"];
  const carrier = quote.security || quote.carrier;
  const isExpired = (() => {
    if (!quote.quoteExpirationDate) return false;
    const expDate = dayjs(quote.quoteExpirationDate, "MM/DD/YYYY");
    return expDate.isValid() && expDate.isBefore(dayjs());
  })();

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          {/* Header */}
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <Link href="/quotes" className="inline-flex items-center gap-1 text-label-sm text-muted-foreground hover:text-foreground mb-2">
                  <ArrowLeft className="w-3 h-3" /> Back to quotes
                </Link>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="!mb-0">{quote.quoteNumber}</h1>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-600 uppercase tracking-wider">
                    Quote
                  </span>
                  {isExpired && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 uppercase tracking-wider">
                      <AlertTriangle className="w-3 h-3" /> Expired
                    </span>
                  )}
                  {quote.deletedAt && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 uppercase tracking-wider">
                      Deleted
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {types.map((t) => (
                    <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/5 text-muted-foreground">
                      {POLICY_TYPE_LABELS[t] || t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {fileUrl && (
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                    <PillButton variant="secondary">
                      <Download className="w-3 h-3" /> PDF
                    </PillButton>
                  </a>
                )}
                {quote.deletedAt ? (
                  <PillButton
                    variant="secondary"
                    onClick={async () => {
                      await restore({ id: quote._id });
                      toast.success("Quote restored");
                    }}
                  >
                    Restore
                  </PillButton>
                ) : (
                  <PillButton variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                    <Trash2 className="w-3 h-3" />
                  </PillButton>
                )}
              </div>
            </div>
          </FadeIn>

          {/* Info cards */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="rounded-lg border border-foreground/6 bg-white/60 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-muted-foreground/40" />
                  <span className="text-label-sm font-medium text-muted-foreground">Carrier</span>
                </div>
                <p className="text-body-sm font-semibold">{carrier}</p>
                {quote.mga && <p className="text-label-sm text-muted-foreground mt-0.5">MGA: {quote.mga}</p>}
                {quote.broker && <p className="text-label-sm text-muted-foreground mt-0.5">Broker: {quote.broker}</p>}
              </div>

              <div className="rounded-lg border border-foreground/6 bg-white/60 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-muted-foreground/40" />
                  <span className="text-label-sm font-medium text-muted-foreground">Proposed Period</span>
                </div>
                <p className="text-body-sm font-semibold">
                  {quote.proposedEffectiveDate ?? "—"} to {quote.proposedExpirationDate ?? "—"}
                </p>
                {quote.quoteExpirationDate && (
                  <p className={`text-label-sm mt-0.5 ${isExpired ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                    Quote expires: {quote.quoteExpirationDate}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-foreground/6 bg-white/60 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground/40" />
                  <span className="text-label-sm font-medium text-muted-foreground">Premium Indication</span>
                </div>
                <p className="text-body-sm font-semibold font-mono">{quote.premium ?? "—"}</p>
                {quote.isRenewal && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 mt-1">
                    Renewal
                  </span>
                )}
              </div>
            </div>
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
                    <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-foreground/6 bg-white/60">
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm text-foreground">{s.description}</p>
                        {s.category && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mt-1 ${
                            s.category === "pre_binding" ? "bg-red-50 text-red-600" :
                            s.category === "post_binding" ? "bg-amber-50 text-amber-600" :
                            "bg-blue-50 text-blue-600"
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
                    <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-foreground/6 bg-white/60">
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
        </div>
      </main>

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
    </div>
  );
}
