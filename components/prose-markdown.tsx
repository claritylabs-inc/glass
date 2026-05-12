"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import { getPlainTextChildren, PretextText } from "@/components/pretext-text";

/**
 * Shared base styles for markdown-rendered content.
 * Uses Tailwind descendant selectors so they work regardless of
 * which remark plugins are active.
 */
const BASE_STYLES =
  "max-w-none text-body-sm leading-relaxed " +
  "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_strong]:font-semibold " +
  "[&_ul]:my-3 [&_ul]:pl-5 [&_ul]:list-disc " +
  "[&_ol]:my-3 [&_ol]:pl-5 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 " +
  "[&_h1]:text-[0.875rem] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 " +
  "[&_h2]:text-[0.875rem] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-[0.875rem] [&_h3]:font-semibold [&_h3]:mt-2.5 [&_h3]:mb-0.5 " +
  "[&_h4]:text-[0.875rem] [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-0.5 " +
  "[&_h5]:text-[0.875rem] [&_h5]:font-semibold " +
  "[&_h6]:text-[0.875rem] [&_h6]:font-semibold " +
  "[&_hr]:my-3 [&_hr]:border-foreground/8 " +
  "[&_code]:text-[12px] [&_code]:bg-foreground/[0.04] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded " +
  "[&_table]:w-full [&_table]:text-label [&_table]:border-collapse " +
  "[&_th]:text-left [&_th]:font-semibold [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:border-b [&_th]:border-foreground/10 [&_th]:bg-foreground/[0.03] [&_th]:whitespace-nowrap [&_th]:text-label-sm [&_th]:text-muted-foreground/60 " +
  "[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-foreground/6 [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0 " +
  "[&_thead]:align-bottom";

/** Compact variant for quoted/reply text */
const COMPACT_STYLES =
  "max-w-none text-body-sm leading-relaxed " +
  "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_strong]:font-semibold " +
  "[&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc " +
  "[&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 " +
  "[&_h1]:text-[0.875rem] [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-0.5 " +
  "[&_h2]:text-[0.875rem] [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-0.5 " +
  "[&_h3]:text-[0.875rem] [&_h3]:font-semibold [&_h3]:mt-1.5 [&_h3]:mb-0.5 " +
  "[&_h4]:text-[0.875rem] [&_h4]:font-semibold [&_h4]:mt-1 [&_h4]:mb-0.5 " +
  "[&_h5]:text-[0.875rem] [&_h5]:font-semibold " +
  "[&_h6]:text-[0.875rem] [&_h6]:font-semibold " +
  "[&_em]:text-body-sm " +
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
  /** Extra react-markdown component overrides */
  components?: Components;
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

const pretextComponents: Components = {
  p: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) {
      return <PretextText as="p" text={text} />;
    }
    return <p className="pretext-flow">{children}</p>;
  },
  li: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) {
      return (
        <li>
          <PretextText text={text} />
        </li>
      );
    }
    return <li className="pretext-flow">{children}</li>;
  },
  h1: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) return <PretextText as="h1" text={text} />;
    return <h1 className="pretext-flow">{children}</h1>;
  },
  h2: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) return <PretextText as="h2" text={text} />;
    return <h2 className="pretext-flow">{children}</h2>;
  },
  h3: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) return <PretextText as="h3" text={text} />;
    return <h3 className="pretext-flow">{children}</h3>;
  },
  h4: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) return <PretextText as="h4" text={text} />;
    return <h4 className="pretext-flow">{children}</h4>;
  },
  h5: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) return <PretextText as="h5" text={text} />;
    return <h5 className="pretext-flow">{children}</h5>;
  },
  h6: ({ children }) => {
    const text = getPlainTextChildren(children);
    if (text !== null) return <PretextText as="h6" text={text} />;
    return <h6 className="pretext-flow">{children}</h6>;
  },
};

export function ProseMarkdown({
  children,
  className,
  compact = false,
  gfm = false,
  breaks = false,
  components,
}: ProseMarkdownProps) {
  const plugins = [];
  if (gfm) plugins.push(remarkGfm);
  if (breaks) plugins.push(remarkBreaks);

  // Merge default GFM table component with user overrides
  const mergedComponents = {
    ...pretextComponents,
    ...(gfm ? defaultGfmComponents : null),
    ...components,
  };

  return (
    <div className={cn(compact ? COMPACT_STYLES : BASE_STYLES, "pretext-flow", className)}>
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
