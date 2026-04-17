"use client";
import { EmailScanLog } from "@/components/email-scan-log";
import { PolicyExtractionsLog } from "@/components/policy-extractions-log";
import { DreamLog } from "@/components/dream-log";

export function ActivitySection() {
  return (
    <div className="space-y-6">
      <EmailScanLog />
      <PolicyExtractionsLog />
      <DreamLog />
    </div>
  );
}
