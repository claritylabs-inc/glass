"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@/components/ui/textarea";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";

type BrokerProfile = {
  broker: { _id: Id<"organizations">; name: string; website?: string; iconStorageId?: Id<"_storage">; iconUrl?: string | null };
  profile?: {
  networkStatus: "prospect" | "active" | "inactive";
  officeAddress?: {
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  writingStates: string[];
  lineOfBusinessCodes: string[];
  } | null;
};

type BrokerProfilesApi = {
  get: FunctionReference<"query", "public", { brokerOrgId: Id<"organizations"> }, BrokerProfile | null>;
  generateLogoUploadUrl: FunctionReference<"mutation", "public", { brokerOrgId: Id<"organizations"> }, string>;
  upsert: FunctionReference<
    "mutation",
    "public",
    {
      brokerOrgId: Id<"organizations">;
      website?: string | null;
      iconStorageId?: Id<"_storage"> | null;
      networkStatus: "prospect" | "active" | "inactive";
      officeAddress: {
        street1?: string;
        street2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
      };
      writingStates: string[];
      lineOfBusinessCodes: string[];
    },
    unknown
  >;
};

const brokerProfiles = (api as unknown as { brokerProfiles: BrokerProfilesApi }).brokerProfiles;

export function BrokerProfileWorkspace() {
  const currentOrg = useCurrentOrg();
  const brokerOrgId = currentOrg?.orgId as Id<"organizations"> | undefined;
  const profile = useQuery(brokerProfiles.get, brokerOrgId ? { brokerOrgId } : "skip");
  const update = useMutation(brokerProfiles.upsert);
  const generateLogoUploadUrl = useMutation(api.brokerProfiles.generateLogoUploadUrl);
  const [website, setWebsite] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [writingStates, setWritingStates] = useState("");
  const [lines, setLines] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setTimeout(() => {
      setWebsite(profile.broker.website ?? "");
      setLine1(profile.profile?.officeAddress?.street1 ?? "");
      setLine2(profile.profile?.officeAddress?.street2 ?? "");
      setCity(profile.profile?.officeAddress?.city ?? "");
      setState(profile.profile?.officeAddress?.state ?? "");
      setPostalCode(profile.profile?.officeAddress?.postalCode ?? "");
      setWritingStates(profile.profile?.writingStates.join(", ") ?? "");
      setLines(profile.profile?.lineOfBusinessCodes.join(", ") ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profile]);

  async function save() {
    setSaving(true);
    try {
      if (!brokerOrgId) return;
      await update({
        brokerOrgId,
        website: website.trim() || null,
        networkStatus: profile?.profile?.networkStatus ?? "prospect",
        officeAddress: {
          street1: line1.trim() || undefined,
          street2: line2.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim().toUpperCase() || undefined,
          postalCode: postalCode.trim() || undefined,
        },
        writingStates: writingStates.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean),
        lineOfBusinessCodes: lines.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean),
      });
      toast.success("Broker profile saved");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not save the broker profile"));
    } finally {
      setSaving(false);
    }
  }

  if (profile === undefined) {
    return <OperationalPanel className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></OperationalPanel>;
  }
  if (!profile) {
    return <OperationalPanel><OperationalPanelBody className={`text-muted-foreground ${typeStyle("body.default")}`}>Broker profile not found.</OperationalPanelBody></OperationalPanel>;
  }

  const canEdit = currentOrg?.role === "admin";
  const disabled = !canEdit || saving;
  async function uploadLogo(file: File) {
    if (!brokerOrgId) return;
    setSaving(true);
    try {
      const uploadUrl = await generateLogoUploadUrl({ brokerOrgId });
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await update({
        brokerOrgId,
        iconStorageId: storageId,
        networkStatus: profile?.profile?.networkStatus ?? "prospect",
        officeAddress: profile?.profile?.officeAddress ?? {},
        writingStates: profile?.profile?.writingStates ?? [],
        lineOfBusinessCodes: profile?.profile?.lineOfBusinessCodes ?? [],
      });
      toast.success("Broker logo saved");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not save the broker logo"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader title={profile.broker.name} />
        <OperationalPanelBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Website"><Input disabled={disabled} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://example.com" /></Field>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border border-input bg-popover">
                {profile.broker.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.broker.iconUrl} alt="" className="size-full object-contain" />
                ) : <ImagePlus className="size-4 text-muted-foreground" />}
              </div>
              {canEdit ? <PillButton variant="secondary" disabled={saving} onClick={() => document.getElementById("broker-logo-upload")?.click()}>Upload logo</PillButton> : null}
              <input id="broker-logo-upload" className="hidden" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.currentTarget.value = ""; }} />
            </div>
          </Field>
          <Field label="Primary office address"><Input disabled={disabled} value={line1} onChange={(event) => setLine1(event.target.value)} placeholder="Address line 1" /></Field>
          <Field label="Address line 2"><Input disabled={disabled} value={line2} onChange={(event) => setLine2(event.target.value)} placeholder="Suite or unit" /></Field>
          <Field label="City"><Input disabled={disabled} value={city} onChange={(event) => setCity(event.target.value)} /></Field>
          <Field label="State"><Input disabled={disabled} maxLength={2} value={state} onChange={(event) => setState(event.target.value)} /></Field>
          <Field label="Postal code"><Input disabled={disabled} value={postalCode} onChange={(event) => setPostalCode(event.target.value)} /></Field>
        </OperationalPanelBody>
      </OperationalPanel>
      <OperationalPanel>
        <OperationalPanelBody className="grid gap-5 sm:grid-cols-2">
          <Field label="USPS writing states" help="Comma-separated two-letter state codes."><Textarea disabled={disabled} rows={4} value={writingStates} onChange={(event) => setWritingStates(event.target.value)} placeholder="CA, NV, OR" /></Field>
          <Field label="ACORD lines of business" help="Comma-separated exact ACORD LOBCd values."><Textarea disabled={disabled} rows={4} value={lines} onChange={(event) => setLines(event.target.value)} placeholder="CGL, PROP, UMBRC" /></Field>
        </OperationalPanelBody>
      </OperationalPanel>
      {canEdit ? <div className="flex justify-end"><PillButton disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Save profile</PillButton></div> : null}
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <label className="block"><span className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}>{label}</span>{children}{help ? <span className={`mt-1.5 block text-muted-foreground ${typeStyle("caption.default")}`}>{help}</span> : null}</label>;
}
