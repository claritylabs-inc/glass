import type { CSSProperties } from "react";
import { readableTextFor } from "@/lib/branding";

const BRANDED_CARD_BASE_COLOR = "#1E293B";
const DEFAULT_CARD_COLOR = "#000000";
const DEFAULT_OVERVIEW_COLOR = "#FFFFFF";
const DEFAULT_CARD_SURFACE_CLASS_NAME =
  "border-border bg-background text-foreground";
const DEFAULT_OVERVIEW_SURFACE_CLASS_NAME = "bg-background text-foreground";
const BRAND_COLOR_WEIGHT = 0.52;
const OVERVIEW_COLOR_WEIGHT = 0.5;

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalizedBrandColor(value?: string | null) {
  const color = value?.trim().toUpperCase();
  return color && /^#[0-9A-F]{6}$/.test(color) ? color : undefined;
}

function hexChannels(color: string) {
  return [1, 3, 5].map((start) =>
    Number.parseInt(color.slice(start, start + 2), 16),
  );
}

function channelHex(value: number) {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

function mixColors(baseColor: string, brandColor: string, brandWeight: number) {
  const brand = hexChannels(brandColor);
  const base = hexChannels(baseColor);
  return `#${base
    .map((channel, index) =>
      channelHex(
        channel * (1 - brandWeight) + brand[index] * brandWeight,
      ),
    )
    .join("")}`;
}

function policyPattern(carrierName: string) {
  const line = "color-mix(in srgb, currentColor 14%, transparent)";
  const softLine = "color-mix(in srgb, currentColor 7%, transparent)";
  const fade =
    "radial-gradient(ellipse at 100% 100%, black 0%, black 34%, transparent 78%)";
  const patternStyle: CSSProperties = {
    maskImage: fade,
    WebkitMaskImage: fade,
  };

  const patternVariant = hashString(carrierName) % 3;
  switch (patternVariant) {
    case 0:
      patternStyle.backgroundImage = `repeating-radial-gradient(circle at 100% 115%, transparent 0 9px, ${line} 9px 10px)`;
      break;
    case 1:
      patternStyle.backgroundImage = `repeating-linear-gradient(118deg, transparent 0 11px, ${line} 11px 12px)`;
      break;
    default:
      patternStyle.backgroundImage = `linear-gradient(${softLine} 1px, transparent 1px), linear-gradient(90deg, ${softLine} 1px, transparent 1px)`;
      patternStyle.backgroundSize = "14px 14px";
  }

  return { patternStyle, patternVariant };
}

export function tonePolicyCardColor(value?: string | null) {
  const brandColor = normalizedBrandColor(value);
  return brandColor
    ? mixColors(BRANDED_CARD_BASE_COLOR, brandColor, BRAND_COLOR_WEIGHT)
    : DEFAULT_CARD_COLOR;
}

export function tonePolicyOverviewColor(value?: string | null) {
  const brandColor = normalizedBrandColor(value);
  return brandColor
    ? mixColors("#FFFFFF", brandColor, OVERVIEW_COLOR_WEIGHT)
    : DEFAULT_OVERVIEW_COLOR;
}

export function policyOverviewBranding(
  carrierName: string,
  requestedColor?: string | null,
) {
  const brandColor = normalizedBrandColor(requestedColor);
  const { patternStyle, patternVariant } = policyPattern(carrierName);
  return {
    patternStyle,
    patternVariant,
    surfaceClassName: brandColor
      ? undefined
      : DEFAULT_OVERVIEW_SURFACE_CLASS_NAME,
    surfaceStyle: brandColor
      ? ({
          backgroundColor: tonePolicyOverviewColor(brandColor),
          color: "#0F172A",
        } satisfies CSSProperties)
      : undefined,
  };
}

export function policyCardBranding(
  carrierName: string,
  requestedColor?: string | null,
) {
  const brandColor = normalizedBrandColor(requestedColor);
  const cardColor = tonePolicyCardColor(brandColor);
  const textColor =
    readableTextFor(cardColor) === "light" ? "#FFFFFF" : "#0F172A";
  const { patternStyle, patternVariant } = policyPattern(carrierName);

  return {
    cardColor,
    textColor,
    patternVariant,
    surfaceClassName: brandColor ? undefined : DEFAULT_CARD_SURFACE_CLASS_NAME,
    surfaceStyle: brandColor
      ? ({
          backgroundColor: cardColor,
          color: textColor,
        } satisfies CSSProperties)
      : undefined,
    patternStyle,
  };
}
