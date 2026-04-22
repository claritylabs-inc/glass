"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { FieldWithProvenance } from "./field-with-provenance";
import { usePassportSaver } from "./use-passport-saver";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

export function SectionOperations({ clientOrgId }: { clientOrgId: string }) {
  const router = useRouter();
  const orgId = clientOrgId as Id<"organizations">;
  const passportData = useQuery(api.clientPassport.getFull, {});
  const acceptSuggestion = useMutation(api.passportSideTables.acceptSuggestion);
  const dismissSuggestion = useMutation(api.passportSideTables.dismissSuggestion);
  const { save, flush } = usePassportSaver();

  const passport = passportData?.passport;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provenance = (passportData?.provenance ?? []) as Array<{ fieldPath: string; confidence: "confirmed" | "suggested"; suggestedValue?: any }>;
  const getProvenance = (fieldPath: string) => provenance.find((p) => p.fieldPath === fieldPath);

  const [summary, setSummary] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resolved = touched
    ? summary
    : (passport?.operationsSummary ?? String(getProvenance("operationsSummary")?.suggestedValue ?? ""));

  const autoSize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    autoSize(ref.current);
  }, [resolved]);

  if (passportData === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  async function handleNext() {
    setSaving(true);
    try {
      flush();
      router.push("/onboarding/passport/locations");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  return (
    <div className="space-y-5">
      <FieldWithProvenance
        fieldPath="operationsSummary"
        currentValue={resolved}
        provenance={getProvenance("operationsSummary")}
        onAccept={() => {
          const p = getProvenance("operationsSummary");
          if (p?.suggestedValue !== undefined) {
            setTouched(true);
            setSummary(String(p.suggestedValue));
          }
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "operationsSummary" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "operationsSummary" })}
        label="Operations summary"
      >
        <textarea
          ref={ref}
          value={resolved}
          onChange={(e) => {
            setTouched(true);
            setSummary(e.target.value);
            save("operationsSummary", e.target.value.trim() || undefined);
          }}
          onInput={(e) => autoSize(e.currentTarget)}
          rows={3}
          placeholder="Key operations, locations served, special risks..."
          className={`${inputClass} min-h-28 resize-none overflow-hidden`}
        />
      </FieldWithProvenance>

      <div className="flex flex-col items-start gap-3">
        <PillButton
          type="button"
          onClick={handleNext}
          disabled={!resolved.trim() || saving}
          className="w-full justify-center text-sm shadow-none sm:w-auto"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
          {!saving ? <ArrowRight className="h-4 w-4" /> : null}
        </PillButton>
        {!resolved.trim() ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </div>
  );
}
