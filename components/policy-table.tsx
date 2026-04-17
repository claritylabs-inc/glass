"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { POLICY_TYPE_LABELS, POLICY_TYPE_COLORS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";

interface Policy {
  _id: string;
  carrier: string;
  policyNumber: string;
  policyTypes: string[];
  policyType?: string;
  documentType?: string;
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  isRenewal: boolean;
  premium?: string;
  insuredName: string;
  extractionStatus: string;
  isDemo?: boolean;
}

function SkeletonRows() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

export function PolicyTable({ policies }: { policies: Policy[] | undefined }) {
  const router = useRouter();

  if (policies === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        <SkeletonRows />
      </div>
    );
  }

  if (policies.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-card px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">No policies found</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={policies.map((p) => p._id).join(",")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {policies.map((policy, i) => {
              const types = policy.policyTypes ?? [policy.policyType ?? "other"];
              const first = types[0];
              const overflow = types.length - 1;

              return (
                <FadeIn
                  key={policy._id}
                  when={true}
                  delay={i * 0.02}
                  duration={0.35}
                  direction="none"
                  className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors cursor-pointer"
                  onClick={() => router.push(`/policies/${policy._id}`)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-body-sm text-foreground font-medium truncate">
                        {policy.policyNumber}
                      </p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium shrink-0 ${
                          POLICY_TYPE_COLORS[first] || POLICY_TYPE_COLORS.other
                        }`}
                      >
                        {POLICY_TYPE_LABELS[first] || first}
                      </span>
                      {overflow > 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-label-sm font-medium bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400 shrink-0">
                          +{overflow}
                        </span>
                      )}
                      {policy.documentType === "quote" && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 shrink-0">Quote</span>
                      )}
                      {policy.isDemo && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 shrink-0">Demo</span>
                      )}
                    </div>
                    <p className="text-label-sm text-muted-foreground/60 mt-0.5 truncate">
                      {policy.insuredName}
                    </p>
                  </div>
                  <p className="text-body-sm text-muted-foreground shrink-0 ml-4 hidden sm:block">
                    {policy.carrier}
                  </p>
                </FadeIn>
              );
            })}
          </motion.div>
        </AnimatePresence>
        <div className="border-t border-foreground/[0.04] px-4 py-2 flex items-center justify-between bg-foreground/[0.01]">
          <p className="text-label-sm text-muted-foreground/60">
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
          </p>
        </div>
      </div>
    </FadeIn>
  );
}
