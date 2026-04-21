"use client";

// applicationSessions retired — this component is a compatibility stub.
// The main application flow now uses the Applications v2 route at /applications/[applicationId].

import { useRouter } from "next/navigation";
import { PillButton } from "@/components/ui/pill-button";
import { FileText } from "lucide-react";

export function ApplicationsList() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
      <FileText className="h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground/60">
        Applications are now managed by your broker.
      </p>
      <PillButton onClick={() => router.push("/applications")}>
        View Applications
      </PillButton>
    </div>
  );
}
