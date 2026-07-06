export type OrgMemoryType = "fact" | "preference" | "risk_note" | "observation";
export type OrgMemorySource = "extraction" | "analysis" | "chat" | "email" | "imessage";

export const COMPANY_CONTEXT_MEMORY_MAX_LENGTH = 280;

const ORG_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "company",
  "co",
  "the",
]);

const UNSAFE_COMPANY_MEMORY_PATTERNS = [
  /\b(the\s+)?(agent|assistant)\b.*\b(can|cannot|can't|will|should|must|requires?|needs?|asks?|asked|responded|said|stated|indicated|sent|attached|drafts?|blocked|unable|proceed|initiated)\b/i,
  /\bglass\b.*\b(can|cannot|can't|will|should|must|requires?|needs?|asks?|asked|sent|attached|drafts?|generates?|blocked|unable)\b/i,
  /\b(the\s+)?user\b.*\b(requested|asked|wants|can proceed|provided|indicates|confirmed|approved|approval|needs?|requires?)\b/i,
  /\b(email draft|draft email|bcc|cc field|recipient|reply[- ]to|message[- ]id|attachment|attached|\.pdf\b|policy documents attached)\b/i,
  /\b(policy|endorsement|coi|certificate of insurance|certificate holder|additional insured|waiver of subrogation|primary and noncontributory|holder email|holder address|case id|status checker|application intake|intake id|pce)\b/i,
  /\b(policy number|policy period|named insured|limit of liability|aggregate limit|per[- ]occurrence|each claim|deductible|retroactive date|coinsurance|claims-made|carrier|insurer|coverage part)\b/i,
  /\b(request|task|status|on hold|blocked|cannot|can't|unable|requires|needs|must provide|can proceed)\b/i,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,
  /\b[A-Z]{2,}(?:-[A-Z0-9]{2,}){2,}\b/,
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function orgNameTokens(orgName: string | undefined | null) {
  return normalizeText(orgName ?? "")
    .split(" ")
    .filter((token) => token.length > 1 && !ORG_SUFFIXES.has(token));
}

export function mentionsOrganization(content: string, orgName?: string | null) {
  const tokens = orgNameTokens(orgName);
  if (tokens.length === 0) return true;

  const normalizedContent = normalizeText(content);
  const normalizedOrgName = normalizeText(orgName ?? "");
  if (normalizedOrgName && normalizedContent.includes(normalizedOrgName)) {
    return true;
  }

  return tokens.every((token) => normalizedContent.includes(token));
}

export function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

export function isCompanyContextMemory(args: {
  type: OrgMemoryType;
  content: string;
  orgName?: string | null;
  policyId?: unknown;
}) {
  const content = normalizeMemoryContent(args.content);
  if (args.type !== "fact") return false;
  if (!content || content.length > COMPANY_CONTEXT_MEMORY_MAX_LENGTH) return false;
  if (args.policyId) return false;
  if (!mentionsOrganization(content, args.orgName)) return false;
  if (/^(we|our|i|the user|user)\b/i.test(content)) return false;
  return !UNSAFE_COMPANY_MEMORY_PATTERNS.some((pattern) => pattern.test(content));
}
