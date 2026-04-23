"use client";

import { useCallback, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";

const EASE = [0.16, 1, 0.3, 1] as const;
const WIDTH = 560;

type Props = {
  open: boolean;
  onClose: () => void;
  clientOrgId: Id<"organizations">;
};

export function CreateApplicationDrawer({ open, onClose, clientOrgId }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<null | "generate" | "pdf">(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createDraft = useMutation((api as any).applications.createDraft);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generateUploadUrl = useMutation((api as any).applications.generateUploadUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startExtraction = useAction((api as any).actions.applicationExtraction.startExtractionFromPdf);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startGeneration = useAction((api as any).actions.applicationExtraction.startGenerationFromPrompt);

  function handleClose() {
    setPrompt("");
    setPdfFile(null);
    setBusy(null);
    onClose();
  }

  function navigateToApp(id: Id<"applications">) {
    router.push(`/clients/${clientOrgId}/applications/${id}`);
    handleClose();
  }

  async function handleGenerate() {
    const p = prompt.trim();
    if (!p) return;
    setBusy("generate");
    try {
      const title = p.length > 60 ? `${p.slice(0, 57)}…` : p;
      const applicationId = (await createDraft({
        clientOrgId,
        title,
        aiGenerationPrompt: p,
      })) as Id<"applications">;

      // Fire-and-forget — generation runs as a background pipeline
      await startGeneration({ applicationId, generationPrompt: p });
      toast.success("Generation started — you can safely navigate away.");
      navigateToApp(applicationId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setBusy(null);
    }
  }

  const handleFileSelect = useCallback((file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file.");
      return;
    }
    setPdfFile(file);
  }, []);

  async function handleUploadPdf(file: File) {
    setBusy("pdf");
    try {
      const title = file.name.replace(/\.pdf$/i, "");
      const applicationId = (await createDraft({
        clientOrgId,
        title,
      })) as Id<"applications">;

      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = await res.json();

      // Await enqueue (fast), then navigate — extraction runs in background
      await startExtraction({ applicationId, fileId: storageId as Id<"_storage"> });
      toast.success("Extraction started — you can safely navigate away.");
      navigateToApp(applicationId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process PDF");
    } finally {
      setBusy(null);
    }
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const disabled = busy !== null;

  return (
    <AnimatePresence mode="popLayout">
      {open && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width: WIDTH }}
          exit={{ width: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full"
        >
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width: WIDTH }}
          >
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate flex-1">
                New application
              </span>
              <button
                type="button"
                onClick={handleClose}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Describe the application</label>
                <textarea
                  placeholder="e.g. CGL application for a roofing contractor in Texas with 15 employees, $2M revenue, and prior claims…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  disabled={disabled}
                  className="w-full resize-none rounded-lg border border-foreground/10 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                />
                <PillButton
                  variant="secondary"
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || disabled}
                >
                  {busy === "generate" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    "Generate Question Set"
                  )}
                </PillButton>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-foreground/8" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-foreground/8" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Upload an existing application PDF
                </label>
                {!pdfFile ? (
                  <div
                    onDrop={onDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => !disabled && fileInputRef.current?.click()}
                    className={`rounded-lg border border-dashed border-foreground/15 bg-muted/20 px-4 py-10 text-center transition-colors ${
                      disabled
                        ? "opacity-50 cursor-not-allowed"
                        : "cursor-pointer hover:bg-muted/30"
                    }`}
                  >
                    <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Drag and drop a PDF, or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      Application forms only
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-muted/20 px-3 py-2">
                      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{pdfFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => setPdfFile(null)}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <PillButton
                      variant="primary"
                      className="w-full"
                      onClick={() => handleUploadPdf(pdfFile)}
                      disabled={disabled}
                    >
                      {busy === "pdf" ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Extracting…
                        </>
                      ) : (
                        "Extract Questions"
                      )}
                    </PillButton>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
