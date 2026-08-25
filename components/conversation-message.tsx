"use client";

import { ProseMarkdown, PROSE_MARKDOWN_COMPACT_STYLES } from "@/components/prose-markdown";
import { typeStyle } from "@/lib/typography";

const QUOTED_MARKDOWN_STYLES = PROSE_MARKDOWN_COMPACT_STYLES + " [&_a]:text-blue-500/60 [&_a]:underline";

export function QuotedContent({ text }: { text: string }) {
  return (
    <div className={`text-muted-foreground/50 mt-3 border-l-2 border-input pl-3 ${typeStyle("body.default")} ${QUOTED_MARKDOWN_STYLES}`}>
      <ProseMarkdown compact>{text}</ProseMarkdown>
    </div>
  );
}
