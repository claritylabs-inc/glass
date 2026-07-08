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
  size = "default",
}: {
  attachment: ThreadAttachment;
  threadId: Id<"threads">;
  className?: string;
  size?: "default" | "compact";
}) {
  const { openWithUrl } = usePdf();
  const url = useCachedQuery(
    "threads.getAttachmentUrl",
    api.threads.getAttachmentUrl,
    attachment.fileId ? { threadId, fileId: attachment.fileId } : "skip",
  );
  const isPdf = attachment.contentType === "application/pdf";
  const isCompact = size === "compact";

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
      style={{ maxWidth: isCompact ? "11rem" : "13rem" }}
      className={cn(
        "inline-flex min-w-0 items-center rounded-full font-medium transition-colors",
        isCompact
          ? "h-5 gap-1 px-1.5 text-[0.6875rem] leading-4"
          : "h-6 gap-1.5 px-2 text-label",
        url
          ? "cursor-pointer bg-foreground/5 text-foreground/65 hover:bg-foreground/8 hover:text-foreground/80"
          : "pointer-events-none bg-foreground/3 text-muted-foreground/40",
        className,
      )}
    >
      <Paperclip
        className={cn(
          "shrink-0 text-muted-foreground",
          isCompact ? "h-2.5 w-2.5" : "h-3 w-3",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
    </a>
  );
}
