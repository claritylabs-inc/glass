"use client";

import { CreditCard } from "lucide-react";

export function BrokerBillingPlaceholder() {
  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-lg font-semibold">Billing</h2>
      <div className="rounded-lg border bg-card p-8 flex flex-col items-center gap-4 text-center">
        <CreditCard className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Billing is handled directly with your Clarity Labs contact.
        </p>
      </div>
    </div>
  );
}
