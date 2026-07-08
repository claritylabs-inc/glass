import {
  type AcordLobCode,
  isLobCode,
  lobLabel,
  toLobCodes,
} from "./linesOfBusiness";

export type CoverageBreakdownRow = {
  name: string;
  lineOfBusiness?: AcordLobCode;
  limit?: string;
  limits?: Array<{ label: string; value: string }>;
  deductible?: string;
  premium?: string;
  retroactiveDate?: string;
  formNumber?: string;
  sectionRef?: string;
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

function coverageTerms(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map(recordValue)
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const label = titleText(row.label) ?? titleText(row.kind);
      const valueText = realText(row.value) ?? realText(row.limit) ?? realText(row.amount);
      if (!label || !valueText) return null;
      const key = `${label.toLowerCase()}|${valueText.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { label, value: valueText };
    })
    .filter((row): row is { label: string; value: string } => Boolean(row));
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
        limits: coverageTerms(row.limits),
        deductible: realText(row.deductible),
        premium: realText(row.premium),
        retroactiveDate: realText(row.retroactiveDate),
        formNumber: realText(row.formNumber),
        sectionRef: realText(row.sectionRef),
      };
    })
    .filter((row) =>
      Boolean(
        row.name ||
          row.limit ||
          row.limits?.length ||
          row.deductible ||
          row.premium ||
          row.retroactiveDate ||
          row.formNumber ||
          row.sectionRef,
      ),
    );
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
  return { all: rows, ...groupCoverageRows(rows) };
}

export function formatCoverageBreakdownForPrompt(policy: unknown, maxRows = 16): string {
  const breakdown = buildCoverageBreakdown(policy);
  if (breakdown.all.length === 0) return "";
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
  return lines.join("\n");
}

function formatCoverageBreakdownRow(row: CoverageBreakdownRow): string {
  const facts = [
    ...(row.limits?.map((term) => `${term.label} ${term.value}`) ?? []),
    row.limit && !row.limits?.length ? `limit ${row.limit}` : undefined,
    row.deductible ? `deductible ${row.deductible}` : undefined,
    row.premium ? `premium ${row.premium}` : undefined,
    row.retroactiveDate ? `retroactive ${row.retroactiveDate}` : undefined,
    row.formNumber ? `form ${row.formNumber}` : undefined,
    row.sectionRef ? `section ${row.sectionRef}` : undefined,
  ].filter(Boolean);
  return `- ${row.name}${facts.length ? `: ${facts.join(", ")}` : ""}`;
}

export function coverageBreakdownForTool(policy: unknown): CoverageBreakdown {
  return buildCoverageBreakdown(policy);
}
