"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { z } from "zod";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  CARRIER_BRAND_ENRICHMENT_VERSION,
  fallbackCarrierWebsiteIndex,
  isPrimaryCarrierWebsiteCandidate,
  knownCarrierBrandName,
  normalizeCarrierBrandName,
} from "../lib/carrierBrand";
import { generateObjectForOrg } from "../lib/models";
import { runWebRetrieval } from "../lib/webRetrieval";
import {
  normalizePublicWebsiteUrl,
  readWebsiteBrandSignals,
  storeWebsiteFavicon,
} from "../lib/websiteBrand";

const DEFAULT_ACCENT = "#1E293B";
const MAX_CANDIDATE_SITES = 4;
const RETRY_DELAYS_MS = [30_000, 5 * 60_000];

const CarrierBrandSelectionSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  accentColor: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

type CarrierBrandPolicy = {
  _id: Id<"policies">;
  orgId?: Id<"organizations">;
  carrier?: string;
  security?: string;
  carrierLegalName?: string;
  insurer?: { legalName?: string };
  carrierBrandId?: Id<"carrierBrands">;
  carrierBrandStatus?: "pending" | "ready" | "failed";
};

type CandidateSite = {
  website: string;
  title?: string;
  colorCandidates: string[];
};

type CarrierBrandEnrichmentResult = {
  success: boolean;
  cached?: boolean;
  reason?: "not_found" | "missing_carrier" | "in_progress" | "lookup_failed";
};

function carrierNameForPolicy(policy: CarrierBrandPolicy) {
  return [
    policy.insurer?.legalName,
    policy.carrierLegalName,
    policy.carrier,
    policy.security,
  ]
    .map(knownCarrierBrandName)
    .find((name): name is string => Boolean(name));
}

function candidateUrls(sources: Array<{ url: string }>, retrievalText: string) {
  const urls = [
    ...sources.map((source) => source.url),
    ...Array.from(retrievalText.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)).map(
      (match) => match[0],
    ),
  ];
  const seenHosts = new Set<string>();
  return urls
    .flatMap((url) => {
      try {
        const parsed = new URL(normalizePublicWebsiteUrl(url));
        if (seenHosts.has(parsed.hostname)) return [];
        seenHosts.add(parsed.hostname);
        return [parsed.origin];
      } catch {
        return [];
      }
    })
    .slice(0, MAX_CANDIDATE_SITES);
}

function normalizedAccent(candidate: string, available: string[]) {
  const normalized = candidate.trim().toUpperCase();
  return available.includes(normalized)
    ? normalized
    : (available[0] ?? DEFAULT_ACCENT);
}

async function linkCachedBrand(
  ctx: ActionCtx,
  policyId: Id<"policies">,
  normalizedName: string,
) {
  const existing = await ctx.runQuery(
    internal.carrierBrands.getByNormalizedNameInternal,
    { normalizedName },
  );
  if (
    !existing ||
    existing.enrichmentVersion !== CARRIER_BRAND_ENRICHMENT_VERSION
  ) {
    return false;
  }
  return await ctx.runMutation(internal.carrierBrands.linkPolicyInternal, {
    policyId,
    carrierBrandId: existing._id,
    normalizedName,
  });
}

async function enrichPolicyCarrierBrand(
  ctx: ActionCtx,
  policyId: Id<"policies">,
): Promise<CarrierBrandEnrichmentResult> {
  const policy = (await ctx.runQuery(internal.policies.getInternal, {
    id: policyId,
  })) as CarrierBrandPolicy | null;
  if (!policy?.orgId) return { success: false as const, reason: "not_found" };

  const carrierName = carrierNameForPolicy(policy);
  if (!carrierName) {
    await ctx.runMutation(internal.carrierBrands.markPolicyFailedInternal, {
      policyId,
    });
    return { success: false as const, reason: "missing_carrier" };
  }
  const normalizedName = normalizeCarrierBrandName(carrierName);
  if (await linkCachedBrand(ctx, policyId, normalizedName)) {
    return { success: true as const, cached: true };
  }

  const attempt = (await ctx.runMutation(
    internal.carrierBrands.markPolicyPendingInternal,
    {
      policyId,
      attemptedAt: dayjs().valueOf(),
      allowReady: true,
    },
  )) as number;
  if (attempt === 0) {
    return { success: false as const, reason: "in_progress" };
  }

  try {
    const retrieval = await runWebRetrieval(ctx, policy.orgId, {
      query: `"${carrierName}" insurance company official website`,
      goal: "Find the insurance carrier's official corporate website. Prefer the carrier itself over brokers, directories, social profiles, and news coverage.",
      maxResults: MAX_CANDIDATE_SITES,
    });
    const sites = (
      await Promise.all(
        candidateUrls(retrieval.sources, retrieval.text).map(async (url) => {
          try {
            return await readWebsiteBrandSignals(url);
          } catch {
            return null;
          }
        }),
      )
    ).filter((site): site is CandidateSite => site !== null);
    if (sites.length === 0) throw new Error("No candidate carrier websites");

    let modelSelectedIndex = -1;
    let selectedAccent = DEFAULT_ACCENT;
    let confidence: "high" | "medium" = "medium";
    try {
      const { output } = await generateObjectForOrg(
        ctx,
        policy.orgId,
        "classification",
        {
          schema: CarrierBrandSelectionSchema,
          maxOutputTokens: 512,
          prompt: `Select the official website and card accent for this insurance carrier.

Carrier extracted from the policy: ${carrierName}

Candidate websites:
${JSON.stringify(
  sites.map((site, index) => ({ index, ...site })),
  null,
  2,
)}

Search evidence:
${retrieval.text.slice(0, 8_000)}

Return:
- candidateIndex: the candidate that is the carrier's official website.
- accentColor: exactly one color from that candidate's colorCandidates. Prefer the primary logo or wordmark accent over utility, link, status, or neutral colors. If its list is empty, return "${DEFAULT_ACCENT}".
- confidence: high only when the public site explicitly belongs to this exact legal carrier or its clearly documented parent brand. Return low when the match relies only on a shared word in the name.

Do not choose a login/account portal, broker, agency, directory, social network, news site, or similarly named unrelated company.`,
        },
      );
      if (
        sites[output.candidateIndex] &&
        output.confidence === "high" &&
        isPrimaryCarrierWebsiteCandidate(sites[output.candidateIndex])
      ) {
        modelSelectedIndex = output.candidateIndex;
        selectedAccent = output.accentColor;
        confidence = output.confidence;
      }
    } catch (error) {
      console.warn(
        "[carrier-brand] model selection failed; using site evidence",
        {
          policyId,
          carrierName,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const evidenceSelectedIndex = fallbackCarrierWebsiteIndex(
      carrierName,
      sites,
    );
    const selectedIndex =
      evidenceSelectedIndex >= 0 ? evidenceSelectedIndex : modelSelectedIndex;
    if (
      evidenceSelectedIndex >= 0 &&
      evidenceSelectedIndex !== modelSelectedIndex
    ) {
      selectedAccent = DEFAULT_ACCENT;
      confidence = "medium";
    }
    const selected = sites[selectedIndex];
    if (!selected) {
      throw new Error("Carrier website could not be identified confidently");
    }
    const accentColor = normalizedAccent(
      selectedAccent,
      selected.colorCandidates,
    );
    const iconStorageId = await storeWebsiteFavicon(ctx, selected.website);
    const carrierBrandId = (await ctx.runMutation(
      internal.carrierBrands.upsertInternal,
      {
        normalizedName,
        carrierName,
        website: selected.website,
        websiteTitle: selected.title,
        iconStorageId: iconStorageId ?? undefined,
        accentColor,
        confidence,
        sourceUrls: retrieval.sources.map((source) => source.url).slice(0, 5),
        enrichmentVersion: CARRIER_BRAND_ENRICHMENT_VERSION,
        updatedAt: dayjs().valueOf(),
      },
    )) as Id<"carrierBrands">;
    const linked = (await ctx.runMutation(
      internal.carrierBrands.linkPolicyInternal,
      { policyId, carrierBrandId, normalizedName },
    )) as boolean;
    return { success: linked, cached: false };
  } catch (error) {
    console.warn("[carrier-brand] enrichment failed", {
      policyId,
      carrierName,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.runMutation(internal.carrierBrands.markPolicyFailedInternal, {
      policyId,
    });
    const retryDelay = RETRY_DELAYS_MS[attempt - 1];
    if (retryDelay !== undefined) {
      await ctx.scheduler.runAfter(
        retryDelay,
        internal.actions.enrichCarrierBrand.ensureInternal,
        { policyId },
      );
    }
    return { success: false as const, reason: "lookup_failed" };
  }
}

export const ensure = action({
  args: { policyId: v.id("policies") },
  returns: v.any(),
  handler: async (ctx, args): Promise<CarrierBrandEnrichmentResult> => {
    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { success: false as const, reason: "not_found" };
    return await enrichPolicyCarrierBrand(ctx, args.policyId);
  },
});

export const ensureInternal = internalAction({
  args: { policyId: v.id("policies") },
  returns: v.any(),
  handler: async (ctx, args): Promise<CarrierBrandEnrichmentResult> => {
    return await enrichPolicyCarrierBrand(ctx, args.policyId);
  },
});
