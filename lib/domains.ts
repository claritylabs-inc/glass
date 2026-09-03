const DEFAULT_AGENT_DOMAIN = "spot.insure";
const LEGACY_AGENT_DOMAINS = [
  "glass.insure",
  "glass.claritylabs.inc",
  "spot.claritylabs.inc",
  "dev.claritylabs.inc",
];

export function getPublicAgentDomain(): string {
  const configured = process.env.NEXT_PUBLIC_AGENT_DOMAIN?.trim().toLowerCase();
  if (!configured || LEGACY_AGENT_DOMAINS.includes(configured)) {
    return DEFAULT_AGENT_DOMAIN;
  }
  return configured;
}
