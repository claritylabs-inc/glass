import { describe, expect, it } from "vitest";
import {
  carrierIdentityResearchName,
  carrierIdentityResearchNames,
  groundCarrierIdentitySelection,
  isPrimaryCarrierWebsiteCandidate,
  normalizeCarrierIdentityName,
  verifiedCarrierPublicName,
} from "./carrierIdentityEnrichment";

describe("carrier identity enrichment", () => {
  it("normalizes legal carrier names for shared cache lookup", () => {
    expect(normalizeCarrierIdentityName("Markel American Insurance Co.")).toBe(
      "markel american insurance co",
    );
  });

  it("researches the complete source-backed Lloyd's designation", () => {
    const identity = {
      displayName: "Tokio Marine Kiln",
      sourceName:
        "Lloyd's Underwriters led by: Tokio Marine Kiln, Syndicate No. 0510 KLN and Syndicate No. 1880 KLN, under contract number PG109C/26-PC(L)",
      legalEntities: [],
      legalEntityRelationship: "and" as const,
      sourceNodeIds: ["carrier"],
      sourceSpanIds: ["carrier-span"],
    };

    expect(carrierIdentityResearchName(identity, ["Tokio Marine Kiln"]))
      .toContain("Syndicate No. 1880 KLN");
    expect(carrierIdentityResearchNames(identity, ["Tokio Marine Kiln"]))
      .toEqual([
        identity.sourceName,
        "Tokio Marine Kiln",
      ]);
  });

  it("keeps a composite source designation as the canonical cache identity", () => {
    const sourceName =
      "Entity A Insurance Company and Entity B Insurance Company";
    const identity = {
      displayName: sourceName,
      sourceName,
      legalEntities: [
        {
          name: "Entity A Insurance Company",
          sourceNodeIds: ["carrier-a"],
          sourceSpanIds: ["span-carrier-a"],
        },
        {
          name: "Entity B Insurance Company",
          sourceNodeIds: ["carrier-b"],
          sourceSpanIds: ["span-carrier-b"],
        },
      ],
      legalEntityRelationship: "and" as const,
      sourceNodeIds: ["carrier-a", "carrier-b"],
      sourceSpanIds: ["span-carrier-a", "span-carrier-b"],
    };

    expect(carrierIdentityResearchName(identity)).toBe(sourceName);
    expect(carrierIdentityResearchNames(identity)).toEqual([
      sourceName,
      "Entity A Insurance Company",
      "Entity B Insurance Company",
    ]);
  });

  it("rejects login and redirect pages without judging carrier identity", () => {
    expect(
      isPrimaryCarrierWebsiteCandidate({
        website: "https://account.markelamerican.com/",
        title: "Log On",
      }),
    ).toBe(false);
    expect(
      isPrimaryCarrierWebsiteCandidate({
        website: "https://www.allianz.com/redirect",
        title: "Redirecting | Allianz",
      }),
    ).toBe(false);
    expect(
      isPrimaryCarrierWebsiteCandidate({
        website: "https://www.zurichcanada.com/en-ca",
        title: "Zurich Canada | Insurance and risk management",
      }),
    ).toBe(true);
  });

  it("grounds the model-selected Zurich Canada public name without word-agreement heuristics", () => {
    const zurichSite = {
      website: "https://www.zurichcanada.com/en-ca",
      title: "Zurich Canada | Insurance and risk management",
      siteName: "Zurich Canada",
      identityEvidence:
        "This site is owned and operated by Zurich Insurance Company Ltd (Canadian Branch).",
    };

    expect(isPrimaryCarrierWebsiteCandidate(zurichSite)).toBe(true);
    expect(verifiedCarrierPublicName(zurichSite, "Zurich Canada")).toBe(
      "Zurich Canada",
    );
    expect(
      groundCarrierIdentitySelection(
        {
          candidateIndex: 0,
          officialSite: true,
          publicName: "Zurich Canada",
          nameRelationship: "same_legal_entity",
          confidence: "high",
          reason:
            "The first-party evidence connects the Canadian branch legal name to Zurich Canada.",
        },
        [zurichSite],
      ),
    ).toEqual({
      candidateIndex: 0,
      publicName: "Zurich Canada",
      nameRelationship: "same_legal_entity",
      confidence: "high",
    });
  });

  it("accepts a public trading name only when visible on the selected site", () => {
    const libertySite = {
      website: "https://www.libertyspecialtymarkets.com/",
      title: "Financial Strength and Ratings - Liberty Specialty Markets",
      siteName: "Liberty Specialty Markets",
    };

    expect(
      verifiedCarrierPublicName(libertySite, "Liberty Specialty Markets"),
    ).toBe("Liberty Specialty Markets");
    expect(verifiedCarrierPublicName(libertySite, "Liberty Mutual")).toBe(
      undefined,
    );
  });
});
