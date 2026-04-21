import { type ReactNode } from "react";
import { LogoIcon } from "@/components/ui/logo-icon";

const BRAND_BLUE = "#A0D2FA";

export function BrandWordmark() {
  return (
    <div className="flex items-center gap-2.5 text-foreground">
      <LogoIcon size={16} color={BRAND_BLUE} static />
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-medium tracking-tight">Glass</span>
        <span className="text-sm text-muted-foreground">by Clarity Labs</span>
      </div>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 sm:py-10">
        <header className="flex items-center justify-between text-sm text-muted-foreground">
          <BrandWordmark />
        </header>
        <main className="flex flex-1 items-center justify-center py-12 sm:py-20">{children}</main>
      </div>
    </div>
  );
}

export function AuthMinimalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl px-6 py-8 sm:px-8 sm:py-10">
        <main className="flex flex-1 items-center justify-center py-12 sm:py-20">{children}</main>
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
