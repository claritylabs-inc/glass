"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import {
  getOperatorImpersonationReturnHref,
  type OperatorImpersonationTarget,
} from "@/lib/operator-navigation";
import { useGlassSync } from "@/lib/sync/glass-sync";
import {
  beginOperatorImpersonationStop,
  endOperatorImpersonationStop,
} from "@/lib/operator-impersonation-stop-state";

export function useStopOperatorImpersonation(
  activeImpersonation: OperatorImpersonationTarget | null | undefined,
) {
  const router = useRouter();
  const { clearScope } = useGlassSync();
  const stopImpersonation = useMutation(api.operator.stopImpersonation);

  return useCallback(async () => {
    const returnHref = getOperatorImpersonationReturnHref(activeImpersonation);
    beginOperatorImpersonationStop();
    try {
      await clearScope();
      router.replace(returnHref);
      await stopImpersonation({});
    } finally {
      window.setTimeout(endOperatorImpersonationStop, 1000);
    }
  }, [activeImpersonation, clearScope, router, stopImpersonation]);
}
