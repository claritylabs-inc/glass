"use client";

import { type MouseEvent } from "react";
import { useQuery } from "convex/react";
import { FileText, Paperclip, Download } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import type { ThreadAttachment } from "./types";

/* ── Attachment chip for unified thread messages ── */
export function ThreadAttachmentChip({
  attachment,
  threadId,
}: {
  attachment: ThreadAttachment;
  threadId: Id<"threads">;
}) {
  const { openWithUrl } = usePdf();
  const url = useQuery(
    api.threads.getAttachmentUrl,
    attachment.fileId ? { threadId, fileId: attachment.fileId } : "skip",
  );
  const isPdf = attachment.contentType === "application/pdf";

  const handleClick = (e: MouseEvent) => {
    if (isPdf && url) {
      e.preventDefault();
      openWithUrl(url);
    }
  };

  return (
    <a
      href={isPdf ? undefined : (url ?? undefined)}
      target={isPdf ? undefined : "_blank"}
      rel={isPdf ? undefined : "noopener noreferrer"}
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-label-sm transition-colors ${
        url
          ? "border-foreground/10 bg-card hover:bg-foreground/[0.03] hover:border-foreground/15"
          : "border-foreground/6 bg-foreground/[0.02] text-muted-foreground/40 pointer-events-none"
      }`}
    >
      {isPdf ? (
        <FileText className="w-3.5 h-3.5 text-red-400 shrink-0" />
      ) : (
        <Paperclip className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
      )}
      <span className="truncate max-w-[180px] text-foreground/80">{attachment.filename}</span>
      {url && !isPdf && <Download className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
    </a>
  );
}
