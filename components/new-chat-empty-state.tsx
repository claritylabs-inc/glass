"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedAgentTargets,
  useCachedConnectedVendors,
} from "@/lib/sync/glass-cached-queries";

type ExamplePrompt = {
  label: string;
  prompt: string;
  requires: Array<"policies" | "requirements" | "mailboxes" | "activeVendors">;
};

type ConnectedVendorRow = {
  kind?: string;
  status?: string;
};

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    label: "Summarize my active coverage",
    prompt:
      "Summarize my active policies, key limits, deductibles, carriers, and renewal dates",
    requires: ["policies"],
  },
  {
    label: "Check requirements against current coverage",
    prompt:
      "Compare my current policies against active requirements and flag coverage gaps with policy evidence",
    requires: ["policies", "requirements"],
  },
  {
    label: "Find source-backed policy wording",
    prompt:
      "Find the source-backed wording for cancellation notice, additional insured, waiver of subrogation, and primary noncontributory status",
    requires: ["policies"],
  },
  {
    label: "Draft a COI request with required endorsements",
    prompt:
      "Draft a COI request that includes certificate holder details, required limits, additional insured, waiver, and primary noncontributory wording",
    requires: ["policies"],
  },
  {
    label: "Review connected vendor compliance",
    prompt:
      "Show which connected vendors are missing required coverage or have expiring policies, with requirement-by-requirement gaps",
    requires: ["requirements", "activeVendors"],
  },
  {
    label: "Draft a coverage update",
    prompt:
      "Draft a concise email summarizing my current coverage, open questions, and next servicing steps",
    requires: ["policies"],
  },
  {
    label: "Find the latest policy or renewal attachment",
    prompt:
      "Search connected email for my latest policy, certificate, or renewal attachment and save the relevant files to this thread",
    requires: ["mailboxes"],
  },
];

const GET_STARTED_ACTIONS = [
  {
    label: "Upload a policy",
    href: "/policies",
  },
  {
    label: "Add requirements",
    href: "/compliance",
  },
  {
    label: "Connect a mailbox",
    href: "/settings?section=mailboxes&tab=mailboxes",
  },
  {
    label: "Invite a vendor",
    href: "/connect/vendors",
  },
];

export function NewChatEmptyState({
  onSelectPrompt,
  orgId,
}: {
  onSelectPrompt: (prompt: string) => void;
  orgId?: Id<"organizations">;
}) {
  const targets = useCachedAgentTargets(orgId);
  const vendorRows = useCachedConnectedVendors(orgId) as
    | ConnectedVendorRow[]
    | undefined;
  const isLoadingContext =
    Boolean(orgId) && (targets === undefined || vendorRows === undefined);
  const prompts = useMemo(() => {
    const counts = {
      policies: targets?.policies.length ?? 0,
      requirements: targets?.requirements.length ?? 0,
      mailboxes: targets?.mailboxes.length ?? 0,
      activeVendors:
        vendorRows?.filter(
          (row) => row.kind === "relationship" && row.status === "active",
        ).length ?? 0,
    };
    const has = {
      policies: counts.policies > 0,
      requirements: counts.requirements > 0,
      mailboxes: counts.mailboxes > 0,
      activeVendors: counts.activeVendors > 0,
    };

    return EXAMPLE_PROMPTS.filter((item) =>
      item.requires.every((requirement) => has[requirement]),
    ).slice(0, 7);
  }, [targets, vendorRows]);

  if (isLoadingContext) {
    return null;
  }

  if (prompts.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl pt-10 pb-8">
        <p className="mb-4 text-base text-muted-foreground/60">Get started</p>
        <div className="border-t border-foreground/10">
          {GET_STARTED_ACTIONS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block w-full border-b border-foreground/10 py-2.5 text-left text-base leading-snug text-foreground/70 transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl pt-10 pb-8">
      <p className="mb-4 text-base text-muted-foreground/60">Some ideas...</p>
      <div className="border-t border-foreground/10">
        {prompts.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className="w-full border-b border-foreground/10 py-2.5 text-left text-base leading-snug text-foreground/70 transition-colors hover:text-foreground"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
