"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useGlassSync } from "@/lib/sync/glass-sync";
import {
  beginOperatorImpersonationStop,
  endOperatorImpersonationStop,
} from "@/lib/operator-impersonation-stop-state";

export function useStopOperatorImpersonation() {
  const router = useRouter();
  const { clearScope } = useGlassSync();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stopImpersonation = useMutation((api as any).operator.stopImpersonation);

  return useCallback(async () => {
    beginOperatorImpersonationStop();
    try {
      await clearScope();
      router.replace("/operator");
      await stopImpersonation({});
    } finally {
      window.setTimeout(endOperatorImpersonationStop, 1000);
    }
  }, [clearScope, router, stopImpersonation]);
}
