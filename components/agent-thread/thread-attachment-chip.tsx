"use client";

import { Loader2, Paperclip } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { cn } from "@/lib/utils";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

type AttachmentChipData = {
  filename: string;
  contentType?: string;
  size?: number;
  fileId?: Id<"_storage">;
};

/* ── Attachment chip for unified thread messages ── */
export function ThreadAttachmentChip({
  attachment,
  threadId,
  className,
  size = "default",
  onOpen,
  isLoading = false,
  disabled = false,
  unavailableTitle,
}: {
  attachment: AttachmentChipData;
  threadId?: Id<"threads">;
  className?: string;
  size?: "default" | "compact";
  onOpen?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  unavailableTitle?: string;
}) {
  const { openWithUrl } = usePdf();
  const url = useCachedQuery(
    "threads.getAttachmentUrl",
    api.threads.getAttachmentUrl,
    threadId && attachment.fileId
      ? { threadId, fileId: attachment.fileId }
      : "skip",
  );
  const isPdf =
    attachment.contentType?.toLowerCase().includes("pdf") ||
    attachment.filename.toLowerCase().endsWith(".pdf");
  const isCompact = size === "compact";
  const handleOpen = onOpen ?? (isPdf && url ? () => openWithUrl(url) : undefined);
  const canOpen = Boolean(handleOpen || url);

  const title = canOpen
    ? attachment.filename
    : (unavailableTitle ?? `${attachment.filename} is not available yet`);
  const classNames = cn(
    "inline-flex min-w-0 items-center rounded-full font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    isCompact
      ? "h-5 gap-1 px-1.5 text-[0.6875rem] leading-4"
      : "h-6 gap-1.5 px-2 text-label",
    canOpen
      ? "cursor-pointer bg-foreground/5 text-foreground/65 hover:bg-foreground/8 hover:text-foreground/80"
      : "pointer-events-none bg-foreground/3 text-muted-foreground/40",
    className,
  );
  const content = (
    <>
      {isLoading ? (
        <Loader2
          className={cn(
            "shrink-0 animate-spin text-muted-foreground",
            isCompact ? "h-2.5 w-2.5" : "h-3 w-3",
          )}
        />
      ) : (
        <Paperclip
          className={cn(
            "shrink-0 text-muted-foreground",
            isCompact ? "h-2.5 w-2.5" : "h-3 w-3",
          )}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
    </>
  );

  if (handleOpen) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled || isLoading}
        title={title}
        aria-label={`${onOpen ? "Preview" : "Open"} ${attachment.filename}`}
        aria-busy={isLoading || undefined}
        style={{ maxWidth: isCompact ? "11rem" : "13rem" }}
        className={classNames}
      >
        {content}
      </button>
    );
  }

  return (
    <a
      href={isPdf ? undefined : (url ?? undefined)}
      target={isPdf ? undefined : "_blank"}
      rel={isPdf ? undefined : "noopener noreferrer"}
      title={title}
      aria-label={url ? `Open ${attachment.filename}` : attachment.filename}
      style={{ maxWidth: isCompact ? "11rem" : "13rem" }}
      className={classNames}
    >
      {content}
    </a>
  );
}
