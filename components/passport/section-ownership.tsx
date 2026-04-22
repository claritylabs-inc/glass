"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { usePassportSaver } from "./use-passport-saver";
import { toast } from "sonner";

export function SectionOwnership() {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const upsertCore = useMutation(api.clientPassport.upsertCore);
  const { save, flush } = usePassportSaver();

  const passport = passportData?.passport;

  const [ownershipNotes, setOwnershipNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || !passportData) return;
    if (passportData.passport?.ownershipNotes) setOwnershipNotes(passportData.passport.ownershipNotes);
    hydratedRef.current = true;
  }, [passportData]);

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  async function handleFinishCore() {
    setSaving(true);
    try {
      flush();
      await upsertCore({ patch: { markCoreComplete: true } });
      router.push("/onboarding/passport/extended");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="text-label-sm font-medium text-muted-foreground block">Ownership notes</label>
        <textarea
          value={ownershipNotes}
          onChange={(e) => { setOwnershipNotes(e.target.value); save("ownershipNotes", e.target.value.trim() || undefined); }}
          rows={4}
          placeholder="Ownership structure, parent/subsidiary relationships..."
          className={`${inputClass} min-h-24 resize-y`}
        />
      </div>

      <div className="flex flex-col items-start gap-3">
        <PillButton
          type="button"
          onClick={handleFinishCore}
          disabled={!ownershipNotes.trim() || saving}
          className="w-full justify-center text-sm shadow-none sm:w-auto"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
          {!saving ? <ArrowRight className="h-4 w-4" /> : null}
        </PillButton>
        {!ownershipNotes.trim() ? (
          <button
            type="button"
            onClick={handleFinishCore}
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
