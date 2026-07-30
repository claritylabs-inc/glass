"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { z } from "zod";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  CARRIER_IDENTITY_ENRICHMENT_VERSION,
  carrierIdentityResearchNames,
  carrierPublicNameHasAffinity,
  carrierWebsiteCandidateHasAffinity,
  fallbackCarrierWebsiteIndex,
  firstPartyCarrierPublicIdentity,
  isPrimaryCarrierWebsiteCandidate,
  normalizeCarrierIdentityName,
  preferredCarrierWebsiteIndex,
  verifiedCarrierNameRelationship,
  verifiedCarrierPublicName,
} from "../lib/carrierIdentityEnrichment";
import { generateObjectForOrg } from "../lib/models";
import {
  runWebRetrieval,
  type WebRetrievalSource,
} from "../lib/webRetrieval";
import {
  normalizePublicWebsiteUrl,
  readWebsiteFaviconSignals,
  readWebsiteBrandSignals,
} from "../lib/websiteBrand";
import {
  readCarrierIdentity,
  type CarrierPublicNameRelationship,
} from "../lib/carrierIdentity";

const DEFAULT_ACCENT = "#1E293B";
const MAX_CANDIDATE_SITES = 4;
const RETRY_DELAYS_MS = [30_000, 5 * 60_000];

const CarrierIdentitySelectionSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  publicName: z.string().min(1).max(120),
  nameRelationship: z.enum([
    "same_legal_entity",
    "trading_name",
    "parent_brand",
    "group_brand",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
});

type CarrierIdentityPolicy = Pick<
  Doc<"policies">,
  | "carrier"
  | "carrierIdentity"
  | "security"
  | "carrierLegalName"
  | "insurer"
>;

type CandidateSite = {
  website: string;
  title?: string;
  siteName?: string;
  identityEvidence?: string;
  primaryColor?: string;
  colorCandidates: string[];
};

type CarrierIdentityEnrichmentResult = {
  success: boolean;
  cached?: boolean;
  reason?: "not_found" | "missing_carrier" | "in_progress" | "lookup_failed";
};

function carrierNamesForPolicy(policy: CarrierIdentityPolicy) {
  const identity = readCarrierIdentity(policy.carrierIdentity);
  return carrierIdentityResearchNames(identity, [
    policy.carrier,
    policy.insurer?.legalName,
    policy.carrierLegalName,
    policy.security,
  ]);
}

type CandidateSeed = {
  url: string;
  title?: string;
  snippet?: string;
};

function candidateUrls(
  sources: WebRetrievalSource[],
  retrievalText: string,
  carrierName: string,
): CandidateSeed[] {
  const candidates = [
    ...sources.map((source) => ({
      url: source.url,
      title: source.title,
      snippet: source.snippet,
    })),
    ...Array.from(retrievalText.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)).map(
      (match) => ({ url: match[0] }),
    ),
  ];
  const seenUrls = new Set<string>();
  return candidates
    .flatMap((candidate): CandidateSeed[] => {
      try {
        const parsed = new URL(normalizePublicWebsiteUrl(candidate.url));
        parsed.hash = "";
        const normalizedUrl = parsed.toString();
        if (seenUrls.has(normalizedUrl)) return [];
        seenUrls.add(normalizedUrl);
        return [{ ...candidate, url: normalizedUrl }];
      } catch {
        return [];
      }
    })
    .sort((left, right) =>
      Number(
        carrierWebsiteCandidateHasAffinity(
          carrierName,
          { website: right.url, title: right.title },
        ),
      ) -
      Number(
        carrierWebsiteCandidateHasAffinity(
          carrierName,
          { website: left.url, title: left.title },
        ),
      )
    )
    .slice(0, MAX_CANDIDATE_SITES);
}

function boundedEvidence(parts: Array<string | undefined>) {
  const evidence = Array.from(
    new Set(
      parts
        .map((part) => part?.replace(/\s+/g, " ").trim())
        .filter((part): part is string => Boolean(part)),
    ),
  ).join("\n");
  return evidence.slice(0, 8_000) || undefined;
}

async function inspectCarrierCandidate(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  carrierName: string,
  seed: CandidateSeed,
): Promise<CandidateSite> {
  const [directSignals, extracted] = await Promise.all([
    readWebsiteBrandSignals(seed.url).catch(() => null),
    runWebRetrieval(ctx, orgId, {
      url: seed.url,
      goal: `Extract first-party evidence that connects ${carrierName} to the organization or brand represented by this site. Preserve exact legal, syndicate, trading-name, DBA, operating-name, parent, and group wording.`,
    }).catch(() => null),
  ]);
  return {
    website: directSignals?.website ?? seed.url,
    title: directSignals?.title ?? seed.title,
    siteName: directSignals?.siteName,
    identityEvidence: boundedEvidence([
      directSignals?.identityEvidence,
      seed.snippet,
      ...(extracted?.sources.map((source) => source.snippet) ?? []),
      extracted?.text,
    ]),
    primaryColor: directSignals?.primaryColor,
    colorCandidates: directSignals?.colorCandidates ?? [],
  };
}

async function applyCachedIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
  normalizedName: string,
) {
  const existing = await ctx.runQuery(
    internal.carrierIdentityCache.getByNormalizedNameInternal,
    { normalizedName },
  );
  if (
    !existing ||
    existing.enrichmentVersion !== CARRIER_IDENTITY_ENRICHMENT_VERSION
  ) {
    return { applied: false, identityChanged: false };
  }
  return await ctx.runMutation(
    internal.carrierIdentityCache.applyToPolicyInternal,
    {
      policyId,
      cacheEntryId: existing._id,
      normalizedName,
    },
  );
}

async function rescheduleChangedCarrierIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  await ctx.scheduler.runAfter(
    0,
    internal.actions.enrichCarrierIdentity.ensureInternal,
    { policyId },
  );
}

function reusableCacheSources(
  carrierName: string,
  cachedIdentities: Array<Doc<"carrierBrands"> | null>,
): WebRetrievalSource[] {
  return cachedIdentities.flatMap((cachedIdentity) => {
    if (!cachedIdentity || cachedIdentity.confidence === "low") return [];
    const sources: WebRetrievalSource[] = [
      {
        url: cachedIdentity.website,
        title: cachedIdentity.websiteTitle,
      },
      ...cachedIdentity.sourceUrls.map((url) => ({ url })),
    ];
    return sources.filter((source) =>
      carrierWebsiteCandidateHasAffinity(
        carrierName,
        { website: source.url, title: source.title },
      )
    );
  });
}

async function enrichPolicyCarrierIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
): Promise<CarrierIdentityEnrichmentResult> {
  const policy = await ctx.runQuery(internal.policies.getInternal, {
    id: policyId,
  });
  if (!policy?.orgId) return { success: false as const, reason: "not_found" };
  const identity = readCarrierIdentity(policy.carrierIdentity);
  if (
    identity?.branding?.enrichmentVersion ===
    CARRIER_IDENTITY_ENRICHMENT_VERSION
  ) {
    return { success: true as const, cached: true };
  }

  const carrierNames = carrierNamesForPolicy(policy);
  const carrierName = carrierNames[0];
  if (!carrierName) {
    await ctx.runMutation(
      internal.carrierIdentityCache.markPolicyFailedInternal,
      { policyId },
    );
    return { success: false as const, reason: "missing_carrier" };
  }
  const normalizedName = normalizeCarrierIdentityName(carrierName);
  const cachedResult = await applyCachedIdentity(
    ctx,
    policyId,
    normalizedName,
  );
  if (cachedResult.applied) {
    return { success: true as const, cached: true };
  }
  if (cachedResult.identityChanged) {
    await rescheduleChangedCarrierIdentity(ctx, policyId);
    return { success: false as const, reason: "in_progress" };
  }

  const attemptedAt = dayjs().valueOf();
  const attempt = await ctx.runMutation(
    internal.carrierIdentityCache.markPolicyPendingInternal,
    {
      policyId,
      attemptedAt,
      allowReady: true,
    },
  );
  if (attempt === 0) {
    return { success: false as const, reason: "in_progress" };
  }

  try {
    const cachedIdentity = await ctx.runQuery(
      internal.carrierIdentityCache.getByNormalizedNameInternal,
      { normalizedName },
    );
    const retrievals = await Promise.all(
      carrierNames.slice(0, 2).map((researchName) =>
        runWebRetrieval(ctx, policy.orgId!, {
          query: `"${researchName}" official insurer website trading name brand`,
          goal: "Find the insurer's official public website and any official statement connecting the extracted legal insurer, syndicate, or underwriting entity to its trading name, DBA, parent brand, or group brand. Prefer first-party evidence over brokers, directories, social profiles, and news coverage.",
          maxResults: MAX_CANDIDATE_SITES,
        })
      ),
    );
    const retrievalSources = retrievals.flatMap(
      (retrieval) => retrieval.sources,
    );
    const retrievalText = boundedEvidence(
      retrievals.map((retrieval) => retrieval.text),
    ) ?? "";
    const reusablePreviousSources = reusableCacheSources(
      carrierName,
      [cachedIdentity],
    );
    let sites = (
      await Promise.all(
        candidateUrls(
          [...reusablePreviousSources, ...retrievalSources],
          retrievalText,
          carrierName,
        ).map((seed) =>
          inspectCarrierCandidate(
            ctx,
            policy.orgId!,
            carrierName,
            seed,
          ),
        ),
      )
    );
    if (sites.length === 0) throw new Error("No candidate carrier websites");

    let firstPartyIdentity = firstPartyCarrierPublicIdentity(
      carrierName,
      sites,
    );
    let relationshipSourceUrls: string[] = [];
    if (
      firstPartyIdentity &&
      firstPartyIdentity.nameRelationship !== "trading_name" &&
      /\b(?:syndicate|managing agency|underwriters)\b/i.test(carrierName)
    ) {
      const firstPartySite = sites[firstPartyIdentity.candidateIndex];
      try {
        const hostname = new URL(firstPartySite.website).hostname;
        const relationshipRetrieval = await runWebRetrieval(
          ctx,
          policy.orgId,
          {
            query: `"${firstPartyIdentity.publicName}" "trading name"`,
            goal: `Find a first-party statement on ${hostname} that says whether ${firstPartyIdentity.publicName} is a trading name, DBA, or operating name for the extracted legal insurer or syndicate. Return the exact official page, not a directory or news story.`,
            allowedDomains: [hostname],
            maxResults: MAX_CANDIDATE_SITES,
          },
        );
        relationshipSourceUrls = relationshipRetrieval.sources.map(
          (source) => source.url,
        );
        const relationshipSites = (
          await Promise.all(
            candidateUrls(
              relationshipRetrieval.sources,
              relationshipRetrieval.text,
              carrierName,
            ).map((seed) =>
              inspectCarrierCandidate(
                ctx,
                policy.orgId!,
                carrierName,
                seed,
              ),
            ),
          )
        );
        const knownSites = new Set(sites.map((site) => site.website));
        sites = [
          ...sites,
          ...relationshipSites.filter(
            (site) => !knownSites.has(site.website),
          ),
        ];
        const strongerIdentity = firstPartyCarrierPublicIdentity(
          carrierName,
          sites,
        );
        if (strongerIdentity?.nameRelationship === "trading_name") {
          firstPartyIdentity = strongerIdentity;
        }
      } catch {
        // The initial verified identity remains valid when targeted evidence
        // retrieval is unavailable.
      }
    }
    let modelSelectedIndex = -1;
    let publicName = firstPartyIdentity?.publicName;
    let nameRelationship:
      | CarrierPublicNameRelationship
      | undefined = firstPartyIdentity?.nameRelationship;
    let confidence: "high" | "medium" = firstPartyIdentity
      ? "high"
      : "medium";
    if (!firstPartyIdentity) {
      try {
        const { output } = await generateObjectForOrg(
          ctx,
          policy.orgId,
          "classification",
          {
            schema: CarrierIdentitySelectionSchema,
            maxOutputTokens: 512,
            prompt: `Resolve the official public identity for this insurance carrier.

Carrier extracted from the policy: ${carrierName}

Candidate websites:
${JSON.stringify(
  sites.map((site, index) => ({ index, ...site })),
  null,
  2,
)}

Search evidence:
${retrievalText.slice(0, 8_000)}

Return:
- candidateIndex: the candidate that is the carrier's official website.
- publicName: the concise public-facing carrier or brand name visibly used by that official site.
- nameRelationship: "same_legal_entity" when publicName is merely the same entity's public form; "trading_name" only when first-party evidence says it is a trading name or DBA; "parent_brand" only when the carrier operates under that documented parent brand; or "group_brand" only when first-party evidence documents that group identity.
- confidence: high only when the public site explicitly belongs to this exact legal carrier or its clearly documented parent brand. Return low when the match relies only on a shared word in the name.

Keep the extracted legal name intact; do not shorten it into a guessed brand. Do not choose a login/account portal, broker, agency, directory, social network, news site, or similarly named unrelated company. publicName must appear in the selected site's siteName or title.`,
          },
        );
        if (
          sites[output.candidateIndex] &&
          output.confidence === "high" &&
          isPrimaryCarrierWebsiteCandidate(sites[output.candidateIndex])
        ) {
          const selectedSite = sites[output.candidateIndex];
          const verifiedPublicName = verifiedCarrierPublicName(
            selectedSite,
            output.publicName,
          );
          const verifiedRelationship = verifiedPublicName
            ? verifiedCarrierNameRelationship(
              carrierName,
              verifiedPublicName,
              output.nameRelationship,
              selectedSite.identityEvidence ?? "",
            )
            : undefined;
          if (
            verifiedPublicName &&
            verifiedRelationship &&
            carrierPublicNameHasAffinity(
              carrierName,
              verifiedPublicName,
            ) &&
            carrierWebsiteCandidateHasAffinity(
              carrierName,
              selectedSite,
              verifiedPublicName,
            )
          ) {
            modelSelectedIndex = output.candidateIndex;
            publicName = verifiedPublicName;
            nameRelationship = verifiedRelationship;
            confidence = output.confidence;
          }
        }
      } catch (error) {
        console.warn(
          "[carrier-identity] model selection failed; using site evidence",
          {
            policyId,
            carrierName,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    const domainSelectedIndex = fallbackCarrierWebsiteIndex(
      carrierName,
      sites,
    );
    const selectedIndex = preferredCarrierWebsiteIndex(
      firstPartyIdentity?.candidateIndex,
      modelSelectedIndex,
      domainSelectedIndex,
    );
    if (
      !firstPartyIdentity &&
      domainSelectedIndex >= 0 &&
      modelSelectedIndex < 0
    ) {
      publicName = undefined;
      nameRelationship = undefined;
      confidence = "medium";
    }
    const selected = sites[selectedIndex];
    if (!selected) {
      throw new Error("Carrier website could not be identified confidently");
    }
    const faviconSignals = await readWebsiteFaviconSignals(selected.website);
    const accentColor =
      selected.primaryColor ??
      faviconSignals.colorCandidates[0] ??
      selected.colorCandidates[0] ??
      DEFAULT_ACCENT;
    const iconStorageId = faviconSignals.favicon
      ? await ctx.storage.store(faviconSignals.favicon)
      : null;
    const website = normalizePublicWebsiteUrl(
      new URL(selected.website).origin,
    );
    const cacheEntryId = await ctx.runMutation(
      internal.carrierIdentityCache.upsertInternal,
      {
        normalizedName,
        carrierName,
        publicName,
        nameRelationship,
        website,
        websiteTitle: selected.title,
        iconStorageId: iconStorageId ?? undefined,
        accentColor,
        confidence,
        sourceUrls: Array.from(
          new Set([
            selected.website,
            ...relationshipSourceUrls,
            ...retrievalSources.map((source) => source.url),
          ]),
        ).slice(0, 5),
        enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
        updatedAt: dayjs().valueOf(),
      },
    );
    const applied = await ctx.runMutation(
      internal.carrierIdentityCache.applyToPolicyInternal,
      { policyId, cacheEntryId, normalizedName },
    );
    if (applied.identityChanged) {
      await rescheduleChangedCarrierIdentity(ctx, policyId);
      return { success: false as const, reason: "in_progress" };
    }
    return { success: applied.applied, cached: false };
  } catch (error) {
    console.warn("[carrier-identity] enrichment failed", {
      policyId,
      carrierName,
      error: error instanceof Error ? error.message : String(error),
    });
    const failureResult = await ctx.runMutation(
      internal.carrierIdentityCache.markPolicyFailedInternal,
      { policyId, normalizedName, attemptedAt },
    );
    if (failureResult.status === "identity_changed") {
      await rescheduleChangedCarrierIdentity(ctx, policyId);
      return { success: false as const, reason: "in_progress" };
    }
    if (failureResult.status === "ready") {
      return { success: true as const, cached: true };
    }
    if (failureResult.status === "superseded") {
      return { success: false as const, reason: "in_progress" };
    }
    const retryDelay = RETRY_DELAYS_MS[attempt - 1];
    if (
      failureResult.status === "failed" &&
      retryDelay !== undefined
    ) {
      await ctx.scheduler.runAfter(
        retryDelay,
        internal.actions.enrichCarrierIdentity.ensureInternal,
        { policyId },
      );
    }
    return { success: false as const, reason: "lookup_failed" };
  }
}

export const ensureInternal = internalAction({
  args: { policyId: v.id("policies") },
  returns: v.any(),
  handler: async (ctx, args): Promise<CarrierIdentityEnrichmentResult> => {
    return await enrichPolicyCarrierIdentity(ctx, args.policyId);
  },
});
