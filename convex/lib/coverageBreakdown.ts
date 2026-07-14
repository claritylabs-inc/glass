import {
  type AcordLobCode,
  isLobCode,
  lobLabel,
  toLobCodes,
} from "./linesOfBusiness";
import type { CoverageSchedule } from "./coverageScoping";

export type CoverageBreakdownTerm = {
  label: string;
  value: string;
  sourceNodeIds?: string[];
  sourceSpanIds?: string[];
};

export type CoverageBreakdownRow = {
  name: string;
  lineOfBusiness?: AcordLobCode;
  limit?: string;
  limitType?: string;
  limits?: CoverageBreakdownTerm[];
  deductible?: string;
  retroactiveDate?: string;
  formNumber?: string;
  sectionRef?: string;
  description?: string;
  sourceNodeIds?: string[];
  sourceSpanIds?: string[];
  documentNodeId?: string;
  pageNumber?: number;
  resolvedFromPage?: number;
};

export type CoverageBreakdownGroup = {
  lineOfBusiness: AcordLobCode;
  label: string;
  items: CoverageBreakdownRow[];
};

export type CoverageBreakdown = {
  all: CoverageBreakdownRow[];
  groups: CoverageBreakdownGroup[];
  unassigned: CoverageBreakdownRow[];
  schedules: CoverageSchedule[];
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function realText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "—" || text === "-") return undefined;
  return text;
}

function titleText(value: unknown): string | undefined {
  return realText(value)
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = [...new Set(value.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0,
  ))];
  return values.length > 0 ? values : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function coverageTerms(value: unknown): CoverageBreakdownTerm[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map(recordValue)
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const label = titleText(row.label) ?? titleText(row.kind);
      const valueText = realText(row.value) ?? realText(row.limit) ?? realText(row.amount);
      if (!label || !valueText) return null;
      if (row.kind === "premium" || /\bpremium\b/i.test(label)) return null;
      if (/\b(?:exposure|reporting values?|premium basis|rate|vehicle pd values?)\b/i.test(label)) return null;
      const key = `${label.toLowerCase()}|${valueText.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        label,
        value: valueText,
        sourceNodeIds: stringList(row.sourceNodeIds),
        sourceSpanIds: stringList(row.sourceSpanIds),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

function specificLobCodes(value: unknown): AcordLobCode[] {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return toLobCodes(values).filter((code) => code !== "UN");
}

function coverageLineOfBusiness(row: Record<string, unknown>): AcordLobCode | undefined {
  const value = realText(row.lineOfBusiness);
  if (!value) return undefined;
  const [code] = toLobCodes([value]);
  return code && code !== "UN" && isLobCode(code) ? code : undefined;
}

function fallbackLineOfBusiness(profileLinesOfBusiness: unknown): AcordLobCode | undefined {
  const codes = specificLobCodes(profileLinesOfBusiness);
  return codes.length === 1 ? codes[0] : undefined;
}

function coverageRowsFrom(
  value: unknown,
  profileLinesOfBusiness?: unknown,
): CoverageBreakdownRow[] {
  if (!Array.isArray(value)) return [];
  const fallbackLob = fallbackLineOfBusiness(profileLinesOfBusiness);
  return value
    .map(recordValue)
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const name =
        realText(row.name) ??
        realText(row.type) ??
        realText(row.coverageCode) ??
        "Coverage";
      return {
        name,
        lineOfBusiness: coverageLineOfBusiness(row) ?? fallbackLob,
        limit: realText(row.limit),
        limitType: realText(row.limitType),
        limits: coverageTerms(row.limits),
        deductible: realText(row.deductible),
        retroactiveDate: realText(row.retroactiveDate),
        formNumber: realText(row.formNumber),
        sectionRef: realText(row.sectionRef),
        description:
          realText(row.originalContent) ??
          realText(row.description) ??
          realText(row.content),
        sourceNodeIds: stringList(row.sourceNodeIds),
        sourceSpanIds: stringList(row.sourceSpanIds),
        documentNodeId: realText(row.documentNodeId),
        pageNumber: numberValue(row.pageNumber),
        resolvedFromPage: numberValue(row.resolvedFromPage),
      };
    })
    .filter((row) =>
      Boolean(
        row.name ||
          row.limit ||
          row.limits?.length ||
          row.deductible ||
          row.retroactiveDate ||
          row.formNumber ||
          row.sectionRef ||
          row.description,
      ),
    );
}

function coverageSchedules(value: unknown): CoverageSchedule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((schedule) => {
    const record = recordValue(schedule);
    const name = realText(record?.name);
    const rawKind = realText(record?.kind);
    const kind = rawKind === "vehicle" || rawKind === "property" || rawKind === "location" || rawKind === "other"
      ? rawKind
      : "other";
    if (!record || !name || !Array.isArray(record.items)) return [];
    const items = record.items.flatMap((item) => {
      const row = recordValue(item);
      const label = realText(row?.label);
      if (!row || !label || !Array.isArray(row.values)) return [];
      const values = row.values.flatMap((entry) => {
        const value = recordValue(entry);
        const valueLabel = realText(value?.label);
        const valueText = realText(value?.value);
        return valueLabel && valueText ? [{ label: valueLabel, value: valueText }] : [];
      });
      return [{
        label,
        ...(realText(row.description) ? { description: realText(row.description) } : {}),
        values,
        sourceSpanIds: stringList(row.sourceSpanIds) ?? [],
      }];
    });
    if (items.length === 0) return [];
    return [{
      name,
      kind,
      ...(realText(record.description) ? { description: realText(record.description) } : {}),
      items,
      sourceSpanIds: stringList(record.sourceSpanIds) ?? [],
      ...(numberValue(record.pageStart) !== undefined ? { pageStart: numberValue(record.pageStart) } : {}),
      ...(numberValue(record.pageEnd) !== undefined ? { pageEnd: numberValue(record.pageEnd) } : {}),
    }];
  });
}

function groupCoverageRows(rows: CoverageBreakdownRow[]): Pick<CoverageBreakdown, "groups" | "unassigned"> {
  const byLob = new Map<AcordLobCode, CoverageBreakdownRow[]>();
  const unassigned: CoverageBreakdownRow[] = [];
  for (const row of rows) {
    if (!row.lineOfBusiness || row.lineOfBusiness === "UN") {
      unassigned.push(row);
      continue;
    }
    const group = byLob.get(row.lineOfBusiness) ?? [];
    group.push(row);
    byLob.set(row.lineOfBusiness, group);
  }
  return {
    groups: [...byLob.entries()].map(([lineOfBusiness, items]) => ({
      lineOfBusiness,
      label: lobLabel(lineOfBusiness),
      items,
    })),
    unassigned,
  };
}

export function buildCoverageBreakdown(policy: unknown): CoverageBreakdown {
  const record = recordValue(policy);
  const profile = recordValue(record?.operationalProfile);
  const profileRows = coverageRowsFrom(profile?.coverages, profile?.linesOfBusiness ?? record?.linesOfBusiness);
  const rows = profileRows.length > 0
    ? profileRows
    : coverageRowsFrom(record?.coverages, record?.linesOfBusiness);
  return {
    all: rows,
    ...groupCoverageRows(rows),
    schedules: coverageSchedules(record?.coverageSchedules),
  };
}

export function formatCoverageBreakdownForPrompt(policy: unknown, maxRows = 16): string {
  const breakdown = buildCoverageBreakdown(policy);
  if (breakdown.all.length === 0 && breakdown.schedules.length === 0) return "";
  const lines: string[] = [];
  let remainingRows = maxRows;
  const addRows = (label: string, rows: CoverageBreakdownRow[]) => {
    if (rows.length === 0 || remainingRows <= 0) return;
    lines.push(`${label}:`);
    for (const row of rows.slice(0, remainingRows)) {
      remainingRows -= 1;
      lines.push(formatCoverageBreakdownRow(row));
    }
  };

  for (const group of breakdown.groups) {
    addRows(`${group.label} coverage schedules`, group.items);
  }
  addRows(
    breakdown.groups.length ? "Unassigned coverage schedules" : "Coverage schedules",
    breakdown.unassigned,
  );
  for (const schedule of breakdown.schedules) {
    lines.push(`${schedule.name}:`);
    for (const item of schedule.items.slice(0, Math.max(0, remainingRows))) {
      remainingRows -= 1;
      const facts = item.values.map((value) => `${value.label} ${value.value}`);
      lines.push(`- ${item.label}${facts.length ? `: ${facts.join(", ")}` : item.description ? `: ${item.description}` : ""}`);
    }
  }
  return lines.join("\n");
}

function formatCoverageBreakdownRow(row: CoverageBreakdownRow): string {
  const facts = [
    ...(row.limits?.map((term) => `${term.label} ${term.value}`) ?? []),
    row.limit && !row.limits?.length ? `limit ${row.limit}` : undefined,
    row.deductible ? `deductible ${row.deductible}` : undefined,
    row.retroactiveDate ? `retroactive ${row.retroactiveDate}` : undefined,
    row.formNumber ? `form ${row.formNumber}` : undefined,
    row.sectionRef ? `section ${row.sectionRef}` : undefined,
  ].filter(Boolean);
  return `- ${row.name}${facts.length ? `: ${facts.join(", ")}` : ""}`;
}

export function coverageBreakdownForTool(policy: unknown): CoverageBreakdown {
  return buildCoverageBreakdown(policy);
}
