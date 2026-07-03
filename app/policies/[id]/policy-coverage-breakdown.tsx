"use client";

import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import type { CoverageBreakdown } from "@/convex/lib/coverageBreakdown";

type CoverageBreakdownRow = CoverageBreakdown["all"][number];

function normalizedCoverageText(value: string | undefined) {
  return value
    ?.toLowerCase()
    .replace(/[^a-z0-9$.,/%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverageTermRows(row: CoverageBreakdownRow) {
  const terms = [...(row.limits ?? [])];
  const seen = new Set(
    terms.map(
      (term) =>
        `${normalizedCoverageText(term.label)}|${normalizedCoverageText(term.value)}`,
    ),
  );
  const hasLabel = (pattern: RegExp) =>
    terms.some((term) => pattern.test(normalizedCoverageText(term.label) ?? ""));
  const push = (label: string, value: string | undefined) => {
    if (!value) return;
    const key = `${normalizedCoverageText(label)}|${normalizedCoverageText(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ label, value });
  };

  if (!row.limits?.length) push("Limit", row.limit);
  if (!hasLabel(/\bdeductible\b|\bretention\b/)) {
    push("Deductible", row.deductible);
  }
  if (!hasLabel(/\bpremium\b/)) push("Premium", row.premium);
  if (!hasLabel(/\bretroactive\b/)) {
    push("Retroactive Date", row.retroactiveDate);
  }
  return terms;
}

function formLabel(row: CoverageBreakdownRow) {
  return [row.formNumber, row.sectionRef].filter(Boolean).join(" | ");
}

function CoverageScheduleList({
  rows,
  title,
}: {
  rows: CoverageBreakdownRow[];
  title: string;
}) {
  if (!rows.length) return null;

  return (
    <OperationalPanel>
      <OperationalPanelHeader title={title} />
      <div>
        {rows.map((row, rowIndex) => {
          const terms = coverageTermRows(row);
          const visibleTerms = terms.length
            ? terms
            : [{ label: "Limit", value: row.limit ?? "—" }];
          const form = formLabel(row);

          return (
            <section
              key={`${row.name}:${row.limit ?? ""}:${rowIndex}`}
              className="border-t border-foreground/6 px-4 py-3 first:border-t-0"
            >
              <div className="min-w-0">
                <div className="text-base font-medium leading-5 text-foreground [overflow-wrap:anywhere]">
                  {row.name}
                </div>
                {form ? (
                  <div className="mt-1 text-label leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                    {form}
                  </div>
                ) : null}
              </div>
              <dl className="mt-3 divide-y divide-foreground/6">
                {visibleTerms.map((term, termIndex) => (
                  <div
                    key={`${term.label}:${termIndex}`}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,auto)] gap-4 py-2 first:pt-0 last:pb-0"
                  >
                    <dt className="min-w-0 text-base leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                      {term.label}
                    </dt>
                    <dd className="min-w-0 text-right text-base font-medium leading-5 tabular-nums text-foreground [overflow-wrap:anywhere]">
                      {term.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
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
    <div className="mb-6 space-y-3">
      <CoverageScheduleList
        rows={breakdown.all}
        title="Coverage schedules"
      />
    </div>
  );
}
