"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  BRAND_SWATCHES,
  extractDomain,
  readableTextFor,
  sampleBrandColors,
} from "@/lib/branding";

const inputClass =
  "rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

export function AccentColorPicker({
  value,
  onChange,
  website,
}: {
  value: string;
  onChange: (color: string) => void;
  /** Optional — if provided, samples colors from the site's favicon. */
  website?: string;
}) {
  const domain = extractDomain(website ?? "");
  const [sampleResult, setSampleResult] = useState<{
    domain: string;
    colors: string[];
  } | null>(null);

  useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    const iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
    sampleBrandColors(iconUrl).then((colors) => {
      if (cancelled) return;
      setSampleResult({ domain, colors });
    });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const presets = BRAND_SWATCHES;
  const sampledColors =
    sampleResult?.domain === domain ? sampleResult.colors : [];
  const sampling = Boolean(domain && sampleResult?.domain !== domain);
  const isSelected = (c: string) => value.toLowerCase() === c.toLowerCase();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {sampledColors.map((color) => (
        <Swatch
          key={`s-${color}`}
          color={color}
          selected={isSelected(color)}
          onClick={() => onChange(color)}
          title={`From your website: ${color}`}
        />
      ))}
      {sampledColors.length > 0 && (
        <div className="h-6 w-px bg-foreground/8 mx-1" />
      )}
      {presets.map((color) => (
        <Swatch
          key={color}
          color={color}
          selected={isSelected(color)}
          onClick={() => onChange(color)}
        />
      ))}
      <Popover>
        <PopoverTrigger
          className="h-6 w-6 rounded-full border-2 border-dashed border-foreground/20 hover:border-foreground/40 transition-colors flex items-center justify-center text-muted-foreground/60 text-label"
          aria-label="Pick custom color"
          title="Custom color"
        >
          +
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <HexColorPicker color={value} onChange={onChange} />
          <HexColorInput
            color={value}
            onChange={onChange}
            prefixed
            className={`${inputClass} w-full mt-3 font-mono uppercase`}
          />
        </PopoverContent>
      </Popover>
      {sampling && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />
      )}
    </div>
  );
}

function Swatch({
  color,
  selected,
  onClick,
  title,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Select ${color}`}
      title={title ?? color}
      className={`relative h-6 w-6 rounded-full border border-foreground/10 transition-[border-color,box-shadow] duration-100 ${
        selected
          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
          : "hover:border-foreground/30"
      }`}
      style={{ backgroundColor: color }}
    >
      {selected ? (
        <Check
          className="absolute inset-0 m-auto h-3 w-3"
          style={{
            color: readableTextFor(color) === "light" ? "#FFFFFF" : "#0F172A",
          }}
        />
      ) : null}
    </button>
  );
}
