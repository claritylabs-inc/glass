"use client";

import { useCallback, useRef, useState } from "react";
import { X, FileText, FileUp } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";

export type DocumentType = "policy" | "quote";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1.5";

interface PolicyUploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUpload: (files: File[]) => Promise<void>;
  uploading: boolean;
  /** Drives the drawer title + copy only — actual type is inferred during extraction. */
  docType?: DocumentType;
}

function filterPdfs(incoming: File[]): File[] {
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
  return pdfs;
}

export function PolicyUploadDrawer({
  open,
  onClose,
  onUpload,
  uploading,
  docType = "policy",
}: PolicyUploadDrawerProps) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const pdfs = filterPdfs(incoming);
    if (pdfs.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [
        ...prev,
        ...pdfs.filter((f) => !existing.has(`${f.name}:${f.size}`)),
      ];
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUploadClick = useCallback(async () => {
    if (files.length === 0) {
      fileInputRef.current?.click();
      return;
    }
    await onUpload(files);
    setFiles([]);
    onClose();
  }, [files, onUpload, onClose]);

  const typeLabel = docType === "quote" ? "quote" : "policy";
  const canUpload = files.length > 0 && !uploading;

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title={`Upload ${typeLabel}`}
      footer={
        <PillButton
          variant="primary"
          disabled={!canUpload}
          onClick={handleUploadClick}
        >
          {uploading
            ? "Uploading…"
            : files.length > 1
              ? `Upload ${files.length} files`
              : files.length === 1
                ? "Upload"
                : "Choose files to upload"}
        </PillButton>
      }
    >
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
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
          className={`w-full rounded-lg border-2 border-dashed transition-colors px-6 py-10 text-center cursor-pointer ${
            dragOver
              ? "border-foreground/25 bg-foreground/[0.03]"
              : "border-foreground/10 hover:border-foreground/20"
          }`}
        >
          <div className="mx-auto h-10 w-10 flex items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground mb-3">
            <FileUp className="h-4 w-4" />
          </div>
          <p className="text-base font-semibold text-foreground">
            Drag and drop a {typeLabel} PDF
          </p>
          <p className="text-body-sm text-muted-foreground mt-1">
            or click to choose {files.length > 0 ? "more" : "a"} file
          </p>
          <p className="text-label-sm text-muted-foreground/60 mt-3">
            Multiple PDFs will be combined into a single {typeLabel}.
          </p>
          <input
            ref={fileInputRef}
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

        {files.length > 0 ? (
          <div>
            <label className={LABEL_CLASSES}>
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </label>
            <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
              {files.map((file, i) => (
                <div
                  key={`${file.name}:${file.size}:${i}`}
                  className="flex items-center gap-2 px-3 py-2 border-t border-foreground/4 first:border-t-0"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-body-sm truncate flex-1">
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    disabled={uploading}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}
