"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldWithProvenance } from "./field-with-provenance";
import { usePassportSaver } from "./use-passport-saver";
import { toast } from "sonner";

export function SectionCompanyDetails({ clientOrgId }: { clientOrgId: string }) {
  const router = useRouter();
  const orgId = clientOrgId as Id<"organizations">;
  const passportData = useQuery(api.clientPassport.getFull, {});
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const acceptSuggestion = useMutation(api.passportSideTables.acceptSuggestion);
  const dismissSuggestion = useMutation(api.passportSideTables.dismissSuggestion);
  const { save, flush } = usePassportSaver();

  const passport = passportData?.passport;
  const provenance = passportData?.provenance ?? [];

  const getProvenance = (fieldPath: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provenance.find((p: any) => p.fieldPath === fieldPath);

  const [legalName, setLegalName] = useState("");
  const [dba, setDba] = useState("");
  const [entityType, setEntityType] = useState("");
  const [fein, setFein] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || !passportData) return;
    const p = passportData.passport;
    if (p?.legalName) setLegalName(p.legalName);
    else if (viewerOrg?.org?.name) setLegalName(viewerOrg.org.name);
    if (p?.dba) setDba(p.dba);
    if (p?.entityType) setEntityType(p.entityType);
    if (p?.fein) setFein(p.fein);
    if (p?.website) setWebsite(p.website);
    hydratedRef.current = true;
  }, [passportData, viewerOrg?.org?.name]);

  if (passportData === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const canContinue = legalName.trim().length > 0;

  async function handleNext() {
    setSaving(true);
    try {
      flush();
      router.push("/onboarding/passport/contact");
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
        fieldPath="legalName"
        currentValue={legalName}
        provenance={getProvenance("legalName")}
        onAccept={() => {
          const p = getProvenance("legalName");
          if (p?.suggestedValue) setLegalName(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "legalName" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "legalName" })}
        label="Legal name *"
      >
        <input type="text" value={legalName} onChange={(e) => { setLegalName(e.target.value); save("legalName", e.target.value.trim() || undefined); }} placeholder="Acme Corporation" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="dba" currentValue={dba} label="DBA (if different)">
        <input type="text" value={dba} onChange={(e) => { setDba(e.target.value); save("dba", e.target.value.trim() || undefined); }} placeholder="Trading As" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="entityType" currentValue={entityType} label="Entity type">
        <Select
          value={entityType || null}
          onValueChange={(value) => {
            const v = value ?? "";
            setEntityType(v);
            save("entityType", v || undefined);
          }}
        >
          <SelectTrigger className={inputClass}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="corporation">Corporation</SelectItem>
            <SelectItem value="llc">LLC</SelectItem>
            <SelectItem value="partnership">Partnership</SelectItem>
            <SelectItem value="sole_proprietor">Sole Proprietor</SelectItem>
            <SelectItem value="nonprofit">Nonprofit</SelectItem>
            <SelectItem value="government">Government</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="fein" currentValue={fein} label="FEIN">
        <input type="text" value={fein} onChange={(e) => { setFein(e.target.value); save("fein", e.target.value.trim() || undefined); }} placeholder="12-3456789" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance
        fieldPath="website"
        currentValue={website}
        provenance={getProvenance("website")}
        onAccept={() => {
          const p = getProvenance("website");
          if (p?.suggestedValue) setWebsite(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "website" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "website" })}
        label="Website"
      >
        <input type="text" value={website} onChange={(e) => { setWebsite(e.target.value); save("website", e.target.value.trim() || undefined); }} placeholder="https://example.com" className={inputClass} />
      </FieldWithProvenance>

      <PillButton
        type="button"
        onClick={handleNext}
        disabled={!canContinue || saving}
        className="w-full justify-center text-sm shadow-none sm:w-auto"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        {!saving ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>
    </div>
  );
}
