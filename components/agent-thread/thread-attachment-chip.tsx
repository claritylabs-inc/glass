"use client";

import { type MouseEvent } from "react";
import { Paperclip } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { cn } from "@/lib/utils";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import type { ThreadAttachment } from "./types";

/* ── Attachment chip for unified thread messages ── */
export function ThreadAttachmentChip({
  attachment,
  threadId,
  className,
}: {
  attachment: ThreadAttachment;
  threadId: Id<"threads">;
  className?: string;
}) {
  const { openWithUrl } = usePdf();
  const url = useCachedQuery(
    "threads.getAttachmentUrl",
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
      title={
        url
          ? attachment.filename
          : `${attachment.filename} is not available yet`
      }
      aria-label={url ? `Open ${attachment.filename}` : attachment.filename}
      style={{ maxWidth: "13rem" }}
      className={cn(
        "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full px-2 text-label font-medium transition-colors",
        url
          ? "bg-foreground/5 text-foreground/75 hover:bg-foreground/8"
          : "pointer-events-none bg-foreground/3 text-muted-foreground/40",
        className,
      )}
    >
      <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
    </a>
  );
}
