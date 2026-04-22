"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";

export function SectionWelcome() {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        We will pull what we can from your website, documents, email, and business tools first. You will only need to answer what is missing.
      </p>

      <PillButton
        type="button"
        onClick={() => router.push("/onboarding/passport/website")}
        className="w-full justify-center text-sm shadow-none sm:w-auto"
      >
        Get started
        <ArrowRight className="h-4 w-4" />
      </PillButton>
    </div>
  );
}
