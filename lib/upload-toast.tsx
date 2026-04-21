"use client";

import { toast } from "sonner";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { PillButton } from "@/components/ui/pill-button";

type UploadKind = "policy" | "application";

function ExtractionsToast({
  toastId,
  title,
  description,
  tone,
}: {
  toastId: string | number;
  title: string;
  description: string;
  tone: "success" | "error";
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-foreground/6 bg-popover px-4 py-3 shadow-lg w-[360px]">
      <div className="flex-1 min-w-0">
        <p className={`text-body-sm font-medium ${tone === "error" ? "text-destructive" : "text-foreground"}`}>
          {title}
        </p>
        <p className="text-label-sm text-muted-foreground mt-0.5 truncate">{description}</p>
      </div>
      <PillButton
        variant="secondary"
        size="compact"
        onClick={() => {
          toast.dismiss(toastId);
          router.push("/extractions");
        }}
      >
        View progress
        <ArrowUpRight className="w-3 h-3" />
      </PillButton>
    </div>
  );
}

export function toastUploadStarted(kind: UploadKind) {
  const label = kind === "policy" ? "Policy" : "Application";
  toast.custom(
    (id) => (
      <ExtractionsToast
        toastId={id}
        title={`${label} uploaded`}
        description="Extraction started — you can safely leave this page."
        tone="success"
      />
    ),
    { duration: 6000 },
  );
}

export function toastUploadFailed(kind: UploadKind, message: string) {
  const label = kind === "policy" ? "policy" : "application";
  toast.custom(
    (id) => (
      <ExtractionsToast
        toastId={id}
        title={`Couldn't start ${label} extraction`}
        description={message}
        tone="error"
      />
    ),
    { duration: 8000 },
  );
}
