"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";

function LocationForm({
  onSave,
}: {
  onSave: (data: {
    address: { street1: string; city: string; state: string; zip: string };
    description?: string;
  }) => void;
}) {
  const [street1, setStreet1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [description, setDescription] = useState("");

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  const canSave = street1.trim() && city.trim() && state.trim();

  return (
    <div className="space-y-3 rounded-xl border border-foreground/8 bg-popover/60 p-4">
      <div className="space-y-2">
        <label className="text-label-sm font-medium text-muted-foreground block">Street address</label>
        <input type="text" value={street1} onChange={(e) => setStreet1(e.target.value)} placeholder="123 Main St" className={inputClass} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">City</label>
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Springfield" className={inputClass} />
        </div>
        <div className="space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">State</label>
          <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="IL" maxLength={2} className={inputClass} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-label-sm font-medium text-muted-foreground block">ZIP</label>
        <input type="text" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="62701" className={inputClass} />
      </div>
      <div className="space-y-2">
        <label className="text-label-sm font-medium text-muted-foreground block">Description (optional)</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Main office, warehouse, etc." className={inputClass} />
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={() =>
          onSave({
            address: { street1, city, state, zip },
            description: description || undefined,
          })
        }
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40 transition-opacity hover:opacity-90"
      >
        Add location
      </button>
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

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

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
      router.push("/onboarding/passport/general");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {locations.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">Add at least one business location.</p>
      )}

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {(locations as any[]).map((loc) => (
        <div key={loc._id} className="flex items-start justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Location {loc.number}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {loc.address.street1}, {loc.address.city}, {loc.address.state} {loc.address.zip}
            </p>
            {loc.description && <p className="mt-0.5 text-xs text-muted-foreground">{loc.description}</p>}
          </div>
          <button
            type="button"
            onClick={() => void removeLocation({ locationId: loc._id })}
            className="ml-3 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      {showForm ? (
        <LocationForm onSave={(data) => void handleAddLocation(data)} />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 text-sm font-medium text-foreground transition-opacity hover:opacity-70"
        >
          <Plus className="h-4 w-4" />
          Add location
        </button>
      )}

      <PillButton
        type="button"
        onClick={handleNext}
        disabled={!hasLocations || saving}
        className="w-full justify-center text-sm shadow-none sm:w-auto mt-4"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        {!saving ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>
    </div>
  );
}
