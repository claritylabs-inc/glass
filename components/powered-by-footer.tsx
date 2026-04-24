"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PoweredByGlassWordmark } from "@/components/auth-shell";

const SKIP_PREFIXES = [
  "/login",
  "/signup",
  "/invite",
  "/agent",
  "/threads",
  "/webchats",
];

export function PoweredByFooter() {
  const pathname = usePathname();
  const viewer = useQuery(api.orgs.viewerOrg, {});

  if (!pathname || SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }

  const isClientUnderBroker = viewer?.org?.type === "client" && !!viewer?.brokerOrg;
  if (!isClientUnderBroker) return null;

  return (
    <div className="fixed bottom-3 left-0 right-0 flex justify-center pointer-events-none opacity-70 z-10">
      <PoweredByGlassWordmark />
    </div>
  );
}
