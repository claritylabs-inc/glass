"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf } from "@/components/pdf-context";
import { X, ExternalLink, FileText, Calendar, DollarSign, Shield, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import dayjs from "dayjs";
import Link from "next/link";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";

const EASE = [0.16, 1, 0.3, 1] as const;

function PolicyPreview({ id, page }: { id: string; page?: number }) {
  const policy = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId } : "skip",
  );
  const { openWithUrl } = usePdf();
  const { closePreview } = useEntityPreview();

  if (!policy) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const carrier = policy.carrier ?? "Unknown carrier";
  const policyNum = policy.policyNumber;
  const types = policy.policyTypes ?? (policy.policyType ? [policy.policyType] : []);
  const isQuoteDoc = policy.documentType === "quote";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1">
          {isQuoteDoc ? "Quote" : "Policy"}
        </p>
        <h3 className="text-sm font-semibold text-foreground">{carrier}</h3>
        {policyNum && (
          <p className="text-body-sm text-muted-foreground/60 font-mono mt-0.5">{policyNum}</p>
        )}
      </div>

      {/* Types */}
      {types.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => (
            <span
              key={t}
              className="text-[11px] px-2 py-0.5 rounded-full bg-foreground/[0.04] text-muted-foreground/60 font-medium"
            >
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
        </div>
      )}

      {/* Key details */}
      <div className="space-y-2.5">
        {(policy.effectiveDate || policy.expirationDate) && (
          <div className="flex items-start gap-2.5">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
            <div className="text-body-sm">
              <p className="text-muted-foreground/50 text-[11px] font-medium">Period</p>
              <p className="text-foreground">
                {policy.effectiveDate ? dayjs(policy.effectiveDate).format("MMM D, YYYY") : "—"}
                {" — "}
                {policy.expirationDate ? dayjs(policy.expirationDate).format("MMM D, YYYY") : "—"}
              </p>
            </div>
          </div>
        )}

        {policy.premium && (
          <div className="flex items-start gap-2.5">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
            <div className="text-body-sm">
              <p className="text-muted-foreground/50 text-[11px] font-medium">Premium</p>
              <p className="text-foreground">{policy.premium}</p>
            </div>
          </div>
        )}

        {policy.insuredName && (
          <div className="flex items-start gap-2.5">
            <Shield className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
            <div className="text-body-sm">
              <p className="text-muted-foreground/50 text-[11px] font-medium">Insured</p>
              <p className="text-foreground">{policy.insuredName}</p>
            </div>
          </div>
        )}
      </div>

      {/* Coverages summary */}
      {policy.coverages && policy.coverages.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
            Coverages
          </p>
          <div className="space-y-1.5">
            {policy.coverages.slice(0, 5).map((cov, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-body-sm py-1 px-2.5 rounded-md bg-foreground/[0.02]"
              >
                <span className="text-foreground truncate mr-3">{cov.name}</span>
                <span className="text-muted-foreground/60 shrink-0 font-mono text-[11px]">
                  {cov.limit}
                </span>
              </div>
            ))}
            {policy.coverages.length > 5 && (
              <p className="text-[11px] text-muted-foreground/40 pl-2.5">
                +{policy.coverages.length - 5} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {policy.summary && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1">
            Summary
          </p>
          <p className="text-body-sm text-muted-foreground/70 leading-relaxed">{policy.summary}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {fileUrl && (
          <button
            type="button"
            onClick={() => {
              openWithUrl(fileUrl, page);
              closePreview();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-body-sm font-medium cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
            View PDF
          </button>
        )}
        <Link
          href={`/policies/${id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-body-sm font-medium no-underline"
        >
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50" />
          Full details
        </Link>
      </div>
    </div>
  );
}

function QuotePreview({ id, page }: { id: string; page?: number }) {
  const quote = useQuery(api.policies.get, { id: id as Id<"policies"> });
  const fileUrl = useQuery(
    api.policies.getFileUrl,
    quote?.fileId ? { fileId: quote.fileId } : "skip",
  );
  const { openWithUrl } = usePdf();
  const { closePreview } = useEntityPreview();

  if (!quote) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const carrier = quote.carrier ?? "Unknown carrier";
  const quoteNum = (quote as any).quoteNumber ?? quote.policyNumber;
  const types = quote.policyTypes ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1">
          Quote
        </p>
        <h3 className="text-sm font-semibold text-foreground">{carrier}</h3>
        {quoteNum && (
          <p className="text-body-sm text-muted-foreground/60 font-mono mt-0.5">{quoteNum}</p>
        )}
      </div>

      {/* Types */}
      {types.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => (
            <span
              key={t}
              className="text-[11px] px-2 py-0.5 rounded-full bg-foreground/[0.04] text-muted-foreground/60 font-medium"
            >
              {POLICY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
        </div>
      )}

      {/* Key details */}
      <div className="space-y-2.5">
        {((quote as any).proposedEffectiveDate || (quote as any).proposedExpirationDate) && (
          <div className="flex items-start gap-2.5">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
            <div className="text-body-sm">
              <p className="text-muted-foreground/50 text-[11px] font-medium">Proposed period</p>
              <p className="text-foreground">
                {(quote as any).proposedEffectiveDate ? dayjs((quote as any).proposedEffectiveDate).format("MMM D, YYYY") : "—"}
                {" — "}
                {(quote as any).proposedExpirationDate ? dayjs((quote as any).proposedExpirationDate).format("MMM D, YYYY") : "—"}
              </p>
            </div>
          </div>
        )}

        {quote.premium && (
          <div className="flex items-start gap-2.5">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
            <div className="text-body-sm">
              <p className="text-muted-foreground/50 text-[11px] font-medium">Premium</p>
              <p className="text-foreground">{quote.premium}</p>
            </div>
          </div>
        )}

        {quote.insuredName && (
          <div className="flex items-start gap-2.5">
            <Shield className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
            <div className="text-body-sm">
              <p className="text-muted-foreground/50 text-[11px] font-medium">Insured</p>
              <p className="text-foreground">{quote.insuredName}</p>
            </div>
          </div>
        )}
      </div>

      {/* Coverages summary */}
      {quote.coverages && quote.coverages.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
            Coverages
          </p>
          <div className="space-y-1.5">
            {quote.coverages.slice(0, 5).map((cov: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between text-body-sm py-1 px-2.5 rounded-md bg-foreground/[0.02]"
              >
                <span className="text-foreground truncate mr-3">{cov.name}</span>
                <span className="text-muted-foreground/60 shrink-0 font-mono text-[11px]">
                  {cov.proposedLimit ?? cov.limit}
                </span>
              </div>
            ))}
            {quote.coverages.length > 5 && (
              <p className="text-[11px] text-muted-foreground/40 pl-2.5">
                +{quote.coverages.length - 5} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {quote.summary && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1">
            Summary
          </p>
          <p className="text-body-sm text-muted-foreground/70 leading-relaxed">{quote.summary}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {fileUrl && (
          <button
            type="button"
            onClick={() => {
              openWithUrl(fileUrl, page);
              closePreview();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-body-sm font-medium cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
            View PDF
          </button>
        )}
        <Link
          href={`/policies/${id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-foreground/8 bg-white/80 dark:bg-white/[0.06] hover:bg-foreground/[0.03] transition-colors text-body-sm font-medium no-underline"
        >
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50" />
          Full details
        </Link>
      </div>
    </div>
  );
}

export function EntityPreviewPanel() {
  const { preview, closePreview } = useEntityPreview();

  return (
    <AnimatePresence mode="popLayout">
      {preview && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width: 380 }}
          exit={{ width: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full"
        >
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width: 380 }}
          >
            {/* Toolbar */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground">
                {preview.type === "policy" ? "Policy" : "Quote"} Preview
              </span>
              <button
                type="button"
                onClick={closePreview}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {preview.type === "policy" && (
                <PolicyPreview id={preview.id} page={preview.page} />
              )}
              {preview.type === "quote" && (
                <QuotePreview id={preview.id} page={preview.page} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
