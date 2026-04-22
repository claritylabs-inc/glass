"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { EditorCustom } from "./editor-custom";
import { EditorAi } from "./editor-ai";
import { EditorTemplate } from "./editor-template";

type CreationPath = "custom" | "ai" | "template";

const EASE = [0.16, 1, 0.3, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1";

const PATH_OPTIONS = [
  {
    path: "custom" as const,
    label: "Build manually",
    desc: "Pick questions from the catalog or write your own.",
  },
  {
    path: "ai" as const,
    label: "Generate with AI",
    desc: "Describe the risk and let Glass generate the question set.",
  },
  {
    path: "template" as const,
    label: "Use a template",
    desc: "Start from a saved template (e.g. ACORD 126 CGL).",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
  clientOrgId: Id<"organizations">;
};

export function CreateApplicationDrawer({ open, onClose, clientOrgId }: Props) {
  const [step, setStep] = useState<"choose" | "name" | "build">("choose");
  const [path, setPath] = useState<CreationPath>("custom");
  const [title, setTitle] = useState("");
  const [applicationId, setApplicationId] =
    useState<Id<"applications"> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createDraft = useMutation((api as any).applications.createDraft);
  const router = useRouter();

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);

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

  async function handleNameSubmit() {
    if (!title.trim()) return;
    const id = await createDraft({
      clientOrgId,
      creationPath: path,
      title: title.trim(),
    });
    setApplicationId(id as Id<"applications">);
    setStep("build");
  }

  function handleSent() {
    handleClose();
    router.refresh();
  }

  function handleClose() {
    setStep("choose");
    setPath("custom");
    setTitle("");
    setApplicationId(null);
    onClose();
  }

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

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {step === "choose" && (
                <>
                  <p className="text-body-sm text-muted-foreground">
                    Choose how to build this application:
                  </p>
                  <div className="grid gap-3">
                    {PATH_OPTIONS.map(({ path: p, label, desc }) => (
                      <button
                        key={p}
                        type="button"
                        className={`text-left p-4 rounded-lg border transition-colors ${
                          path === p
                            ? "border-primary bg-primary/5"
                            : "border-foreground/10 hover:bg-accent"
                        }`}
                        onClick={() => setPath(p)}
                      >
                        <div className="font-medium text-body-sm">{label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {desc}
                        </div>
                      </button>
                    ))}
                  </div>
                  <PillButton
                    variant="primary"
                    className="w-full"
                    onClick={() => setStep("name")}
                  >
                    Continue
                  </PillButton>
                </>
              )}

              {step === "name" && (
                <>
                  <div>
                    <label htmlFor="app-title" className={LABEL_CLASSES}>
                      Application title
                    </label>
                    <input
                      id="app-title"
                      type="text"
                      placeholder="e.g. 2026 CGL Renewal"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleNameSubmit()
                      }
                      autoFocus
                      className={INPUT_CLASSES}
                    />
                  </div>
                  <div className="flex gap-2">
                    <PillButton
                      variant="secondary"
                      onClick={() => setStep("choose")}
                    >
                      Back
                    </PillButton>
                    <PillButton
                      variant="primary"
                      className="flex-1"
                      onClick={handleNameSubmit}
                      disabled={!title.trim()}
                    >
                      Continue
                    </PillButton>
                  </div>
                </>
              )}

              {step === "build" && applicationId && (
                <>
                  {path === "custom" && (
                    <EditorCustom
                      applicationId={applicationId}
                      onSend={handleSent}
                    />
                  )}
                  {path === "ai" && (
                    <EditorAi
                      applicationId={applicationId}
                      clientOrgId={clientOrgId}
                      onSend={handleSent}
                    />
                  )}
                  {path === "template" && (
                    <EditorTemplate
                      applicationId={applicationId}
                      onSend={handleSent}
                    />
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
