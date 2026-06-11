"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import {
  remarkConfidence,
  CONFIDENCE_LEVEL_META,
  type ConfidenceLevel,
} from "@/lib/confidence";

/**
 * Shared base styles for markdown-rendered content.
 * Uses Tailwind descendant selectors so they work regardless of
 * which remark plugins are active.
 */
const BASE_STYLES =
  "max-w-none text-base leading-relaxed " +
  "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_strong]:font-semibold " +
  "[&_ul]:my-3 [&_ul]:pl-5 [&_ul]:list-disc " +
  "[&_ol]:my-3 [&_ol]:pl-5 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 " +
  "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 " +
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2.5 [&_h3]:mb-0.5 " +
  "[&_h4]:text-base [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-0.5 " +
  "[&_h5]:text-base [&_h5]:font-semibold " +
  "[&_h6]:text-base [&_h6]:font-semibold " +
  "[&_hr]:my-3 [&_hr]:border-foreground/8 " +
  "[&_code]:text-label [&_code]:bg-foreground/[0.04] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded " +
  "[&_table]:w-full [&_table]:text-label [&_table]:border-collapse " +
  "[&_th]:text-left [&_th]:font-semibold [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:border-b [&_th]:border-foreground/10 [&_th]:bg-foreground/[0.03] [&_th]:whitespace-nowrap [&_th]:text-label [&_th]:text-muted-foreground/60 " +
  "[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-foreground/6 [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0 " +
  "[&_thead]:align-bottom";

/** Compact variant for quoted/reply text */
const COMPACT_STYLES =
  "max-w-none text-base leading-relaxed " +
  "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_strong]:font-semibold " +
  "[&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc " +
  "[&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 " +
  "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-0.5 " +
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-0.5 " +
  "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-1.5 [&_h3]:mb-0.5 " +
  "[&_h4]:text-base [&_h4]:font-semibold [&_h4]:mt-1 [&_h4]:mb-0.5 " +
  "[&_h5]:text-base [&_h5]:font-semibold " +
  "[&_h6]:text-base [&_h6]:font-semibold " +
  "[&_em]:text-base " +
  "[&_hr]:my-2 [&_hr]:border-foreground/8";

export type ProseMarkdownProps = {
  children: string;
  className?: string;
  /** Use compact spacing for quoted/reply content */
  compact?: boolean;
  /** Enable GFM tables (default: false) */
  gfm?: boolean;
  /** Convert soft line-breaks to <br> (default: false) */
  breaks?: boolean;
  /**
   * Render `[[g|i|u:...]]` confidence markers as source-backing tints
   * (default: false). Used for agent chat answers.
   */
  flagConfidence?: boolean;
  /** Extra react-markdown component overrides */
  components?: Components;
};

/** Tailwind tint per confidence level — kept subtle so prose stays readable. */
const CONFIDENCE_TINT: Record<ConfidenceLevel, string> = {
  grounded:
    "bg-emerald-400/12 decoration-emerald-500/40 dark:bg-emerald-400/15",
  inferred: "bg-amber-400/15 decoration-amber-500/45 dark:bg-amber-400/15",
  unverified: "bg-rose-400/18 decoration-rose-500/50 dark:bg-rose-400/20",
};

function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return value === "grounded" || value === "inferred" || value === "unverified";
}

/** Renders a phrase tinted by how well the agent could back it with a source. */
const confidenceComponents: Components = {
  mark: ({ children, ...props }) => {
    const rawLevel = (props as Record<string, unknown>)["data-level"];
    const level: ConfidenceLevel = isConfidenceLevel(rawLevel)
      ? rawLevel
      : "inferred";
    const meta = CONFIDENCE_LEVEL_META[level];
    return (
      <mark
        className={cn(
          "rounded-[3px] px-0.5 text-foreground underline decoration-dotted underline-offset-2",
          CONFIDENCE_TINT[level],
        )}
        title={`${meta.label}: ${meta.description}`}
      >
        {children}
      </mark>
    );
  },
};

/**
 * Unified markdown renderer used across Glass.
 *
 * Handles table styling, heading sizes, list spacing, code blocks, etc.
 * in one place so every surface stays consistent.
 */
/** Default table wrapper — horizontal scroll + rounded border */
const defaultGfmComponents: Components = {
  table: ({ children }) => (
    <div className="overflow-x-auto my-3 rounded-md border border-foreground/6">
      <table className="w-full text-label border-collapse">{children}</table>
    </div>
  ),
};

export function ProseMarkdown({
  children,
  className,
  compact = false,
  gfm = false,
  breaks = false,
  flagConfidence = false,
  components,
}: ProseMarkdownProps) {
  const plugins = [];
  if (gfm) plugins.push(remarkGfm);
  if (breaks) plugins.push(remarkBreaks);
  if (flagConfidence) plugins.push(remarkConfidence);

  // Merge default GFM table component with user overrides
  const mergedComponents = {
    ...(gfm ? defaultGfmComponents : null),
    ...(flagConfidence ? confidenceComponents : null),
    ...components,
  };

  return (
    <div className={cn(compact ? COMPACT_STYLES : BASE_STYLES, "min-w-0 wrap-break-word wrap-anywhere", className)}>
      <Markdown
        remarkPlugins={plugins}
        components={mergedComponents}
      >
        {children}
      </Markdown>
    </div>
  );
}

/** Style-only class strings for cases that need the wrapper div separate from <Markdown>. */
export const PROSE_MARKDOWN_STYLES = BASE_STYLES;
export const PROSE_MARKDOWN_COMPACT_STYLES = COMPACT_STYLES;
