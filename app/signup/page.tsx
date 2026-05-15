"use client";

import Link from "next/link";
import { Briefcase, UserRound, ArrowRight, Building2 } from "lucide-react";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";

export default function SignupPage() {
  return (
    <AuthMinimalShell>
      <AuthCard
        title="Sign up"
        subtitle="Which best describes you?"
        logo={<BrandWordmark />}
      >
        <div className="space-y-3">
          <Link
            href="/signup/broker"
            className="group flex items-start gap-3 rounded-lg border border-foreground/8 bg-popover p-4 transition-colors hover:border-foreground/20"
          >
            <Briefcase className="mt-0.5 h-5 w-5 text-foreground" />
            <div className="flex-1">
              <div className="text-body-sm font-medium text-foreground">
                I&apos;m a partner or admin
              </div>
              <div className="text-label-sm text-muted-foreground">
                Set up your organization and invite clients.
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href="/signup/client"
            className="group flex items-start gap-3 rounded-lg border border-foreground/8 bg-popover p-4 transition-colors hover:border-foreground/20"
          >
            <Building2 className="mt-0.5 h-5 w-5 text-foreground" />
            <div className="flex-1">
              <div className="text-body-sm font-medium text-foreground">
                I&apos;m a company signing up directly
              </div>
              <div className="text-label-sm text-muted-foreground">
                Manage your own policies, get answers, and generate COIs.
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          <div className="flex items-start gap-3 rounded-lg border border-dashed border-foreground/8 p-4">
            <UserRound className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-body-sm font-medium text-foreground">
                I have an invitation from my partner
              </div>
              <div className="text-label-sm text-muted-foreground">
                Use the signup link your partner shared with you (it looks like{" "}
                app.glass.insure/signup/your-partner), or{" "}
                <Link href="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
                  log in
                </Link>{" "}
                if you already have an account.
              </div>
            </div>
          </div>
        </div>

        <div className="pt-5 text-label-sm text-muted-foreground">
          <span>Already have an account? </span>
          <Link
            href="/login"
            className="text-label-sm font-medium text-foreground transition hover:opacity-70"
          >
            Log in
          </Link>
        </div>
      </AuthCard>
    </AuthMinimalShell>
  );
}
