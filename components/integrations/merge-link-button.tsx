// components/integrations/merge-link-button.tsx
"use client";

import { useState } from "react";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2 } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

interface MergeLinkButtonProps {
  clientOrgId: string;
  category: "accounting" | "hris" | "payroll";
  originatingApplicationId?: string;
  integrationRequestId?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  onLinked?: () => void;
}

/**
 * Stub implementation of the Merge Link button.
 * DEFERRED: Replace stub OAuth simulation with the real Merge Link widget:
 *   1. Load @merge-api/merge-link or the Merge JS CDN bundle
 *   2. Call initialize({ linkToken, onSuccess }) from their SDK
 *   3. Remove the simulateLink function below
 */
export function MergeLinkButton({
  clientOrgId,
  category,
  originatingApplicationId,
  integrationRequestId,
  label,
  variant = "primary",
  onLinked,
}: MergeLinkButtonProps) {
  const [loading, setLoading] = useState(false);

  const createLinkToken = useMutation(
    (api as any).integrationConnections.createLinkToken,
  );

  async function handleClick() {
    setLoading(true);
    try {
      const { linkToken } = await createLinkToken({
        clientOrgId,
        category,
        originatingApplicationId,
        integrationRequestId,
      });

      // STUB: simulate successful OAuth + webhook
      await simulateLink(linkToken, category, clientOrgId);
      toast.success(`${category} connected successfully`);
      onLinked?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PillButton variant={variant} onClick={handleClick} disabled={loading}>
      {loading && <Loader2 className="w-3 h-3 animate-spin" />}
      {label ?? `Connect ${category}`}
    </PillButton>
  );
}

/**
 * Stub: POST a fake linked_account.created payload to our webhook route.
 * This triggers the full server-side flow (recordLinkedAccount → runInitialSync).
 * DEFERRED: Remove when real Merge Link widget is wired.
 */
async function simulateLink(
  linkToken: string,
  category: string,
  clientOrgId: string,
): Promise<void> {
  const provider = category === "accounting" ? "quickbooks_online"
    : category === "hris" ? "rippling"
    : "gusto";
  const providerName = category === "accounting" ? "QuickBooks Online"
    : category === "hris" ? "Rippling"
    : "Gusto";

  const payload = {
    hook: { event: "linked_account.created" },
    linked_account: {
      id: `stub_la_${linkToken}`,
      account_token: `stub_at_${linkToken}`,
      end_user_origin_id: clientOrgId,
      category: category.toUpperCase(),
      integration: { slug: provider, name: providerName },
    },
  };

  await fetch("/api/merge/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
