"use client";

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Bootstrap() {
  const ensure = useAction(api.users.ensureCurrentUser);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await ensure({});
        if (!r.onboardingComplete) router.replace("/onboarding");
        else router.replace("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    })();
  }, [ensure, router, attempt]);

  if (error) {
    return (
      <div className="p-8">
        <p className="mb-3 text-sm text-red-600">Something went wrong setting up your account.</p>
        <button
          className="rounded-md border px-3 py-1 text-sm"
          onClick={() => { setError(null); setAttempt(a => a + 1); }}
        >
          Try again
        </button>
      </div>
    );
  }

  return <p className="p-8 text-sm text-muted-foreground">Setting up your account…</p>;
}
