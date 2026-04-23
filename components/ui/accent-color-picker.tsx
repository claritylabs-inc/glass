"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BRAND_SWATCHES,
  extractDomain,
  readableTextFor,
  sampleBrandColors,
} from "@/lib/branding";

const inputClass =
  "rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

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
  const [sampledColors, setSampledColors] = useState<string[]>([]);
  const [sampling, setSampling] = useState(false);

  useEffect(() => {
    const domain = extractDomain(website ?? "");
    if (!domain) {
      setSampledColors([]);
      return;
    }
    let cancelled = false;
    setSampling(true);
    const iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
    sampleBrandColors(iconUrl).then((colors) => {
      if (cancelled) return;
      setSampledColors(colors);
      setSampling(false);
    });
    return () => {
      cancelled = true;
    };
  }, [website]);

  const presets = BRAND_SWATCHES;
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
          className="h-6 w-6 rounded-full border-2 border-dashed border-foreground/20 hover:border-foreground/40 transition-colors cursor-pointer flex items-center justify-center text-muted-foreground/60 text-xs"
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
      className={`relative h-6 w-6 rounded-full border border-foreground/10 transition-all cursor-pointer ${
        selected
          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
          : "hover:scale-110"
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
