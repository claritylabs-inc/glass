"use client";

import type { CSSProperties } from "react";
import type { IconType } from "react-icons";
import {
  SiAnthropic,
  SiGooglegemini,
  SiMistralai,
  SiOpenai,
  SiX,
} from "react-icons/si";

export type ModelProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "deepseek";

const ICONS: Partial<Record<ModelProviderId, IconType>> = {
  openai: SiOpenai,
  anthropic: SiAnthropic,
  google: SiGooglegemini,
  xai: SiX,
  mistral: SiMistralai,
};

const TEXT_MARKS: Record<ModelProviderId, string> = {
  openai: "OA",
  anthropic: "A",
  google: "G",
  xai: "X",
  mistral: "M",
  cohere: "Co",
  deepseek: "DS",
};

export function ModelProviderLogo({
  provider,
  className,
  size = 16,
}: {
  provider: ModelProviderId;
  className?: string;
  size?: number;
}) {
  const Icon = ICONS[provider];
  if (Icon) {
    return <Icon aria-hidden="true" className={className} size={size} />;
  }

  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(7, Math.round(size * 0.45)),
  };

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-[3px] border border-current/20 font-medium leading-none",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {TEXT_MARKS[provider]}
    </span>
  );
}
