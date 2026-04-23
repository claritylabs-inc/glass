"use client";

import { useState, useEffect } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { AddressAutofill } from "@mapbox/search-js-react";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AutofillWrapper = AddressAutofill as any;

export type AddressValue = {
  street1?: string;
  city?: string;
  state?: string;
  zip?: string;
};

const INPUT_CLASS =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

export function AddressField({
  value,
  onChange,
}: {
  value: AddressValue | undefined;
  onChange: (next: AddressValue) => void;
}) {
  const [local, setLocal] = useState<AddressValue>(value ?? {});
  useEffect(() => {
    setLocal(value ?? {});
  }, [value?.street1, value?.city, value?.state, value?.zip]);

  const update = (patch: Partial<AddressValue>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  };

  const handleRetrieve = (res: {
    features?: Array<{ properties?: Record<string, string> }>;
  }) => {
    const props = res.features?.[0]?.properties;
    if (!props) return;
    update({
      street1: props.address_line1 ?? local.street1,
      city: props.address_level2 ?? local.city,
      state: props.address_level1 ?? local.state,
      zip: props.postcode ?? local.zip,
    });
  };

  const StreetInput = (
    <input
      type="text"
      autoComplete="address-line1"
      value={local.street1 ?? ""}
      onChange={(e) => update({ street1: e.target.value })}
      placeholder="Start typing an address…"
      className={INPUT_CLASS}
    />
  );

  return (
    <div className="space-y-2">
      {MAPBOX_TOKEN ? (
        <AutofillWrapper accessToken={MAPBOX_TOKEN} onRetrieve={handleRetrieve}>
          {StreetInput}
        </AutofillWrapper>
      ) : (
        StreetInput
      )}

      <div className="grid grid-cols-3 gap-2">
        <input
          type="text"
          autoComplete="address-level2"
          value={local.city ?? ""}
          onChange={(e) => update({ city: e.target.value })}
          placeholder="City"
          className={`${INPUT_CLASS} col-span-2`}
        />
        <input
          type="text"
          autoComplete="address-level1"
          value={local.state ?? ""}
          onChange={(e) => update({ state: e.target.value })}
          placeholder="State"
          maxLength={2}
          className={INPUT_CLASS}
        />
      </div>

      <input
        type="text"
        autoComplete="postal-code"
        value={local.zip ?? ""}
        onChange={(e) => update({ zip: e.target.value })}
        placeholder="ZIP"
        className={INPUT_CLASS}
      />
    </div>
  );
}
