"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileText, FileUp } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";

export type DocumentType = "policy" | "quote";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1.5";

interface PolicyUploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUpload: (files: File[], documentType: DocumentType, note: string) => Promise<void>;
  uploading: boolean;
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
}: PolicyUploadDrawerProps) {
  const [documentType, setDocumentType] = useState<DocumentType>("policy");
  const [note, setNote] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsDraggingState(true);
      const startX = e.clientX;
      const startWidth = width;

      const onMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const delta = startX - ev.clientX;
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
      };
      const onUp = () => {
        isDragging.current = false;
        setIsDraggingState(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [width],
  );

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
    await onUpload(files, documentType, note);
    setFiles([]);
    setNote("");
    onClose();
  }, [files, documentType, note, onUpload, onClose]);

  const typeLabel = documentType === "quote" ? "quote" : "policy";
  const canUpload = files.length > 0 && !uploading;

  return (
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width }}
          exit={{ width: 0 }}
          transition={
            isDraggingState ? { duration: 0 } : { duration: 0.4, ease: EASE }
          }
          className="flex shrink-0 overflow-hidden h-full relative"
        >
          <div
            onPointerDown={onPointerDown}
            className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12 transition-colors"
          />

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width }}
          >
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                Upload {typeLabel}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Drop zone */}
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

              {/* Staged files */}
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
                        <span className="text-body-sm truncate flex-1">{file.name}</span>
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

              {/* Type segmented picker */}
              <div>
                <label className={LABEL_CLASSES}>Document type</label>
                <div className="inline-flex items-center rounded-lg border border-foreground/8 bg-popover p-0.5 gap-0.5">
                  {(["policy", "quote"] as const).map((t) => {
                    const selected = documentType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setDocumentType(t)}
                        className={`px-3 py-1.5 rounded-md text-body-sm transition-colors cursor-pointer ${
                          selected
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]"
                        }`}
                      >
                        {t === "policy" ? "Policy" : "Quote"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Note */}
              <div>
                <label className={LABEL_CLASSES}>
                  Note <span className="text-muted-foreground/60 font-normal">(optional)</span>
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Add context for the client…"
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors resize-y min-h-20"
                />
              </div>
            </div>

            <div className="border-t border-foreground/6 px-5 py-4 shrink-0">
              <PillButton
                variant="primary"
                className="w-full"
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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
