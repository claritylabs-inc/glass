"use client";

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Bootstrap() {
  const ensure = useAction(api.users.ensureCurrentUser);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const r = await ensure({});
      if (!r.onboardingComplete) router.replace("/onboarding");
      else router.replace("/");
    })();
  }, [ensure, router]);

  return <p className="p-8 text-sm text-muted-foreground">Setting up your account…</p>;
}
