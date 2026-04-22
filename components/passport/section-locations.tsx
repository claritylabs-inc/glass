"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { AddressAutofill } from "@mapbox/search-js-react";
import { toast } from "sonner";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AutofillWrapper = AddressAutofill as any;

type LocationAddress = { street1: string; city: string; state: string; zip: string };

function LocationForm({
  onSave,
  onCancel,
}: {
  onSave: (data: { address: LocationAddress; description?: string }) => void;
  onCancel: () => void;
}) {
  const [street1, setStreet1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [description, setDescription] = useState("");

  const inputClass =
    "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  const canSave = street1.trim() && city.trim() && state.trim();

  const handleRetrieve = (res: {
    features?: Array<{ properties?: Record<string, string> }>;
  }) => {
    const props = res.features?.[0]?.properties;
    if (!props) return;
    if (props.address_line1) setStreet1(props.address_line1);
    if (props.address_level2) setCity(props.address_level2);
    if (props.address_level1) setState(props.address_level1);
    if (props.postcode) setZip(props.postcode);
  };

  const StreetInput = (
    <input
      type="text"
      autoComplete="address-line1"
      value={street1}
      onChange={(e) => setStreet1(e.target.value)}
      placeholder="Start typing an address…"
      className={inputClass}
    />
  );

  return (
    <div className="space-y-3 rounded-lg border border-foreground/8 bg-popover/40 p-4">
      <div className="space-y-1.5">
        <label className="text-label-sm font-medium text-muted-foreground block">
          Street address
        </label>
        {MAPBOX_TOKEN ? (
          <AutofillWrapper
            accessToken={MAPBOX_TOKEN}
            onRetrieve={handleRetrieve}
            theme={{
              variables: {
                colorBackground: "#111111",
                colorBackgroundHover: "rgba(229, 226, 220, 0.05)",
                colorBackgroundActive: "rgba(229, 226, 220, 0.08)",
                colorText: "#e5e2dc",
                colorTextSecondary: "#9b9589",
                colorPrimary: "#A0D2FA",
                border: "1px solid rgba(229, 226, 220, 0.08)",
                borderRadius: "8px",
                boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
                fontFamily: "inherit",
                unit: "14px",
                padding: "0.5rem",
              },
              cssText: `
                .Results { max-height: 280px; overflow-y: auto; }
                .ResultsAttribution { color: #9b9589; opacity: 0.6; }
                .Suggestion { border-radius: 6px; }
                .SuggestionName { color: #e5e2dc; }
                .SuggestionDesc { color: #9b9589; }
                mark { background: transparent; color: #A0D2FA; font-weight: 500; }
              `,
            }}
          >
            {StreetInput}
          </AutofillWrapper>
        ) : (
          StreetInput
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1.5">
          <label className="text-label-sm font-medium text-muted-foreground block">City</label>
          <input
            type="text"
            autoComplete="address-level2"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Springfield"
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-label-sm font-medium text-muted-foreground block">State</label>
          <input
            type="text"
            autoComplete="address-level1"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="IL"
            maxLength={2}
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-label-sm font-medium text-muted-foreground block">ZIP</label>
        <input
          type="text"
          autoComplete="postal-code"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="62701"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-label-sm font-medium text-muted-foreground block">
          Description (optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Main office, warehouse, etc."
          className={inputClass}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <PillButton
          type="button"
          size="compact"
          disabled={!canSave}
          onClick={() =>
            onSave({
              address: { street1, city, state, zip },
              description: description || undefined,
            })
          }
        >
          Save location
        </PillButton>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SectionLocations({ clientOrgId: _clientOrgId }: { clientOrgId: string }) {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const addLocation = useMutation(api.passportSideTables.addLocation);
  const removeLocation = useMutation(api.passportSideTables.removeLocation);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const locations = passportData?.locations ?? [];
  const hasLocations = locations.length > 0;

  if (passportData === undefined)
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  async function handleAddLocation(data: Parameters<typeof addLocation>[0]) {
    try {
      await addLocation(data);
      setShowForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add location");
    }
  }

  async function handleNext() {
    setSaving(true);
    try {
      router.push("/onboarding/passport/disclosures");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {hasLocations ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(locations as any[]).map((loc) => (
            <div
              key={loc._id}
              className="flex items-start gap-3 rounded-lg border border-foreground/8 bg-popover/40 px-3 py-2.5"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/[0.04] shrink-0">
                <MapPin className="h-3.5 w-3.5 text-foreground/70" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{loc.address.street1}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {loc.address.city}, {loc.address.state} {loc.address.zip}
                  {loc.description ? ` · ${loc.description}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void removeLocation({ locationId: loc._id })}
                className="p-1 text-muted-foreground/50 hover:text-red-500 transition-colors shrink-0"
                aria-label="Remove location"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : !showForm ? (
        <p className="text-sm text-muted-foreground">Add at least one business location.</p>
      ) : null}

      {showForm ? (
        <LocationForm
          onSave={(data) => void handleAddLocation(data)}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:opacity-70 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          {hasLocations ? "Add another location" : "Add location"}
        </button>
      )}

      <PillButton
        type="button"
        onClick={handleNext}
        disabled={!hasLocations || saving}
        className="w-full justify-center text-sm shadow-none sm:w-auto"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        {!saving ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>
    </div>
  );
}
