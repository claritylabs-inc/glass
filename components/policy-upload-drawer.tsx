"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";

export type DocumentType = "policy" | "quote" | "application";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1";

const TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: "policy", label: "Policy" },
  { value: "quote", label: "Quote" },
  { value: "application", label: "Application form" },
];

interface PolicyUploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUpload: (
    file: File,
    documentType: DocumentType,
    note: string,
  ) => Promise<void>;
  uploading: boolean;
  showApplicationOption?: boolean;
}

export function PolicyUploadDrawer({
  open,
  onClose,
  onUpload,
  uploading,
  showApplicationOption = false,
}: PolicyUploadDrawerProps) {
  const [documentType, setDocumentType] = useState<DocumentType>("policy");
  const [note, setNote] = useState("");
  const [dragOver, setDragOver] = useState(false);

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

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("Please upload a PDF file.");
        return;
      }
      await onUpload(file, documentType, note);
      setNote("");
      onClose();
    },
    [documentType, note, onUpload, onClose],
  );

  const types = showApplicationOption
    ? TYPE_OPTIONS
    : TYPE_OPTIONS.filter((t) => t.value !== "application");

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
                Upload policy / quote
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

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-foreground/12"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
              >
                <p className="text-body-sm text-muted-foreground mb-3">
                  Drop a PDF here or
                </p>
                <PillButton
                  variant="secondary"
                  size="compact"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Browse files
                </PillButton>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
              </div>

              <div>
                <span className={LABEL_CLASSES}>Document type</span>
                <div className="flex flex-col gap-2">
                  {types.map((t) => (
                    <label
                      key={t.value}
                      className="flex items-center gap-2 text-body-sm cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="doc-type"
                        value={t.value}
                        checked={documentType === t.value}
                        onChange={() => setDocumentType(t.value)}
                        className="accent-primary"
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="note" className={LABEL_CLASSES}>
                  Note{" "}
                  <span className="text-muted-foreground/60 font-normal">
                    (optional)
                  </span>
                </label>
                <textarea
                  id="note"
                  placeholder="Add context for the client…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className={INPUT_CLASSES}
                />
              </div>

              <PillButton
                variant="primary"
                className="w-full"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload"}
              </PillButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
