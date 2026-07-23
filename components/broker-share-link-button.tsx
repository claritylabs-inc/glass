"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Link2, Check } from "lucide-react";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function BrokerShareLinkButton() {
  const currentOrg = useCurrentOrg();
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);

  if (!currentOrg?.isBroker) return null;
  const SHOW_ON_PATHS = new Set(["/", "/clients", "/activity"]);
  if (!SHOW_ON_PATHS.has(pathname)) return null;

  const slug = (currentOrg.org as { slug?: string }).slug;
  if (!slug) return null;

  async function handleClick() {
    const url = `${window.location.origin}/signup/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Signup link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(
        getUserFacingErrorMessage(err, "Could not copy the signup link."),
      );
    }
  }

  return (
    <PillButton
      size="compact"
      variant="secondary"
      onClick={handleClick}
      title="Copy your client signup link"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-500" />
          Copied
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" />
          Copy signup link
        </>
      )}
    </PillButton>
  );
}
