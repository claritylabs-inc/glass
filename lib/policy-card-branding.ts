import type { CSSProperties } from "react";
import { readableTextFor } from "@/lib/branding";

const DEFAULT_CARD_COLOR = "#1E293B";
const BRAND_COLOR_WEIGHT = 0.52;

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function safeBrandColor(value?: string | null) {
  const color = value?.trim().toUpperCase();
  return color && /^#[0-9A-F]{6}$/.test(color) ? color : DEFAULT_CARD_COLOR;
}

function hexChannels(color: string) {
  return [1, 3, 5].map((start) =>
    Number.parseInt(color.slice(start, start + 2), 16),
  );
}

function channelHex(value: number) {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

export function tonePolicyCardColor(value?: string | null) {
  const brand = hexChannels(safeBrandColor(value));
  const base = hexChannels(DEFAULT_CARD_COLOR);
  return `#${base
    .map((channel, index) =>
      channelHex(
        channel * (1 - BRAND_COLOR_WEIGHT) + brand[index] * BRAND_COLOR_WEIGHT,
      ),
    )
    .join("")}`;
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
