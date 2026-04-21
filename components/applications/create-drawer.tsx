"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditorCustom } from "./editor-custom";
import { EditorAi } from "./editor-ai";
import { EditorTemplate } from "./editor-template";
import { useRouter } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";

type CreationPath = "custom" | "ai" | "template";

type Props = {
  open: boolean;
  onClose: () => void;
  clientOrgId: Id<"organizations">;
};

export function CreateApplicationDrawer({ open, onClose, clientOrgId }: Props) {
  const [step, setStep] = useState<"choose" | "name" | "build">("choose");
  const [path, setPath] = useState<CreationPath>("custom");
  const [title, setTitle] = useState("");
  const [applicationId, setApplicationId] = useState<Id<"applications"> | null>(null);
  const createDraft = useMutation((api as any).applications.createDraft);
  const router = useRouter();

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
    onClose();
    router.refresh();
  }

  function reset() {
    setStep("choose");
    setPath("custom");
    setTitle("");
    setApplicationId(null);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Application</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {step === "choose" && (
            <>
              <p className="text-sm text-muted-foreground">Choose how to build this application:</p>
              <div className="grid gap-3">
                {(
                  [
                    { path: "custom" as const, label: "Build manually", desc: "Pick questions from the catalog or write your own." },
                    { path: "ai" as const, label: "Generate with AI", desc: "Describe the risk and let Glass generate the question set." },
                    { path: "template" as const, label: "Use a template", desc: "Start from a saved template (e.g. ACORD 126 CGL)." },
                  ] as const
                ).map(({ path: p, label, desc }) => (
                  <button
                    key={p}
                    className={`text-left p-4 rounded-lg border transition-colors ${
                      path === p
                        ? "border-primary bg-primary/5"
                        : "border-foreground/10 hover:bg-accent"
                    }`}
                    onClick={() => setPath(p)}
                  >
                    <div className="font-medium text-sm">{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  </button>
                ))}
              </div>
              <Button className="w-full" onClick={() => setStep("name")}>
                Continue
              </Button>
            </>
          )}

          {step === "name" && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Application title</label>
                <Input
                  placeholder="e.g. 2026 CGL Renewal"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("choose")}>
                  Back
                </Button>
                <Button className="flex-1" onClick={handleNameSubmit} disabled={!title.trim()}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === "build" && applicationId && (
            <>
              {path === "custom" && (
                <EditorCustom applicationId={applicationId} onSend={handleSent} />
              )}
              {path === "ai" && (
                <EditorAi
                  applicationId={applicationId}
                  clientOrgId={clientOrgId}
                  onSend={handleSent}
                />
              )}
              {path === "template" && (
                <EditorTemplate applicationId={applicationId} onSend={handleSent} />
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
