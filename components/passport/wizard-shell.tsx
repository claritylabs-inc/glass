"use client";

import { type ReactNode } from "react";
import { BrandWordmark } from "@/components/auth-shell";
import { LogoIcon } from "@/components/ui/logo-icon";

const CORE_STEPS = [
  { key: "applicant", label: "Applicant info" },
  { key: "business", label: "Nature of business" },
  { key: "locations", label: "Premises" },
  { key: "general", label: "General info" },
] as const;

export type WizardStep = (typeof CORE_STEPS)[number]["key"] | "extended";

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 justify-center">
      {CORE_STEPS.map((step, i) => (
        <div
          key={step.key}
          className={`rounded-full transition-all ${
            i === current
              ? "h-1.5 w-6 bg-foreground"
              : i < current
              ? "h-1.5 w-1.5 bg-foreground/40"
              : "h-1.5 w-1.5 bg-foreground/15"
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
}: {
  children: ReactNode;
  currentStep: WizardStep;
  email?: string;
}) {
  const stepIndex = CORE_STEPS.findIndex((s) => s.key === currentStep);
  const label =
    stepIndex >= 0 ? CORE_STEPS[stepIndex].label : "Complete your profile";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 w-full bg-background px-6 py-6 sm:px-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="justify-self-start">
            <div className="sm:hidden">
              <LogoIcon size={18} color="#A0D2FA" static />
            </div>
            <div className="hidden sm:block">
              <BrandWordmark />
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
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        <div className="w-full max-w-md space-y-8">
          <h1 className="text-base font-medium tracking-tight">{label}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
