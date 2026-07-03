"use client";

import { useEffect, useRef } from "react";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";

type OperatorImpersonationContext = {
  user?: { email?: string };
  activeImpersonation?: {
    targetOrgName?: string;
    targetRole: "admin" | "member";
  } | null;
};

export function OperatorImpersonationBanner() {
  const bannerRef = useRef<HTMLDivElement>(null);
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const operatorContext = useCachedQuery(
    "operator.current.banner",
    api.operator.current,
    viewer?.accountKind === "operator" ? {} : "skip",
  ) as OperatorImpersonationContext | undefined;
  const stopOperatorImpersonation = useStopOperatorImpersonation();
  const impersonation = operatorContext?.activeImpersonation;
  const hasImpersonation = Boolean(impersonation);

  useEffect(() => {
    const root = document.documentElement;
    const setInset = () => {
      const height = bannerRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty("--glass-app-bottom-inset", `${height}px`);
    };

    if (!hasImpersonation) {
      root.style.removeProperty("--glass-app-bottom-inset");
      return;
    }

    setInset();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(setInset);
    if (bannerRef.current) observer?.observe(bannerRef.current);
    window.addEventListener("resize", setInset);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", setInset);
      root.style.removeProperty("--glass-app-bottom-inset");
    };
  }, [hasImpersonation]);

  if (!impersonation) return null;

  return (
    <div
      ref={bannerRef}
      className="w-full shrink-0 border-t border-white/10 bg-black px-4 py-2 text-white dark:border-black/10 dark:bg-white dark:text-black"
    >
      <div className="flex min-h-9 w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-base font-medium">Operator mode</p>
          <p className="truncate text-label text-white/62 dark:text-black/62">
            {operatorContext?.user?.email ?? "Operator account"}
          </p>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
          <p className="min-w-0 truncate text-label text-white/72 dark:text-black/72">
            Viewing {impersonation.targetOrgName ?? "organization"} as{" "}
            {impersonation.targetRole}
          </p>
          <PillButton
            type="button"
            variant="secondary"
            onClick={async () => {
              await stopOperatorImpersonation();
            }}
            className="!border-white/20 !bg-white !text-black hover:!bg-white/90 focus-visible:!ring-white/35 dark:!border-black/15 dark:!bg-black dark:!text-white dark:hover:!bg-black/85 dark:focus-visible:!ring-black/30"
          >
            Stop
          </PillButton>
        </div>
      </div>
    </div>
  );
}
