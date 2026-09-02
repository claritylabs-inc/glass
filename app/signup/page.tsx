"use client";

import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import {
  AuthCard,
  AuthMinimalShell,
  BrandWordmark,
} from "@/components/auth-shell";
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
            href="/signup/client"
            className="group flex items-start gap-3 rounded-lg border border-input bg-popover p-4 transition-colors hover:border-border-focus"
          >
            <Building2 className="mt-0.5 h-5 w-5 text-foreground" />
            <div className="flex-1">
              <div className={`text-foreground ${typeStyle("body.medium")}`}>
                I&apos;m a company signing up directly
              </div>
              <div
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Manage your own policies, get answers, and generate COIs.
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div
          className={`pt-5 text-muted-foreground ${typeStyle("caption.default")}`}
        >
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
