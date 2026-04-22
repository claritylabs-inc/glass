"use client";

import { type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BrandWordmark, PartnerWordmark } from "@/components/auth-shell";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PassportAutofillRunner } from "@/components/passport/passport-autofill-runner";

const CORE_STEPS = [
  { key: "welcome", label: "Welcome" },
  { key: "website", label: "Website" },
  { key: "documents", label: "Documents" },
  { key: "email", label: "Email" },
  { key: "integrations", label: "Business tools" },
  { key: "company", label: "Company" },
  { key: "contact", label: "Primary contact" },
  { key: "business", label: "Business" },
  { key: "operations", label: "Operations" },
  { key: "locations", label: "Locations" },
  { key: "disclosures", label: "Disclosures" },
  { key: "ownership", label: "Ownership" },
] as const;

export type WizardStep = (typeof CORE_STEPS)[number]["key"] | "extended";

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2 justify-center">
      {CORE_STEPS.map((step, i) => (
        <div
          key={step.key}
          className={`rounded-full transition-all ${
            i === current
              ? "h-1 w-4 sm:h-1.5 sm:w-6 bg-foreground"
              : i < current
              ? "h-1 w-1 sm:h-1.5 sm:w-1.5 bg-foreground/40"
              : "h-1 w-1 sm:h-1.5 sm:w-1.5 bg-foreground/15"
          }`}
        />
      ))}
    </div>
  );
}

export function WizardShell({
  children,
  currentStep,
  email,
  title,
  subtitle,
}: {
  children: ReactNode;
  currentStep: WizardStep;
  email?: string;
  title?: string;
  subtitle?: string;
}) {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const brokerBrand = viewerOrg?.brokerOrg;
  const stepIndex = CORE_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 w-full bg-background px-6 py-6 sm:px-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="justify-self-start">
            <div className="sm:hidden">
              {brokerBrand ? (
                <PartnerWordmark
                  name={brokerBrand.name}
                  iconUrl={brokerBrand.iconUrl}
                  website={brokerBrand.website}
                />
              ) : (
                <LogoIcon size={18} color="#A0D2FA" static />
              )}
            </div>
            <div className="hidden sm:block">
              {brokerBrand ? (
                <PartnerWordmark
                  name={brokerBrand.name}
                  iconUrl={brokerBrand.iconUrl}
                  website={brokerBrand.website}
                />
              ) : (
                <BrandWordmark />
              )}
            </div>
          </div>
          <div className="justify-self-center">
            {stepIndex >= 0 && <StepBar current={stepIndex} />}
          </div>
          <div className="justify-self-end text-sm text-muted-foreground">
            {email ?? ""}
          </div>
        </div>
      </header>
      {currentStep === "website" ||
      currentStep === "documents" ||
      currentStep === "email" ||
      currentStep === "integrations" ? null : (
        <PassportAutofillRunner />
      )}
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        <div className="w-full max-w-md space-y-8">
          {title ? (
            <div className="space-y-3 text-left">
              <h1 className="text-base font-medium tracking-tight">{title}</h1>
              {subtitle ? (
                <p className="text-base text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          ) : null}
          <div>{children}</div>
        </div>
      </main>
    </div>
  );
}
