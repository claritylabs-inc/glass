"use client";

import {
  CONFIDENCE_LEVEL_META,
  summarizeConfidence,
  type ConfidenceLevel,
} from "@/lib/confidence";

const LEVEL_ORDER: ConfidenceLevel[] = ["grounded", "inferred", "unverified"];

const DOT_CLASS: Record<ConfidenceLevel, string> = {
  grounded: "bg-emerald-500/70",
  inferred: "bg-amber-500/70",
  unverified: "bg-rose-500/70",
};

/**
 * Legend + overall confidence for an agent answer whose phrases are tinted by
 * source-backing. Renders nothing when the message has no confidence markers.
 */
export function ConfidenceLegend({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const summary = summarizeConfidence(content);
  if (!summary) return null;
  const pct = Math.round(summary.score * 100);

  return (
    <div
      className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground/50 ${className ?? ""}`}
    >
      {LEVEL_ORDER.filter((level) => summary.counts[level] > 0).map((level) => (
        <span key={level} className="inline-flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${DOT_CLASS[level]}`}
            aria-hidden
          />
          {CONFIDENCE_LEVEL_META[level].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-muted-foreground/40">
        <span className="text-muted-foreground/35">Confidence</span>
        <span className="h-1 w-12 overflow-hidden rounded-full bg-foreground/8">
          <span
            className="block h-full rounded-full bg-foreground/40"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="tabular-nums">{pct}%</span>
      </span>
    </div>
  );
}
