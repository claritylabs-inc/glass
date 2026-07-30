import {
  annotateOperationalCoverageLinesOfBusiness,
  resolveAcordCoverageCode,
  resolveOperationalProfileLinesOfBusiness,
  toLobCodes,
  type OperationalCoverageLine,
  type PolicyOperationalProfile,
} from "@claritylabs/cl-sdk/policy-taxonomy";
import {
  readPolicyProductIdentity,
  type PolicyProductIdentity,
  type SourceBackedProductValue,
} from "./policyProductIdentity";

type StoredSourceSpan = {
  spanId?: unknown;
  text?: unknown;
  pageStart?: unknown;
};

type StoredSourceNode = {
  nodeId?: unknown;
  title?: unknown;
  description?: unknown;
  textExcerpt?: unknown;
  sourceSpanIds?: unknown;
  pageStart?: unknown;
};

export type AcordTaxonomyBackfillDecision = {
  patch?: Record<string, unknown>;
  lineChanged: boolean;
  coverageCodesAdded: number;
  productIdentityAdded: boolean;
  reason?: string;
  beforeLines: string[];
  afterLines: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim()
    : undefined;
}

function comparableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, comparableValue(child)]),
  );
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(comparableValue(left)) ===
    JSON.stringify(comparableValue(right));
}

function sourceBackedValue(
  value: string,
  sourceNodeIds: string[],
  sourceSpanIds: string[],
): SourceBackedProductValue {
  return {
    value,
    confidence: "high",
    sourceNodeIds,
    sourceSpanIds,
  };
}

function productCandidateFromText(value: string): string | undefined {
  const match = value.match(
    /^.{0,12}?([A-Z0-9][A-Za-z0-9 &'’/(),+-]{2,110}\b(?:Plan|Program|Product))(?:\s*[-–—:|]|\s*$)/,
  );
  const candidate = match?.[1]?.replace(/\s+/g, " ").trim();
  if (!candidate) return undefined;
  if (
    /\b(?:payment|installment|safety|wage continuation|risk management|loss control)\s+(?:plan|program)\b/i.test(
      candidate,
    ) ||
    /^(?:insurance|policy|coverage)\s+(?:plan|program|product)$/i.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

function normalizedIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchesPolicyNumberOrFileName(
  value: string,
  policy: Record<string, unknown>,
) {
  const identity = normalizedIdentity(value);
  const fileName = text(policy.fileName)
    ?.replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "");
  return [text(policy.policyNumber), fileName].some(
    (candidate) =>
      candidate && normalizedIdentity(candidate) === identity,
  );
}

function matchingSpanIds(
  sourceSpans: StoredSourceSpan[],
  value: string,
  allowedSpanIds?: string[],
) {
  const identity = normalizedIdentity(value);
  const allowed = allowedSpanIds
    ? new Set(allowedSpanIds)
    : undefined;
  return sourceSpans.flatMap((span) => {
    const spanId = text(span.spanId);
    const spanText = text(span.text);
    return spanId &&
        spanText &&
        (!allowed || allowed.has(spanId)) &&
        normalizedIdentity(spanText).includes(identity)
      ? [spanId]
      : [];
  });
}

function storedProductIdentity(params: {
  policy: Record<string, unknown>;
  profile: Record<string, unknown>;
  sourceSpans: StoredSourceSpan[];
  sourceNodes: StoredSourceNode[];
}): PolicyProductIdentity | undefined {
  const existing =
    readPolicyProductIdentity(params.policy.productIdentity) ??
    readPolicyProductIdentity(params.profile.productIdentity);
  if (existing) return existing;

  const legacyProgramName = text(params.policy.programName);
  const existingProgramName =
    legacyProgramName &&
    !matchesPolicyNumberOrFileName(legacyProgramName, params.policy)
      ? legacyProgramName
      : undefined;
  if (existingProgramName) {
    const identity = normalizedIdentity(existingProgramName);
    const matchingNode = params.sourceNodes.find((node) =>
      [node.title, node.description, node.textExcerpt]
        .map(text)
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizedIdentity(value).includes(identity))
    );
    if (matchingNode) {
      const sourceNodeIds = text(matchingNode.nodeId)
        ? [String(matchingNode.nodeId)]
        : [];
      const nodeSpanIds = strings(matchingNode.sourceSpanIds);
      const matchingIds = matchingSpanIds(
        params.sourceSpans,
        existingProgramName,
        nodeSpanIds,
      );
      const sourceSpanIds = matchingIds.length > 0
        ? matchingIds
        : sourceNodeIds.length === 0
        ? nodeSpanIds.slice(0, 8)
        : [];
      if (sourceNodeIds.length > 0 || sourceSpanIds.length > 0) {
        return {
          name: sourceBackedValue(
            existingProgramName,
            sourceNodeIds,
            sourceSpanIds,
          ),
        };
      }
    }
    const matchingSpan = params.sourceSpans.find((span) =>
      normalizedIdentity(text(span.text) ?? "").includes(identity)
    );
    if (matchingSpan && text(matchingSpan.spanId)) {
      return {
        name: sourceBackedValue(
          existingProgramName,
          [],
          [String(matchingSpan.spanId)],
        ),
      };
    }
  }

  const candidates = [
    ...params.sourceNodes
      .filter((node) =>
        typeof node.pageStart !== "number" || node.pageStart <= 5
      )
      .flatMap((node) => {
        const sourceText = text(node.textExcerpt) ?? text(node.title);
        const name = sourceText && productCandidateFromText(sourceText);
        const sourceNodeIds = text(node.nodeId)
          ? [String(node.nodeId)]
          : [];
        const nodeSpanIds = strings(node.sourceSpanIds);
        const matchingIds = name
          ? matchingSpanIds(params.sourceSpans, name, nodeSpanIds)
          : [];
        const sourceSpanIds = matchingIds.length > 0
          ? matchingIds
          : sourceNodeIds.length === 0
          ? nodeSpanIds.slice(0, 8)
          : [];
        return name &&
          (sourceNodeIds.length > 0 || sourceSpanIds.length > 0)
          ? [{
              name,
              sourceNodeIds,
              sourceSpanIds,
              pageStart:
                typeof node.pageStart === "number" ? node.pageStart : 999,
            }]
          : [];
      }),
    ...params.sourceSpans
      .filter((span) =>
        typeof span.pageStart !== "number" || span.pageStart <= 5
      )
      .flatMap((span) => {
        const sourceText = text(span.text);
        const name = sourceText && productCandidateFromText(sourceText);
        return name && text(span.spanId)
          ? [{
              name,
              sourceNodeIds: [],
              sourceSpanIds: [String(span.spanId)],
              pageStart:
                typeof span.pageStart === "number" ? span.pageStart : 999,
            }]
          : [];
      }),
  ];
  const names = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = normalizedIdentity(candidate.name);
    names.set(key, [...(names.get(key) ?? []), candidate]);
  }
  if (names.size !== 1) return undefined;
  const [matches] = names.values();
  const best = matches
    .slice()
    .sort((left, right) =>
      left.pageStart - right.pageStart ||
      left.name.length - right.name.length
    )[0];
  return best
    ? {
        name: sourceBackedValue(
          best.name,
          best.sourceNodeIds,
          best.sourceSpanIds,
        ),
      }
    : undefined;
}

function normalizedCoverageRows(value: unknown): OperationalCoverageLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const coverage = record(item);
    const {
      coverageCode: _coverageCode,
      lineOfBusiness: _lineOfBusiness,
      ...coverageFields
    } = coverage;
    const name = text(coverage.name);
    if (!name) return [];
    const coverageCode = resolveAcordCoverageCode(
      coverage.coverageCode,
      name,
    );
    const [lineOfBusiness] = toLobCodes(
      text(coverage.lineOfBusiness)
        ? [String(coverage.lineOfBusiness)]
        : [],
    );
    return [{
      ...coverageFields,
      name,
      ...(coverageCode ? { coverageCode } : {}),
      ...(lineOfBusiness && lineOfBusiness !== "UN"
        ? { lineOfBusiness }
        : {}),
      ...(Array.isArray(coverage.limits)
        ? { limits: coverage.limits }
        : {}),
      ...(Array.isArray(coverage.sourceNodeIds)
        ? { sourceNodeIds: strings(coverage.sourceNodeIds) }
        : {}),
      ...(Array.isArray(coverage.sourceSpanIds)
        ? { sourceSpanIds: strings(coverage.sourceSpanIds) }
        : {}),
    } as OperationalCoverageLine];
  });
}

function classificationLabels(params: {
  productIdentity?: PolicyProductIdentity;
  policy: Record<string, unknown>;
  profile: Record<string, unknown>;
}) {
  const coverageNames = [
    ...normalizedCoverageRows(params.policy.coverages),
    ...normalizedCoverageRows(params.profile.coverages),
  ].map((coverage) => coverage.name);
  return [
    params.productIdentity?.name?.value,
    text(params.policy.programName),
    ...coverageNames,
  ].filter((value): value is string => Boolean(value));
}

function hasAffirmativeClassificationLabel(
  labels: string[],
  pattern: RegExp,
) {
  const negative =
    /\b(?:not|no|without|exclude(?:s|d)?|exclusion|not covered|not included|not provided)\b/i;
  return labels.some((label) =>
    pattern.test(label) && !negative.test(label)
  );
}

function repairedLines(params: {
  policy: Record<string, unknown>;
  profile: Record<string, unknown>;
  productIdentity?: PolicyProductIdentity;
  coverages: OperationalCoverageLine[];
}): string[] {
  const rawLines = [
    ...strings(params.policy.linesOfBusiness),
    ...strings(params.profile.linesOfBusiness),
  ];
  const current = toLobCodes(rawLines);
  const resolved = resolveOperationalProfileLinesOfBusiness({
    profileLinesOfBusiness: current,
    existingLinesOfBusiness: current,
    coverages: params.coverages,
  }).linesOfBusiness;
  const labels = classificationLabels({
    productIdentity: params.productIdentity,
    policy: params.policy,
    profile: params.profile,
  });
  const inferred = [
    hasAffirmativeClassificationLabel(
      labels,
      /\b(?:travel insurance|trip cancellation|trip interruption|travel delay|travel disruption)\b/i,
    )
      ? "TRVL"
      : undefined,
    hasAffirmativeClassificationLabel(
      labels,
      /\b(?:commercial cyber(?: and privacy)? liability|cyber (?:insurance|liability)|network security(?: and privacy)? liability|privacy liability)\b/i,
    )
      ? "CYBER"
      : undefined,
  ].filter((value): value is "TRVL" | "CYBER" => Boolean(value));
  const combined = [...resolved, ...inferred].filter((code) => code !== "UN");
  const withoutGenericCyber = inferred.includes("CYBER")
    ? combined.filter((code) => code !== "OLIB")
    : combined;
  return withoutGenericCyber.length > 0
    ? Array.from(new Set(withoutGenericCyber)).slice(0, 12)
    : ["UN"];
}

function coverageCodeCount(
  before: unknown,
  after: OperationalCoverageLine[],
) {
  const beforeRows = Array.isArray(before) ? before : [];
  return after.reduce(
    (count, coverage, index) => {
      const previous = record(beforeRows[index]);
      const previousCode = resolveAcordCoverageCode(
        previous.coverageCode,
      );
      return count +
        (!previousCode && coverage.coverageCode ? 1 : 0);
    },
    0,
  );
}

export function rebuildAcordTaxonomyFromStoredSources(params: {
  policy: Record<string, unknown>;
  sourceSpans: StoredSourceSpan[];
  sourceNodes: StoredSourceNode[];
}): AcordTaxonomyBackfillDecision {
  const profile = record(params.policy.operationalProfile);
  const beforeLines = strings(params.policy.linesOfBusiness);
  const existingPolicyCoverages = normalizedCoverageRows(
    params.policy.coverages,
  );
  const existingProfileCoverages = normalizedCoverageRows(profile.coverages);
  const productIdentity = storedProductIdentity({
    policy: params.policy,
    profile,
    sourceSpans: params.sourceSpans,
    sourceNodes: params.sourceNodes,
  });
  const sourceCoverages =
    existingProfileCoverages.length > 0
      ? existingProfileCoverages
      : existingPolicyCoverages;
  const afterLines = repairedLines({
    policy: params.policy,
    profile,
    productIdentity,
    coverages: sourceCoverages,
  });
  const annotatedProfileCoverages =
    annotateOperationalCoverageLinesOfBusiness(
      existingProfileCoverages,
      afterLines,
    );
  const annotatedPolicyCoverages =
    annotateOperationalCoverageLinesOfBusiness(
      existingPolicyCoverages,
      afterLines,
    );
  const existingIdentity =
    readPolicyProductIdentity(params.policy.productIdentity) ??
    readPolicyProductIdentity(profile.productIdentity);
  const lineChanged = !sameValue(beforeLines, afterLines);
  const productIdentityAdded = Boolean(productIdentity && !existingIdentity);
  const coverageCodesAdded =
    coverageCodeCount(params.policy.coverages, annotatedPolicyCoverages) +
    coverageCodeCount(
      profile.coverages,
      annotatedProfileCoverages,
    );
  const profileChanged =
    !sameValue(profile.linesOfBusiness, afterLines) ||
    !sameValue(profile.coverages, annotatedProfileCoverages) ||
    (productIdentity &&
      !sameValue(profile.productIdentity, productIdentity));
  const policyCoveragesChanged = !sameValue(
    params.policy.coverages,
    annotatedPolicyCoverages,
  );
  if (
    !lineChanged &&
    !profileChanged &&
    !policyCoveragesChanged &&
    !productIdentityAdded
  ) {
    return {
      lineChanged: false,
      coverageCodesAdded: 0,
      productIdentityAdded: false,
      reason:
        afterLines.length === 1 && afterLines[0] === "UN"
          ? "ambiguous_or_unclassified"
          : "already_current",
      beforeLines,
      afterLines,
    };
  }

  const patch: Record<string, unknown> = {
    linesOfBusiness: afterLines,
    operationalProfile: {
      ...profile,
      linesOfBusiness: afterLines,
      coverages: annotatedProfileCoverages,
      ...(productIdentity ? { productIdentity } : {}),
    } satisfies Partial<PolicyOperationalProfile>,
    coverages: annotatedPolicyCoverages,
  };
  if (productIdentity) {
    patch.productIdentity = productIdentity;
    if (productIdentity.name?.value) {
      patch.programName = productIdentity.name.value;
    }
  }
  return {
    patch,
    lineChanged,
    coverageCodesAdded,
    productIdentityAdded,
    beforeLines,
    afterLines,
  };
}
