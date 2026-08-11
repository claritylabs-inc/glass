"use client";

import Link from "next/link";
import { Briefcase, UserRound, ArrowRight, Building2 } from "lucide-react";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { typeStyle } from "@/lib/typography";

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
            className="group flex items-start gap-3 rounded-lg border border-input bg-popover p-4 transition-colors hover:border-border-focus"
          >
            <Briefcase className="mt-0.5 h-5 w-5 text-foreground" />
            <div className="flex-1">
              <div className={`text-foreground ${typeStyle("body.medium")}`}>
                I&apos;m a broker or insurance agent
              </div>
              <div className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                Set up your brokerage and invite clients.
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href="/signup/client"
            className="group flex items-start gap-3 rounded-lg border border-input bg-popover p-4 transition-colors hover:border-border-focus"
          >
            <Building2 className="mt-0.5 h-5 w-5 text-foreground" />
            <div className="flex-1">
              <div className={`text-foreground ${typeStyle("body.medium")}`}>
                I&apos;m a company signing up directly
              </div>
              <div className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                Manage your own policies, get answers, and generate COIs.
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          <div className="flex items-start gap-3 rounded-lg border border-dashed border-input p-4">
            <UserRound className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className={`text-foreground ${typeStyle("body.medium")}`}>
                I have an invitation from my partner
              </div>
              <div className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                Use the signup link your partner shared with you (it looks like{" "}
                app.glass.insure/signup/your-partner), or{" "}
                <Link href="/login" className={`text-foreground underline-offset-2 hover:underline ${typeStyle("control.button")}`}>
                  log in
                </Link>{" "}
                if you already have an account.
              </div>
            </div>
          </div>
        </div>

        <div className={`pt-5 text-muted-foreground ${typeStyle("caption.default")}`}>
          <span>Already have an account? </span>
          <Link
            href="/login"
            className={`text-foreground transition hover:opacity-70 ${typeStyle("control.buttonCompact")}`}
          >
            Log in
          </Link>
        </div>
      </AuthCard>
    </AuthMinimalShell>
  );
}
