import { type ReactNode } from "react";
import { BrandIcon } from "@/components/ui/brand-icon";
import { LogoIcon } from "@/components/ui/logo-icon";

const BRAND_BLUE = "#A0D2FA";

export function BrandWordmark() {
  return (
    <div className="flex items-center gap-2.5 text-foreground">
      <LogoIcon size={16} color={BRAND_BLUE} static />
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-medium tracking-tight">Glass</span>
        <span className="text-base text-muted-foreground">from Clarity Labs</span>
      </div>
    </div>
  );
}

function faviconFromWebsite(website?: string | null) {
  if (!website) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    const hostname = new URL(withProtocol).hostname;
    if (!hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
  } catch {
    return null;
  }
}

export function PartnerWordmark({
  name,
  iconUrl,
  website,
}: {
  name?: string | null;
  iconUrl?: string | null;
  website?: string | null;
}) {
  const fallbackFavicon = faviconFromWebsite(website);
  const source = iconUrl ?? fallbackFavicon;

  return (
    <div className="flex items-center gap-2.5 text-foreground">
      <div className="h-6 w-6 overflow-hidden rounded-md">
        {source ? (
          <BrandIcon src={source} name={name} size="sm" />
        ) : (
          <LogoIcon size={24} color={BRAND_BLUE} static />
        )}
      </div>
      <span className="text-base font-medium tracking-tight">{name?.trim() || "Glass from Clarity Labs"}</span>
    </div>
  );
}

export function PoweredByGlassWordmark() {
  return (
    <div className="flex items-center justify-center gap-2 text-label leading-none text-muted-foreground">
      <span>Powered by</span>
      <div className="flex items-center gap-1.5 leading-none">
        <LogoIcon size={12} color={BRAND_BLUE} static />
        <span className="font-medium tracking-tight text-foreground">Glass</span>
        <span>from Clarity Labs</span>
      </div>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 sm:py-10">
        <header className="flex items-center justify-between text-base text-muted-foreground">
          <BrandWordmark />
        </header>
        <main className="flex flex-1 items-center justify-center py-12 sm:py-20">{children}</main>
      </div>
    </div>
  );
}

export function AuthMinimalShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 sm:py-10">
        <main className="flex flex-1 items-center justify-center py-12 sm:py-20">{children}</main>
        {footer ? <footer className="pb-2 sm:pb-4">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function AuthCard({
  title,
  subtitle,
  logo,
  children,
}: {
  title: string;
  subtitle?: string;
  logo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-3 text-left">
        {logo ? <div className="mb-14">{logo}</div> : null}
        <h1 className="text-base font-medium tracking-tight">{title}</h1>
        {subtitle ? <p className="text-base text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div>
        {children}
      </div>
    </div>
  );
}
