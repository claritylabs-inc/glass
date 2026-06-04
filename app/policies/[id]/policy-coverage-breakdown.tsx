"use client";

import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import type { CoverageBreakdown } from "@/convex/lib/coverageBreakdown";

function normalizedCoverageText(value: string | undefined) {
  return value
    ?.toLowerCase()
    .replace(/[^a-z0-9$.,/%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripParentheticalText(value: string | undefined) {
  return value
    ?.replace(/\s*\([^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function coverageTermRows(row: CoverageBreakdown["core"][number]) {
  const terms = [...(row.limits ?? [])];
  const seen = new Set(
    terms.map(
      (term) =>
        `${normalizedCoverageText(term.label)}|${normalizedCoverageText(term.value)}`,
    ),
  );
  const hasLabel = (label: string) =>
    terms.some(
      (term) =>
        normalizedCoverageText(term.label) === normalizedCoverageText(label),
    );
  const push = (label: string, value: string | undefined) => {
    if (!value) return;
    const key = `${normalizedCoverageText(label)}|${normalizedCoverageText(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ label, value });
  };

  if (!row.limits?.length) push("Limit", row.limit);
  if (!hasLabel("Deductible")) push("Deductible", row.deductible);
  if (!hasLabel("Premium")) push("Premium", row.premium);
  if (!hasLabel("Retroactive Date")) {
    push("Retroactive Date", row.retroactiveDate);
  }
  return terms;
}

function coverageMetadata(row: CoverageBreakdown["core"][number]) {
  const rowName = normalizedCoverageText(row.name);
  return [row.formNumber, row.sectionRef, row.originReason]
    .filter((item): item is string => Boolean(item))
    .filter((item) => normalizedCoverageText(item) !== rowName)
    .join("  ");
}

function CoverageLimitPanel({
  title,
  rows,
  hideParentheticalText = false,
}: {
  title: string;
  rows: CoverageBreakdown["core"];
  hideParentheticalText?: boolean;
}) {
  if (!rows.length) return null;
  const displayText = (value: string | undefined) =>
    hideParentheticalText ? stripParentheticalText(value) : value;

  return (
    <OperationalPanel className="mb-6">
      <OperationalPanelHeader title={title} />
      <div>
        {rows.map((row, rowIndex) => {
          const terms = coverageTermRows(row);
          const metadata = coverageMetadata(row);

          return (
            <OperationalItem
              key={`${row.name}:${row.limit ?? ""}:${rowIndex}`}
              className="w-full px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-base font-medium leading-5 text-foreground wrap:anywhere">
                  {displayText(row.name)}
                </p>
                {metadata ? (
                  <p className="mt-1 text-label-sm leading-4 text-muted-foreground wrap:anywhere">
                    {displayText(metadata)}
                  </p>
                ) : null}
              </div>
              {terms.length > 0 ? (
                <div className="mt-3 w-full divide-y divide-foreground/6">
                  {terms.map((term) => (
                    <div
                      key={`${term.label}:${term.value}`}
                      className="grid w-full grid-cols-2 items-center gap-6 py-2 first:pt-0 last:pb-0"
                    >
                      <p className="min-w-0 text-base leading-5 text-muted-foreground wrap:anywhere">
                        {displayText(term.label)}
                      </p>
                      <p className="max-w-[min(48rem,60vw)] text-right text-base font-medium leading-5 tabular-nums text-foreground wrap:anywhere">
                        {displayText(term.value)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </OperationalItem>
          );
        })}
      </div>
    </OperationalPanel>
  );
}

export function CoverageBreakdownCards({
  breakdown,
}: {
  breakdown: CoverageBreakdown;
}) {
  if (!breakdown.all.length) return null;
  return (
    <>
      <CoverageLimitPanel title="Core coverage limits" rows={breakdown.core} />
      <CoverageLimitPanel
        title="Endorsement coverage limits"
        rows={breakdown.endorsements}
        hideParentheticalText
      />
    </>
  );
}
