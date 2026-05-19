import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

function normalizeReference(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}

function policyText(policy: Doc<"policies">) {
  return [
    policy._id,
    policy.policyNumber,
    policy.fileName,
    policy.security,
    policy.carrier,
    policy.insuredName,
    ...(policy.policyTypes ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

function policyScore(policy: Doc<"policies">, reference: string) {
  const normalizedReference = normalizeReference(reference);
  if (!normalizedReference) return 0;
  if (String(policy._id) === reference) return 100;
  if (normalizeReference(policy.policyNumber) === normalizedReference) return 95;
  if (normalizeReference(policy.fileName) === normalizedReference) return 85;

  const normalizedText = normalizeReference(policyText(policy));
  if (normalizedText.includes(normalizedReference)) return 60;
  return 0;
}

function policyLabel(policy: Doc<"policies">) {
  return [
    policy.security ?? policy.carrier ?? "Policy",
    policy.policyNumber ? `#${policy.policyNumber}` : undefined,
    policy.policyTypes?.length ? `(${policy.policyTypes.join(", ")})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function resolvePolicyReferenceForOrg(ctx: ActionCtx, args: {
  orgIds: Id<"organizations">[];
  reference: string;
}): Promise<
  | { ok: true; policy: Doc<"policies"> }
  | { ok: false; message: string }
> {
  const policies = (
    await Promise.all(
      args.orgIds.map((orgId) =>
        ctx.runQuery(internal.policies.listAllInternal, { orgId }),
      ),
    )
  ).flat() as Doc<"policies">[];

  const matches = policies
    .map((policy) => ({ policy, score: policyScore(policy, args.reference) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    return {
      ok: false,
      message:
        "I could not match that to a policy in Glass. Ask me to list the policies first, then choose one from the list.",
    };
  }

  const bestScore = matches[0].score;
  const bestMatches = matches.filter((match) => match.score === bestScore);
  if (bestMatches.length > 1) {
    return {
      ok: false,
      message: [
        "I found multiple matching policies. Choose one:",
        ...bestMatches.slice(0, 5).map((match, index) => `${index + 1}. ${policyLabel(match.policy)}`),
      ].join("\n"),
    };
  }

  return { ok: true, policy: matches[0].policy };
}
