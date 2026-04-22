"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api as _api } from "@/convex/_generated/api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

function normalizeWebsite(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function PassportAutofillRunner() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const passportData = useQuery(api.clientPassport.getFull, {});
  const intel = useQuery(api.intelligence.list, {}) as Array<unknown> | undefined;
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);
  const proposeFromContext = useAction(api.actions.proposePassportFields.proposeFromContext);

  const websiteInFlightRef = useRef(false);
  const attemptedWebsiteRef = useRef("");
  const proposeInFlightRef = useRef(false);
  const lastIntelCountRef = useRef(-1);
  const mountProposedRef = useRef(false);

  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [proposeBusy, setProposeBusy] = useState(false);

  const website = (passportData?.passport?.website ?? viewerOrg?.org?.website ?? "").trim();

  useEffect(() => {
    if (!passportData || !website || websiteInFlightRef.current) return;
    const normalized = normalizeWebsite(website);
    if (attemptedWebsiteRef.current === normalized) return;

    attemptedWebsiteRef.current = normalized;
    websiteInFlightRef.current = true;
    setWebsiteBusy(true);

    void (async () => {
      try {
        const result = await extractCompanyInfo({ url: normalized });
        if (result?.error) attemptedWebsiteRef.current = "";
      } catch {
        attemptedWebsiteRef.current = "";
      } finally {
        websiteInFlightRef.current = false;
        setWebsiteBusy(false);
      }
    })();
  }, [passportData, website, extractCompanyInfo]);

  useEffect(() => {
    if (!passportData) return;
    const intelCount = intel?.length ?? 0;
    const alreadyRanForThisCount = intelCount === lastIntelCountRef.current;
    const firstRunThisMount = !mountProposedRef.current;
    if (!firstRunThisMount && alreadyRanForThisCount) return;
    if (proposeInFlightRef.current) return;

    lastIntelCountRef.current = intelCount;
    mountProposedRef.current = true;
    proposeInFlightRef.current = true;
    setProposeBusy(true);

    void (async () => {
      try {
        await proposeFromContext({});
      } catch {
        lastIntelCountRef.current = -1;
        mountProposedRef.current = false;
      } finally {
        proposeInFlightRef.current = false;
        setProposeBusy(false);
      }
    })();
  }, [passportData, intel, proposeFromContext]);

  const busy = websiteBusy || proposeBusy;

  return busy ? (
    <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-foreground/8 bg-popover px-3 py-1.5 shadow-sm">
      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      <span className="text-xs text-muted-foreground">Autofilling from your context…</span>
    </div>
  ) : null;
}
