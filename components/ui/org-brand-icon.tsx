"use client";

import { BrandIcon } from "@/components/ui/brand-icon";

type OrgBrandIconProps = {
  name?: string | null;
  iconUrl?: string | null;
  website?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
};

function faviconFromWebsite(website?: string | null) {
  if (!website) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`;
    const hostname = new URL(withProtocol).hostname;
    if (!hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
  } catch {
    return null;
  }
}

function orgBrandIconSrc({
  iconUrl,
  website,
}: {
  iconUrl?: string | null;
  website?: string | null;
}) {
  return iconUrl ?? faviconFromWebsite(website);
}

export function OrgBrandIcon({
  name,
  iconUrl,
  website,
  size = "sm",
  className,
}: OrgBrandIconProps) {
  return (
    <BrandIcon
      src={orgBrandIconSrc({ iconUrl, website })}
      name={name}
      alt=""
      size={size}
      className={className}
    />
  );
}
