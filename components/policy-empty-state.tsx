"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, CornerUpRight, FileUp, FileText, X } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";

export interface PolicyEmptyStateProps {
  /** "policy" or "quote" — controls copy only. */
  docType: "policy" | "quote";
  /** Optional agent email to show in the forward card. Card is hidden if absent. */
  agentEmail?: string | null;
  /** Upload-in-flight flag. */
  uploading: boolean;
  /** Called when the user presses Upload with 1+ staged files. */
  onUpload: (files: File[]) => void;
  /** Override the default title/subtitle if needed. */
  title?: string;
  subtitle?: string;
}

export function PolicyEmptyState({
  docType,
  agentEmail,
  uploading,
  onUpload,
  title,
  subtitle,
}: PolicyEmptyStateProps) {
  const label = docType === "quote" ? "quote" : "policy";
  const plural = docType === "quote" ? "quotes" : "policies";
  const heading = title ?? `No ${plural} yet`;
  const sub =
    subtitle ??
    `Email it in or drop a PDF — Glass sets it up for you, no forms to fill.`;

  return (
    <div className="rounded-lg border border-foreground/6 bg-card p-5 sm:p-6">
      <h3 className="text-base font-semibold text-foreground">{heading}</h3>
      <p className="text-body-sm text-muted-foreground mt-1">{sub}</p>

      {agentEmail ? (
        <AgentForwardCard email={agentEmail} label={label} className="mt-5" />
      ) : null}

      <DropZone
        docType={docType}
        uploading={uploading}
        onUpload={onUpload}
        className={agentEmail ? "mt-3" : "mt-5"}
      />
    </div>
  );
}

function AgentForwardCard({
  email,
  label,
  className,
}: {
  email: string;
  label: string;
  className?: string;
}) {
  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(email)
      .then(() => toast.success("Copied to clipboard"))
      .catch(() => toast.error("Couldn't copy to clipboard"));
  }, [email]);

  return (
    <div
      className={`rounded-lg border border-foreground/6 bg-foreground/[0.02] px-4 py-3 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-8 w-8 rounded-full bg-foreground/[0.04] flex items-center justify-center shrink-0">
          <CornerUpRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-body-sm font-medium text-foreground">
              Email or forward to your agent
            </span>
            <span className="text-body-sm text-muted-foreground truncate">
              {email}
            </span>
          </div>
          <p className="text-label-sm text-muted-foreground mt-1">
            Forward any {label} email with attachments and Glass will extract it
            automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer"
          aria-label="Copy email"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DropZone({
  docType,
  uploading,
  onUpload,
  className,
}: {
  docType: "policy" | "quote";
  uploading: boolean;
  onUpload: (files: File[]) => void;
  className?: string;
}) {
  const label = docType === "quote" ? "quote" : "policy";
  const [dragOver, setDragOver] = useState(false);
  const [staged, setStaged] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const pdfs: File[] = [];
    let rejected = 0;
    for (const f of incoming) {
      if (f.name.toLowerCase().endsWith(".pdf")) pdfs.push(f);
      else rejected++;
    }
    if (rejected > 0) {
      toast.error(
        rejected === 1
          ? "Skipped a non-PDF file."
          : `Skipped ${rejected} non-PDF files.`,
      );
    }
    if (pdfs.length === 0) return;
    setStaged((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [
        ...prev,
        ...pdfs.filter((f) => !existing.has(`${f.name}:${f.size}`)),
      ];
    });
  }, []);

  const removeAt = useCallback((i: number) => {
    setStaged((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const handleUpload = useCallback(() => {
    if (staged.length === 0) return;
    onUpload(staged);
    setStaged([]);
  }, [staged, onUpload]);

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files);
          if (dropped.length > 0) addFiles(dropped);
        }}
        className={`w-full rounded-lg border-2 border-dashed transition-colors px-6 py-12 text-center cursor-pointer ${
          dragOver
            ? "border-foreground/25 bg-foreground/[0.03]"
            : "border-foreground/10 hover:border-foreground/20"
        }`}
      >
        <div className="mx-auto h-10 w-10 flex items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground mb-3">
          <FileUp className="h-4.5 w-4.5" />
        </div>
        <p className="text-base font-semibold text-foreground">
          Drag and drop a {label} PDF
        </p>
        <p className="text-body-sm text-muted-foreground mt-1">
          or click to choose {staged.length > 0 ? "more" : "a"} file
        </p>
        <p className="text-label-sm text-muted-foreground/60 mt-3">
          Multiple PDFs will be combined into a single {label}.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) addFiles(picked);
            e.target.value = "";
          }}
        />
      </button>

      {staged.length > 0 ? (
        <div className="rounded-lg border border-foreground/6 bg-background overflow-hidden">
          {staged.map((file, i) => (
            <div
              key={`${file.name}:${file.size}:${i}`}
              className="flex items-center gap-2 px-3 py-2 border-t border-foreground/4 first:border-t-0"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-body-sm truncate flex-1">{file.name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={uploading}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Remove ${file.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {staged.length > 0 ? (
        <PillButton
          variant="primary"
          className="w-full"
          disabled={uploading}
          onClick={handleUpload}
        >
          {uploading
            ? "Uploading…"
            : staged.length > 1
              ? `Upload ${staged.length} files`
              : "Upload"}
        </PillButton>
      ) : null}
    </div>
  );
}
