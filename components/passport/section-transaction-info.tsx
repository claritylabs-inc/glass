"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

const LINES_OF_BUSINESS = [
  "General Liability",
  "Property",
  "Commercial Auto",
  "Workers Compensation",
  "Umbrella / Excess",
  "Professional Liability",
  "Cyber",
  "Directors & Officers",
  "Employment Practices",
  "Crime / Fidelity",
];

export function SectionTransactionInfo() {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const upsertTransactionInfo = useMutation(api.clientPassport.upsertTransactionInfo);

  const passport = passportData?.passport as
    | {
        desiredEffectiveDate?: string;
        desiredPolicyTerm?: string;
        desiredLinesOfBusiness?: string[];
      }
    | undefined;

  const [desiredEffectiveDate, setDesiredEffectiveDate] = useState("");
  const [desiredPolicyTerm, setDesiredPolicyTerm] = useState("");
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || !passportData) return;
    if (passport?.desiredEffectiveDate) setDesiredEffectiveDate(passport.desiredEffectiveDate);
    if (passport?.desiredPolicyTerm) setDesiredPolicyTerm(passport.desiredPolicyTerm);
    if (passport?.desiredLinesOfBusiness?.length) setSelectedLines(passport.desiredLinesOfBusiness);
    hydratedRef.current = true;
  }, [passportData, passport]);

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  function toggleLine(line: string) {
    setSelectedLines((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line]
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await upsertTransactionInfo({
        patch: {
          desiredEffectiveDate: desiredEffectiveDate || undefined,
          desiredPolicyTerm: desiredPolicyTerm || undefined,
          desiredLinesOfBusiness: selectedLines.length > 0 ? selectedLines : undefined,
        },
      });
      router.push("/onboarding/passport/extended");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label className="text-label-sm font-medium text-muted-foreground block">Desired effective date</label>
        <input type="date" value={desiredEffectiveDate} onChange={(e) => setDesiredEffectiveDate(e.target.value)} className={inputClass} />
      </div>

      <div className="space-y-1.5">
        <label className="text-label-sm font-medium text-muted-foreground block">Policy term</label>
        <Select
          value={desiredPolicyTerm || null}
          onValueChange={(value) => setDesiredPolicyTerm(value ?? "")}
        >
          <SelectTrigger className={inputClass}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annual">Annual (1 year)</SelectItem>
            <SelectItem value="3-year">3-year</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <p className="text-label-sm font-medium text-muted-foreground">Lines of business</p>
        <div className="grid grid-cols-2 gap-2">
          {LINES_OF_BUSINESS.map((line) => (
            <button
              key={line}
              type="button"
              onClick={() => toggleLine(line)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                selectedLines.includes(line)
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/8 bg-popover text-foreground hover:border-foreground/20"
              }`}
            >
              {line}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <PillButton type="button" onClick={handleSave} disabled={saving} className="text-sm shadow-none">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save & continue
          {!saving ? <ArrowRight className="h-4 w-4" /> : null}
        </PillButton>
      </div>
    </div>
  );
}
