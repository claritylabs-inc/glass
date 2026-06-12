"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, CornerUpRight, FileUp, FileText, X } from "lucide-react";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  PolicyUploadModeToggle,
  type PolicyUploadMode,
} from "@/components/policy-upload-mode-toggle";

export interface PolicyEmptyStateProps {
  /** "policy" or "quote" — controls copy only. */
  docType: "policy" | "quote";
  /** Optional agent email to show in the forward card. Card is hidden if absent. */
  agentEmail?: string | null;
  /** Upload-in-flight flag. */
  uploading: boolean;
  /** Called when the user presses Upload with 1+ staged files. */
  onUpload: (files: File[], mode: PolicyUploadMode) => void;
  /** Override the default title/subtitle if needed. */
  title?: string;
  subtitle?: string;
  /** When true, render without the outer card wrapper. Use in auth/onboarding layouts. */
  bare?: boolean;
  /** Optional controlled staged-files state. Pair with `onStagedChange`. */
  staged?: File[];
  /** Called when the staged-files list changes (controlled mode). */
  onStagedChange?: (files: File[]) => void;
  /** Optional controlled import mode. Pair with `onUploadModeChange`. */
  uploadMode?: PolicyUploadMode;
  /** Called when the import mode changes. */
  onUploadModeChange?: (mode: PolicyUploadMode) => void;
  /** When true, hide the internal "Upload" button so the parent can drive uploading. */
  hideUploadButton?: boolean;
}

export function PolicyEmptyState({
  docType,
  agentEmail,
  uploading,
  onUpload,
  title,
  subtitle,
  bare = false,
  staged,
  onStagedChange,
  uploadMode,
  onUploadModeChange,
  hideUploadButton = false,
}: PolicyEmptyStateProps) {
  const plural = docType === "quote" ? "quotes" : "policies";
  const heading = title === "" ? null : (title ?? `No ${plural} yet`);
  const sub =
    subtitle === ""
      ? null
      : (subtitle ??
        `Email it in or drop a PDF — Glass sets it up for you, no forms to fill.`);
  const hasHeader = heading || sub;

  const content = (
    <>
      {heading ? (
        <h3 className="text-base font-semibold text-foreground">{heading}</h3>
      ) : null}
      {sub ? (
        <p className="text-base text-muted-foreground mt-1">{sub}</p>
      ) : null}

      {agentEmail ? (
        <AgentForwardCard email={agentEmail} className={hasHeader ? "mt-5" : ""} />
      ) : null}

      <DropZone
        docType={docType}
        uploading={uploading}
        onUpload={onUpload}
        className={agentEmail ? "mt-3" : hasHeader ? "mt-5" : ""}
        staged={staged}
        onStagedChange={onStagedChange}
        uploadMode={uploadMode}
        onUploadModeChange={onUploadModeChange}
        hideUploadButton={hideUploadButton}
      />
    </>
  );

  if (bare) {
    return <div>{content}</div>;
  }

  return (
    <OperationalPanel as="div" className="p-5 sm:p-6">
      {content}
    </OperationalPanel>
  );
}

function AgentForwardCard({
  email,
  className,
}: {
  email: string;
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
      className={`rounded-lg border border-foreground/6 bg-foreground/2 px-4 py-3 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-8 w-8 rounded-full bg-foreground/4 flex items-center justify-center shrink-0">
          <CornerUpRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-foreground">
            Email or forward to your agent
          </div>
          <div className="text-base text-muted-foreground truncate mt-0.5">
            {email}
          </div>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/4 transition-colors"
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
  staged: stagedProp,
  onStagedChange,
  uploadMode: uploadModeProp,
  onUploadModeChange,
  hideUploadButton = false,
}: {
  docType: "policy" | "quote";
  uploading: boolean;
  onUpload: (files: File[], mode: PolicyUploadMode) => void;
  className?: string;
  staged?: File[];
  onStagedChange?: (files: File[]) => void;
  uploadMode?: PolicyUploadMode;
  onUploadModeChange?: (mode: PolicyUploadMode) => void;
  hideUploadButton?: boolean;
}) {
  const label = docType === "quote" ? "quote" : "policy";
  const pluralLabel = docType === "quote" ? "quotes" : "policies";
  const [dragOver, setDragOver] = useState(false);
  const [internalUploadMode, setInternalUploadMode] =
    useState<PolicyUploadMode>("combined");
  const [internalStaged, setInternalStaged] = useState<File[]>([]);
  const isControlled = stagedProp !== undefined;
  const staged = isControlled ? stagedProp : internalStaged;
  const uploadMode = uploadModeProp ?? internalUploadMode;
  const inputRef = useRef<HTMLInputElement>(null);

  const updateStaged = useCallback(
    (next: File[]) => {
      if (isControlled) {
        onStagedChange?.(next);
      } else {
        setInternalStaged(next);
        onStagedChange?.(next);
      }
    },
    [isControlled, onStagedChange],
  );

  const updateUploadMode = useCallback(
    (next: PolicyUploadMode) => {
      if (uploadModeProp === undefined) {
        setInternalUploadMode(next);
      }
      onUploadModeChange?.(next);
    },
    [uploadModeProp, onUploadModeChange],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
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
      const existing = new Set(staged.map((f) => `${f.name}:${f.size}`));
      const next = [
        ...staged,
        ...pdfs.filter((f) => !existing.has(`${f.name}:${f.size}`)),
      ];
      updateStaged(next);
    },
    [staged, updateStaged],
  );

  const removeAt = useCallback(
    (i: number) => {
      updateStaged(staged.filter((_, idx) => idx !== i));
    },
    [staged, updateStaged],
  );

  const handleUpload = useCallback(() => {
    if (staged.length === 0) return;
    onUpload(staged, uploadMode);
    updateStaged([]);
    updateUploadMode("combined");
  }, [staged, uploadMode, onUpload, updateStaged, updateUploadMode]);

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
        className={`w-full rounded-lg border-2 border-dashed transition-colors px-6 py-12 text-center ${
          dragOver
            ? "border-foreground/25 bg-foreground/3"
            : "border-foreground/10 hover:border-foreground/20"
        }`}
      >
        <div className="mx-auto h-10 w-10 flex items-center justify-center rounded-full bg-foreground/4 text-muted-foreground mb-3">
          <FileUp className="h-4.5 w-4.5" />
        </div>
        <p className="text-base font-semibold text-foreground">
          Drag and drop {label} PDFs
        </p>
        <p className="text-base text-muted-foreground mt-1">
          {staged.length > 0
            ? "or click to add more files"
            : "or click to choose files"}
        </p>
        <p className="text-base text-muted-foreground/60 mt-3">
          {uploadMode === "separate"
            ? `Multiple PDFs will create separate ${pluralLabel}.`
            : `Multiple PDFs will be combined into a single ${label}.`}
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

      {staged.length > 1 ? (
        <PolicyUploadModeToggle
          value={uploadMode}
          onChange={updateUploadMode}
          docType={docType}
          disabled={uploading}
        />
      ) : null}

      {staged.length > 0 ? (
        <div className="rounded-lg border border-foreground/6 bg-white overflow-hidden">
          {staged.map((file, i) => (
            <div
              key={`${file.name}:${file.size}:${i}`}
              className="flex items-center gap-2 px-3 py-2 border-t border-foreground/4 first:border-t-0"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-base truncate flex-1">{file.name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={uploading}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Remove ${file.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {staged.length > 0 && !hideUploadButton ? (
        <PillButton
          variant="primary"
          className="w-full sm:w-fit"
          disabled={uploading}
          onClick={handleUpload}
        >
          {uploading
            ? "Uploading…"
            : staged.length > 1 && uploadMode === "separate"
              ? `Upload as ${staged.length} ${pluralLabel}`
              : staged.length > 1
                ? `Upload as one ${label}`
                : `Upload ${label}`}
        </PillButton>
      ) : null}
    </div>
  );
}
