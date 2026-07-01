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
  return [
    row.formNumber,
    row.origin === "endorsement" ? "Endorsement schedule" : row.sectionRef,
  ].filter(Boolean).join(" | ");
}

function CoverageLimitTable({ rows }: { rows: CoverageBreakdownRow[] }) {
  if (!rows.length) return null;

  return (
    <OperationalPanel className="mb-6">
      <OperationalPanelHeader title="Coverage limits" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left">
          <thead className="border-b border-foreground/6">
            <tr>
              <th className="px-4 py-2.5 text-label font-medium text-muted-foreground">
                Coverage
              </th>
              <th className="px-4 py-2.5 text-label font-medium text-muted-foreground">
                Form
              </th>
              <th className="px-4 py-2.5 text-label font-medium text-muted-foreground">
                Term
              </th>
              <th className="px-4 py-2.5 text-right text-label font-medium text-muted-foreground">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const terms = coverageTermRows(row);
              const visibleTerms = terms.length
                ? terms
                : [{ label: "Limit", value: row.limit ?? "—" }];
              const form = formLabel(row);

              return visibleTerms.map((term, termIndex) => (
                <tr
                  key={`${row.name}:${row.limit ?? ""}:${rowIndex}:${term.label}:${termIndex}`}
                  className="border-t border-foreground/6 first:border-t-0 hover:bg-foreground/[0.015]"
                >
                  {termIndex === 0 ? (
                    <>
                      <td
                        rowSpan={visibleTerms.length}
                        className="w-[34%] px-4 py-3 align-top text-base font-medium leading-5 text-foreground [overflow-wrap:anywhere]"
                      >
                        {row.name}
                      </td>
                      <td
                        rowSpan={visibleTerms.length}
                        className="w-[22%] px-4 py-3 align-top text-label leading-5 text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {form || "—"}
                      </td>
                    </>
                  ) : null}
                  <td className="px-4 py-2.5 align-top text-base leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                    {term.label}
                  </td>
                  <td className="px-4 py-2.5 text-right align-top text-base font-medium leading-5 tabular-nums text-foreground [overflow-wrap:anywhere]">
                    {term.value}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
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
  return <CoverageLimitTable rows={breakdown.all} />;
}
