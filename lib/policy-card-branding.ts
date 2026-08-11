import type { CSSProperties } from "react";
import { readableTextFor } from "@/lib/branding";

const DEFAULT_CARD_COLOR = "#1E293B";
const DEFAULT_OVERVIEW_COLOR = "#F1F5F9";
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

function safeBrandColor(value?: string | null) {
  return normalizedBrandColor(value) ?? DEFAULT_CARD_COLOR;
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

export function tonePolicyCardColor(value?: string | null) {
  return mixColors(
    DEFAULT_CARD_COLOR,
    safeBrandColor(value),
    BRAND_COLOR_WEIGHT,
  );
}

export function tonePolicyOverviewColor(value?: string | null) {
  const brandColor = normalizedBrandColor(value);
  return brandColor
    ? mixColors("#FFFFFF", brandColor, OVERVIEW_COLOR_WEIGHT)
    : DEFAULT_OVERVIEW_COLOR;
}

export function policyOverviewBranding(requestedColor?: string | null) {
  return {
    surfaceStyle: {
      backgroundColor: tonePolicyOverviewColor(requestedColor),
      color: "#0F172A",
    } satisfies CSSProperties,
  };
}

export function policyCardBranding(
  carrierName: string,
  requestedColor?: string | null,
) {
  const cardColor = tonePolicyCardColor(requestedColor);
  const textColor =
    readableTextFor(cardColor) === "light" ? "#FFFFFF" : "#0F172A";
  const line = `color-mix(in srgb, ${textColor} 14%, transparent)`;
  const softLine = `color-mix(in srgb, ${textColor} 7%, transparent)`;
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

  return {
    cardColor,
    textColor,
    patternVariant,
    surfaceStyle: {
      backgroundColor: cardColor,
      color: textColor,
    } satisfies CSSProperties,
    patternStyle,
  };
}
