"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe, Loader2 } from "lucide-react";
import { api as _api } from "@/convex/_generated/api";
import { PillButton } from "@/components/ui/pill-button";
import { usePassportSaver } from "./use-passport-saver";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

function normalizeWebsite(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function SectionWebsite() {
  const router = useRouter();
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const passportData = useQuery(api.clientPassport.getFull, {});
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);
  const { save, flush } = usePassportSaver();

  const [website, setWebsite] = useState("");
  const [continuing, setContinuing] = useState(false);

  const savedWebsite = (passportData?.passport?.website ?? viewerOrg?.org?.website ?? "").trim();

  useEffect(() => {
    setWebsite(savedWebsite);
  }, [savedWebsite]);

  async function handleContinue() {
    const trimmed = website.trim();
    setContinuing(true);
    try {
      flush();
      if (trimmed) {
        const normalized = normalizeWebsite(trimmed);
        const result = await extractCompanyInfo({ url: normalized });
        if (result?.error) {
          toast.error("Could not read your website yet. We will try again later.");
        }
      }
      router.push("/onboarding/passport/documents");
    } catch {
      toast.error("Failed to continue");
    } finally {
      setContinuing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="relative">
        <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <input
          type="text"
          value={website}
          onChange={(e) => {
            setWebsite(e.target.value);
            const trimmed = e.target.value.trim();
            save("website", trimmed ? normalizeWebsite(trimmed) : undefined);
          }}
          placeholder="https://example.com"
          className="w-full rounded-lg border border-foreground/8 bg-popover pl-9 pr-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
        />
      </div>

      <PillButton type="button" onClick={handleContinue} disabled={continuing} className="w-full justify-center text-sm shadow-none sm:w-auto">
        {continuing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        {!continuing ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>
    </div>
  );
}
