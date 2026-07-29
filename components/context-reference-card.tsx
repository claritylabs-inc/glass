"use client";

import { Id } from "@/convex/_generated/dataModel";
import { FileText } from "lucide-react";
import { BrandIcon } from "@/components/ui/brand-icon";
import {
  ActionSurface,
  ActionSurfaceButton,
} from "@/components/ui/action-surface";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import { useCachedPolicySummary } from "@/lib/sync/glass-cached-queries";
import { policyCardBranding } from "@/lib/policy-card-branding";

type PolicyCarrierBrand = {
  name?: string | null;
  accentColor?: string | null;
  iconUrl?: string | null;
};

function policyCarrierBrand(policy: {
  carrier?: string;
  security?: string;
  carrierBrand?: PolicyCarrierBrand | null;
}) {
  const issuerName =
    policy.carrierBrand?.name ??
    policy.carrier ??
    policy.security ??
    "Insurance carrier";
  return {
    issuerName,
    carrierBrand: policy.carrierBrand,
    ...policyCardBranding(issuerName, policy.carrierBrand?.accentColor),
  };
}

function isConvexId(id: string): boolean {
  return id.length > 0 && !/^\d+$/.test(id);
}

function extractIdAndType(
  href: string,
): { id: string; type: "policy"; page?: number } | null {
  const policyMatch = href.match(/^\/policies\/([a-z0-9]+)/);
  if (policyMatch && isConvexId(policyMatch[1])) {
    const page = href.match(/[?&]page=(\d+)/);
    return {
      id: policyMatch[1],
      type: "policy",
      page: page ? parseInt(page[1]) : undefined,
    };
  }
  return null;
}

export function extractEntityRefs(
  content: string,
): { type: "policy"; id: string; page?: number }[] {
  const refs: { type: "policy"; id: string; page?: number }[] = [];
  const seen = new Set<string>();
  // Match markdown links and plain URLs
  const linkRegex = /(?:\[.*?\]\(|)(\/policies\/[a-z0-9]+(?:\?[^)\s]*)?)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const parsed = extractIdAndType(match[1]);
    if (parsed && !seen.has(`${parsed.type}:${parsed.id}`)) {
      seen.add(`${parsed.type}:${parsed.id}`);
      refs.push(parsed);
    }
  }
  return refs;
}

export function PolicyReferenceCard({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
}) {
  const policy = useCachedPolicySummary(id as Id<"policies">);
  const { openPreview } = useEntityPreview();

  if (!policy) {
    return (
      <ActionSurface className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-md px-2 py-1.5 text-label">
        <FileText className="h-3 w-3 text-muted-foreground/40" />
        <span className="text-muted-foreground/50">Policy</span>
      </ActionSurface>
    );
  }

  const generalAgent =
    (policy as { generalAgent?: { agencyName?: string } }).generalAgent?.agencyName ||
    (policy as { mga?: string }).mga ||
    policy.carrier ||
    policy.security ||
    "Unknown";
  const policyNum = policy.policyNumber;
  const linesOfBusiness = policyLobCodes(policy);
  const primaryLine = linesOfBusiness[0] && linesOfBusiness[0] !== "UN"
    ? lobLabel(linesOfBusiness[0])
    : null;

  const summaryParts = [generalAgent, policyNum].filter(Boolean).join(" ");
  const summary = primaryLine
    ? `${summaryParts} — ${primaryLine}`
    : summaryParts;
  const { carrierBrand, issuerName, patternStyle, surfaceStyle } =
    policyCarrierBrand(policy);

  return (
    <ActionSurfaceButton
      type="button"
      onClick={() =>
        openPreview({
          type: "policy",
          id,
          page,
          citedSections,
          citedCoverageNames,
          citedSourceSpanIds,
        })
      }
      className="relative inline-flex max-w-[18rem] items-center gap-1.5 overflow-hidden rounded-md border-black/10 px-2 py-1.5 text-current shadow-[0_1px_4px_rgba(0,0,0,0.08)] transition-[filter,box-shadow] duration-150 ease-out hover:brightness-[0.97] hover:shadow-[0_3px_10px_rgba(0,0,0,0.12)]"
      style={surfaceStyle}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={patternStyle}
      />
      <BrandIcon
        src={carrierBrand?.iconUrl}
        name={issuerName}
        size="sm"
        className="relative z-10 size-5 rounded bg-background"
      />
      <div className="relative z-10 min-w-0 flex-1">
        <p className="mb-0.5 text-label font-medium leading-none text-current opacity-55">
          Policy
        </p>
        <p className="truncate text-label leading-4 text-current opacity-90">
          {summary}
        </p>
      </div>
    </ActionSurfaceButton>
  );
}

export function PolicyCitation({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
}) {
  const policy = useCachedPolicySummary(id as Id<"policies">);
  const { openPreview } = useEntityPreview();

  const label = policy
    ? [policy.carrier || policy.security || "Policy", policy.policyNumber]
        .filter(Boolean)
        .join(" ")
    : "Policy";
  const brand = policy ? policyCarrierBrand(policy) : null;

  return (
    <button
      type="button"
      onClick={() =>
        openPreview({
          type: "policy",
          id,
          page,
          citedSections,
          citedCoverageNames,
          citedSourceSpanIds,
        })
      }
      className="relative mx-0.5 inline-flex h-5 max-w-40 -translate-y-px items-center gap-1 overflow-hidden rounded-full border border-black/10 px-1.5 align-middle text-tag font-medium leading-none text-current no-underline transition-[filter,box-shadow] duration-150 ease-out hover:brightness-[0.96] hover:shadow-sm"
      style={brand?.surfaceStyle}
      title={label}
    >
      {brand ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-50"
            style={brand.patternStyle}
          />
          <BrandIcon
            src={brand.carrierBrand?.iconUrl}
            name={brand.issuerName}
            size="xs"
            className="relative z-10 size-3 rounded-sm bg-background"
          />
        </>
      ) : (
        <FileText className="h-2.5 w-2.5 shrink-0" />
      )}
      <span className="relative z-10 truncate">{label}</span>
    </button>
  );
}

export function PolicySourcePill({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
}) {
  const policy = useCachedPolicySummary(id as Id<"policies">);
  const { openPreview } = useEntityPreview();

  const label = policy
    ? [policy.carrier || policy.security || "Policy", policy.policyNumber]
        .filter(Boolean)
        .join(" ")
    : "Policy";
  const brand = policy ? policyCarrierBrand(policy) : null;

  return (
    <button
      type="button"
      onClick={() =>
        openPreview({
          type: "policy",
          id,
          page,
          citedSections,
          citedCoverageNames,
          citedSourceSpanIds,
        })
      }
      className="relative inline-flex h-6 max-w-48 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-black/10 px-2 text-tag font-medium leading-none text-current transition-[filter,box-shadow] duration-150 ease-out hover:brightness-[0.96] hover:shadow-sm"
      style={brand?.surfaceStyle}
      title={label}
    >
      {brand ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-50"
            style={brand.patternStyle}
          />
          <BrandIcon
            src={brand.carrierBrand?.iconUrl}
            name={brand.issuerName}
            size="xs"
            className="relative z-10 size-3 rounded-sm bg-background"
          />
        </>
      ) : null}
      <span className="relative z-10 truncate">{label}</span>
    </button>
  );
}

/** Renders a rich reference card — opens entity preview sidebar on click */
export function ContextReferenceCard({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const match = extractIdAndType(href);

  if (!match) {
    return (
      <a
        href={href}
        className="text-primary-light underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  return <PolicyCitation id={match.id} page={match.page} />;
}
