export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstSerializedColumn(value: string): string | undefined {
  const match = value.match(/\bColumn\s+1:\s*([\s\S]*?)(?=\s+\|\s+Column\s+\d+:|\s+Column\s+\d+:|$)/i);
  return match ? normalizeText(match[1]) : undefined;
}

function firstCoverageSegment(value: string): string {
  const [first] = value.split(/\s+\|\s+/);
  return normalizeText(first ?? value);
}

function headingFromSentence(value: string): string | undefined {
  const match = value.match(/^[A-Z]\.\s+([^.!?]{5,140})\.\s+/);
  return match ? normalizeText(match[1]) : undefined;
}

export function normalizeCoverageName(value: string | undefined): string | undefined {
  const text = normalizeText(value ?? "");
  if (!text) return undefined;

  let candidate = headingFromSentence(text) ?? firstSerializedColumn(text) ?? firstCoverageSegment(text);
  candidate = normalizeText(candidate)
    .replace(/^coverage\s*:\s*/i, "")
    .replace(/\bSub-\s+Limit\b/gi, "Sub-Limit")
    .replace(/\s*\(under\s*$/i, "")
    .replace(/\s*\([^)]*$/g, "")
    .replace(/\s+[|—-]\s+\$[\d,.]+[\s\S]*$/g, "")
    .replace(/\b(?:table row|text)\s*$/i, "")
    .replace(/^[\s:;#-]+|[\s;,.\\/]+$/g, "");

  const coveragePart = candidate.match(/^Coverage\s+Part:\s*([A-Z])\.\s*(.+)$/i);
  if (coveragePart) {
    candidate = `Coverage Part ${coveragePart[1].toUpperCase()}: ${normalizeText(coveragePart[2])}`;
  } else {
    candidate = candidate.replace(/^Coverage\s+Part:\s*/i, "");
  }

  const shortPart = candidate.match(/^Part:\s*([A-Z])\.\s*(.+)$/i);
  if (shortPart) {
    candidate = `Coverage Part ${shortPart[1].toUpperCase()}: ${normalizeText(shortPart[2])}`;
  } else {
    candidate = candidate.replace(/^Part:\s*/i, "");
  }

  candidate = candidate.replace(/^Part\s+([A-Z])\s+Aggregate\s+Limit$/i, (_, part: string) =>
    `Coverage Part ${part.toUpperCase()} Aggregate Limit`
  );

  candidate = normalizeText(candidate)
    .replace(/\s*\(under\s+Coverage\s+Part\s+([A-Z])\)?$/i, " (Coverage Part $1)")
    .replace(/\s*\(part of [^)]+\)$/i, "")
    .replace(/\s+\/\s*$/g, "")
    .replace(/^[\s:;#-]+|[\s;,.\\/]+$/g, "");

  if (!candidate) return undefined;
  if (/^(row\s+\d+|table\s+row|text|column\s+\d+)\b/i.test(candidate)) return undefined;
  if (/^(?:table|row|text)\s+(?:table|row|text)$/i.test(candidate)) return undefined;
  if (/\b(?:under|of|and|or|for|to|with|which|that)$/i.test(candidate)) return undefined;
  if (!/[A-Za-z]/.test(candidate)) return undefined;
  return candidate;
}
