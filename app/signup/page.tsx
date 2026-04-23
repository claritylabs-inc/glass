"use client";

import Link from "next/link";
import { Briefcase, UserRound, ArrowRight } from "lucide-react";
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
                I&apos;m a broker
              </div>
              <div className="text-label-sm text-muted-foreground">
                Set up your brokerage and invite clients.
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          <div className="flex items-start gap-3 rounded-lg border border-dashed border-foreground/8 p-4">
            <UserRound className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-body-sm font-medium text-foreground">
                I&apos;m logging in as a client
              </div>
              <div className="text-label-sm text-muted-foreground">
                Use the signup link your broker shared with you (it looks like
                glass.claritylabs.inc/signup/your-broker), or{" "}
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
