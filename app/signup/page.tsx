"use client";

import { useState, type FormEvent } from "react";
import { CONSUMER_DOMAINS } from "@/lib/auth/consumer-domains";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const domain = email.toLowerCase().split("@")[1];
    if (!domain || !email.includes("@")) {
      e.preventDefault();
      setError("Enter a valid email address.");
      return;
    }
    if (CONSUMER_DOMAINS.has(domain)) {
      e.preventDefault();
      setError(`Please use your work email. ${domain} isn't supported.`);
      return;
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-medium">Create your account</h1>
      <form action="/signup/submit" method="GET" onSubmit={onSubmit} className="w-full space-y-3">
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          placeholder="you@yourcompany.com"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white">
          Continue
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        Already have an account? <a href="/login" className="underline">Sign in</a>
      </p>
    </main>
  );
}
