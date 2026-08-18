import { internal } from "../_generated/api";
import type { Id, TableNames } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { MAX_POLICY_CARDS_PER_TURN } from "./agentPolicyPresentation";

export type ImessageAppCard = {
  url: string;
  title?: string;
  subtitle?: string;
  summary?: string;
};

export type ImessageAppCardCreateArgs = {
  kind: "policy" | "certificate";
  policyId?: Id<"policies">;
  certificateId?: Id<"certificates">;
  policyCertificateId?: Id<"policyCertificates">;
  certificateVersionId?: Id<"certificateVersions">;
  label?: string;
};

export type ImessageAppCardRequest = {
  key: string;
  createArgs: ImessageAppCardCreateArgs;
  card: Omit<ImessageAppCard, "url">;
};

type ToolArtifact = { type: string; data: unknown };

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
}): ImessageAppCardRequest[] {
  const requests: ImessageAppCardRequest[] = args.policyIds
    .slice(0, MAX_POLICY_CARDS_PER_TURN)
    .map(policyCardRequest);

  for (const artifact of args.artifacts) {
    const data = objectRecord(artifact.data);
    if (!data) continue;

    if (artifact.type === "certificate_result") {
      const request = certificateCardRequest(data);
      if (request) requests.push(request);
    }

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
    threadId: Id<"threads">;
    sourceThreadMessageId?: Id<"threadMessages">;
    createdByUserId: Id<"users">;
    presentedPolicyIds: Id<"policies">[];
    artifacts: ToolArtifact[];
  },
): Promise<ImessageAppCard[]> {
  const requests = dedupeImessageAppCardRequests(
    buildImessageAppCardRequests({
      policyIds: args.presentedPolicyIds,
      artifacts: args.artifacts,
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
