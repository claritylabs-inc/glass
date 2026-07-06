"use client";

import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { LogoIcon } from "@/components/ui/logo-icon";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

const BRAND_BLUE = "#A0D2FA";

const TASK_LABELS: Record<string, string> = {
  chat: "Chat",
  email_draft: "Email Draft",
  email_reply: "Email Reply",
  analysis: "Analysis",
  summary: "Summary",
  classification: "Classification",
  extraction: "PDF Extraction",
  triage: "Email Triage",
  email_extraction: "Email Extraction",
  security: "Security Guard",
};

const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  Anthropic: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  DeepSeek: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
};

export default function WeatherPage() {
  const config = useCachedQuery("modelConfig.list", api.modelConfig.list, {});

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
        <div className="mb-10">
          <Link
            href="https://claritylabs.inc"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 leading-none text-foreground/60 transition-colors hover:text-foreground"
          >
            <LogoIcon size={16} color={BRAND_BLUE} static />
            <span className="text-base font-medium tracking-tight text-foreground">
              Glass
            </span>
            <span className="text-base tracking-tight text-foreground/50">
              from Clarity Labs
            </span>
          </Link>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            AI Weather Report
          </h1>
          <p className="mt-1 text-base text-foreground/50">
            Current model routing across Glass.
          </p>
        </div>

        {!config ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-foreground/[0.03]" />
            ))}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-foreground/8 overflow-hidden">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b border-foreground/8 bg-foreground/[0.02]">
                    <th className="px-4 py-3 text-left font-medium text-foreground/40 text-label ">
                      Task
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-foreground/40 text-label ">
                      Model
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-foreground/40 text-label ">
                      Provider
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {config.routes.map((route, i) => (
                    <tr
                      key={route.task}
                      className={
                        i < config.routes.length - 1
                          ? "border-b border-foreground/[0.04]"
                          : ""
                      }
                    >
                      <td className="px-4 py-3 text-foreground/70">
                        {TASK_LABELS[route.task] ?? route.task}
                      </td>
                      <td className="px-4 py-3 font-mono text-label text-foreground/60">
                        {route.model}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-tag font-medium ${
                            PROVIDER_COLORS[route.provider] ??
                            "bg-foreground/10 text-foreground/60"
                          }`}
                        >
                          {route.provider}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-label text-foreground/30">
              Fallback:{" "}
              <span className="font-mono">{config.fallback.model}</span> (
              {config.fallback.provider})
            </p>
          </>
        )}
      </div>
    </div>
  );
}
