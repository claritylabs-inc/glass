import { generateObject } from "ai";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id, TableNames } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getModelAndRouteForOrg, getProviderOptionsForTask } from "./models";
import { structuredOutputSchemaForRoute } from "./fireworksStructuredOutput";

export type ImessageAppCard = {
  url: string;
  title?: string;
  subtitle?: string;
  summary?: string;
};

export type ImessageAppCardCreateArgs = {
  kind: "policy" | "certificate" | "policy_change";
  policyId?: Id<"policies">;
  certificateId?: Id<"certificates">;
  policyCertificateId?: Id<"policyCertificates">;
  certificateVersionId?: Id<"certificateVersions">;
  policyChangeCaseId?: Id<"policyChangeCases">;
  label?: string;
};

export type ImessageAppCardRequest = {
  key: string;
  createArgs: ImessageAppCardCreateArgs;
  card: Omit<ImessageAppCard, "url">;
};

type ToolArtifact = { type: string; data: unknown };

const POLICY_CHANGE_TOOL_NAMES = new Set([
  "create_policy_change_request",
  "add_policy_change_info",
  "check_policy_change_status",
  "complete_policy_change_from_endorsement",
]);

const POLICY_DETAIL_TOOL_NAMES = new Set([
  "lookup_policy",
  "lookup_policy_section",
  "compare_coverages",
]);

const POLICY_DETAIL_RESPONSE_FIELD_PATTERNS = [
  /\bpolicy\s*(?:number)?\s*:/i,
  /\btype\s*:/i,
  /\bpolicy period\s*:/i,
  /\bnamed insured\s*:/i,
  /\bcarrier\s*:/i,
  /\beffective(?: date)?\s*:/i,
  /\bexpiration(?: date)?\s*:/i,
  /\blimit\s*:/i,
  /\bdeductible\s*:/i,
  /\bpremium\s*:/i,
];

const PolicyAppCardDecisionSchema = z.object({
  shouldCreate: z.boolean(),
  confidence: z.number().min(0).max(1),
});

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function artifactId<TableName extends TableNames>(
  value: unknown,
): Id<TableName> | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? (value as Id<TableName>)
    : undefined;
}

function policyCardRequest(policyId: Id<"policies">): ImessageAppCardRequest {
  return {
    key: `policy:${policyId}`,
    createArgs: {
      kind: "policy",
      policyId,
      label: "Policy details",
    },
    card: {
      title: "Policy link",
      subtitle: "Open this policy in Glass",
      summary: "Here's the policy link in Glass:",
    },
  };
}

function normalizePolicyCardText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePolicyDetailsResponse(text: string): boolean {
  let matchedFields = 0;
  for (const pattern of POLICY_DETAIL_RESPONSE_FIELD_PATTERNS) {
    if (pattern.test(text)) matchedFields++;
  }
  return matchedFields >= 2;
}

function looksLikePolicyInventoryResponse(text: string): boolean {
  const normalized = normalizePolicyCardText(text);
  const hasInventoryLanguage =
    /\b(active\s+)?polic(?:y|ies)\b/.test(normalized) &&
    /\b(on file|have|found|active|effective|expires?|expiration)\b/.test(
      normalized,
    );
  const hasPolicyIdentifier =
    /\bpolicy\s+(?:number\s+)?[a-z0-9][a-z0-9-]{5,}\b/i.test(text) ||
    /\b[A-Z]{2,}[A-Z0-9]*-[A-Z0-9-]{6,}\b/.test(text);
  const hasPolicyPeriod =
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\s+(?:to|-|through)\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(
      text,
    );
  return hasInventoryLanguage && (hasPolicyIdentifier || hasPolicyPeriod);
}

export function shouldCreatePolicyDetailsAppCard(params: {
  messageText: string;
  responseText: string;
  usedTools: string[];
}): boolean {
  if (
    params.usedTools.some((toolName) => POLICY_DETAIL_TOOL_NAMES.has(toolName))
  ) {
    return true;
  }

  const responseText = params.responseText.trim();
  if (!responseText) return false;

  const normalizedRequest = normalizePolicyCardText(params.messageText);
  if (!normalizedRequest) return false;

  const explicitPolicyLinkRequest =
    /\b(policy|record)\b/.test(normalizedRequest) &&
    /\b(open|link|url|app|glass|record)\b/.test(normalizedRequest);
  if (explicitPolicyLinkRequest) return true;

  const policyReference =
    /\b(policy|policies|coverage|coverages|carrier|insured|limit|limits|deductible|premium|expiration|effective|period)\b/.test(
      normalizedRequest,
    ) || /\b(that|this|the)\s+(one|record)\b/.test(normalizedRequest);
  const detailIntent =
    /\b(detail|details|summary|summarize|show|record|again|list|what|which|give|tell|remind|send)\b/.test(
      normalizedRequest,
    );

  return (
    policyReference &&
    detailIntent &&
    (looksLikePolicyDetailsResponse(responseText) ||
      looksLikePolicyInventoryResponse(responseText))
  );
}

export async function decidePolicyAppCardCreation(
  ctx: ActionCtx,
  params: {
    orgId: Id<"organizations">;
    messageText: string;
    responseText: string;
    usedTools: string[];
    candidatePolicyCount: number;
  },
): Promise<boolean> {
  if (!params.responseText.trim()) return false;

  const fallback = () =>
    shouldCreatePolicyDetailsAppCard({
      messageText: params.messageText,
      responseText: params.responseText,
      usedTools: params.usedTools,
    });

  try {
    const modelRoute = await getModelAndRouteForOrg(ctx, params.orgId, "classification");
    const result = await generateObject({
      model: modelRoute.model,
      providerOptions: getProviderOptionsForTask("classification"),
      schema: structuredOutputSchemaForRoute(PolicyAppCardDecisionSchema, modelRoute.route),
      maxOutputTokens: 160,
      system: `Decide whether this Glass iMessage response should include app-card links to candidate policy records.

Return shouldCreate true when the response discusses real policy records in a way the user would plausibly open: inventories, lists, summaries, details, coverage, dates, carrier, insured, limits, deductibles, premium, or policy lookup/comparison results.
Return false for command acknowledgements, greetings, errors, clarification questions, email draft status, or unrelated conversation.
If unsure, set confidence below 0.55. Return only the structured object.`,
      prompt: JSON.stringify({
        userMessage: params.messageText.slice(0, 1200),
        assistantResponse: params.responseText.slice(0, 1800),
        usedTools: params.usedTools.slice(0, 12),
        candidatePolicyCount: params.candidatePolicyCount,
      }),
    });

    if (result.object.confidence >= 0.55) {
      return result.object.shouldCreate;
    }
    return fallback();
  } catch (err) {
    console.warn("[imessage] Policy app-card model decision failed:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback();
  }
}

function policyChangeCardRequest(
  policyChangeCaseId: Id<"policyChangeCases">,
): ImessageAppCardRequest {
  return {
    key: `policy_change:${policyChangeCaseId}`,
    createArgs: {
      kind: "policy_change",
      policyChangeCaseId,
      label: "Broker follow-up",
    },
    card: {
      title: "Broker follow-up",
      subtitle: "Open the follow-up in Glass",
    },
  };
}

function certificateCardRequest(
  data: Record<string, unknown>,
): ImessageAppCardRequest | null {
  const certificateId = artifactId<"certificates">(data.certificateId);
  const policyCertificateId = artifactId<"policyCertificates">(
    data.policyCertificateId,
  );
  const certificateVersionId = artifactId<"certificateVersions">(
    data.certificateVersionId,
  );

  const certificateKey =
    certificateId ?? policyCertificateId ?? certificateVersionId;
  if (!certificateKey) return null;

  return {
    key: `certificate:${certificateKey}`,
    createArgs: {
      kind: "certificate",
      certificateId,
      policyCertificateId,
      certificateVersionId,
      label: "Certificate",
    },
    card: {
      title: "Certificate",
      subtitle: "Open the certificate in Glass",
    },
  };
}

export function buildImessageAppCardRequests(args: {
  policyIds: Id<"policies">[];
  artifacts: ToolArtifact[];
  policyChangeCaseId?: Id<"policyChangeCases">;
  usedTools: string[];
}): ImessageAppCardRequest[] {
  const requests: ImessageAppCardRequest[] = args.policyIds
    .slice(0, 3)
    .map(policyCardRequest);

  for (const artifact of args.artifacts) {
    const data = objectRecord(artifact.data);
    if (!data) continue;

    if (artifact.type === "certificate_result") {
      const request = certificateCardRequest(data);
      if (request) requests.push(request);
    }

    if (
      artifact.type === "certificate_hold" ||
      artifact.type === "policy_change_result"
    ) {
      const caseId = artifactId<"policyChangeCases">(
        data.policyChangeCaseId ?? data.caseId,
      );
      if (caseId) requests.push(policyChangeCardRequest(caseId));
    }
  }

  if (
    args.policyChangeCaseId &&
    args.usedTools.some((tool) => POLICY_CHANGE_TOOL_NAMES.has(tool))
  ) {
    requests.push(policyChangeCardRequest(args.policyChangeCaseId));
  }

  return requests;
}

export function dedupeImessageAppCardRequests(
  requests: ImessageAppCardRequest[],
): ImessageAppCardRequest[] {
  const seen = new Set<string>();
  const deduped: ImessageAppCardRequest[] = [];
  for (const request of requests) {
    if (seen.has(request.key)) continue;
    seen.add(request.key);
    deduped.push(request);
  }
  return deduped;
}

export async function mintImessageAppCards(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    threadId: Id<"threads">;
    sourceThreadMessageId?: Id<"threadMessages">;
    createdByUserId: Id<"users">;
    messageText: string;
    responseText: string;
    relevantPolicyIds: Id<"policies">[];
    artifacts: ToolArtifact[];
    policyChangeCaseId?: Id<"policyChangeCases">;
    usedTools: string[];
  },
): Promise<ImessageAppCard[]> {
  const shouldCreatePolicyAppCards =
    args.relevantPolicyIds.length > 0
      ? await decidePolicyAppCardCreation(ctx, {
          orgId: args.orgId,
          messageText: args.messageText,
          responseText: args.responseText,
          usedTools: args.usedTools,
          candidatePolicyCount: args.relevantPolicyIds.length,
        })
      : false;
  const requests = dedupeImessageAppCardRequests(
    buildImessageAppCardRequests({
      policyIds: shouldCreatePolicyAppCards
        ? args.relevantPolicyIds.slice(0, 3)
        : [],
      artifacts: args.artifacts,
      policyChangeCaseId: args.policyChangeCaseId,
      usedTools: args.usedTools,
    }),
  );
  const appCards: ImessageAppCard[] = [];

  for (const request of requests) {
    try {
      const link = await ctx.runMutation(internal.appCardLinks.createInternal, {
        ...request.createArgs,
        sourceThreadId: args.threadId,
        sourceThreadMessageId: args.sourceThreadMessageId,
        createdByUserId: args.createdByUserId,
      });
      if (link.url) appCards.push({ ...request.card, url: link.url });
    } catch (err) {
      console.warn(`[imessage] Failed to create app card ${request.key}:`, err);
    }
  }

  return appCards;
}
