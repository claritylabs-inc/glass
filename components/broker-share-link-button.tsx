"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { usePathname } from "next/navigation";
import { Link2, Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";

export function BrokerShareLinkButton() {
  const currentOrg = useCurrentOrg();
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getOrCreate = useAction((api as any).clientInvitations.getOrCreatePermaInviteLink);

  if (!currentOrg?.isBroker) return null;
  // Only show on broker-wide surfaces where inviting a new client is a likely
  // next action. Skip detail pages, settings, profile, etc.
  const SHOW_ON_PATHS = new Set(["/", "/clients", "/activity"]);
  if (!SHOW_ON_PATHS.has(pathname)) return null;

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const { token } = await getOrCreate({ brokerOrgId: currentOrg!.orgId });
      const url = `${window.location.origin}/invite/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PillButton
      size="compact"
      variant="secondary"
      onClick={handleClick}
      disabled={loading}
      title="Copy your permanent client invite link"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-500" />
          Copied
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" />
          Copy invite link
        </>
      )}
    </PillButton>
  );
}
