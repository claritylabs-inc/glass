import { describe, expect, it } from "vitest";
import {
  carrierPublicNameHasAffinity,
  carrierWebsiteCandidateHasAffinity,
  carrierIdentityResearchName,
  carrierIdentityResearchNames,
  fallbackCarrierWebsiteIndex,
  firstPartyCarrierPublicIdentity,
  normalizeCarrierIdentityName,
  verifiedCarrierNameRelationship,
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

  it("falls back to the matching official domain when model selection fails", () => {
    const candidates = [
      {
        website: "https://www.dnb.com/",
        title: "Markel American Insurance Company profile",
      },
      {
        website: "https://www.markel.com/",
        title: "Specialty Insurance | Markel",
      },
      {
        website: "https://account.markelamerican.com/",
        title: "Log On",
      },
    ];

    expect(
      fallbackCarrierWebsiteIndex(
        "Markel American Insurance Company",
        candidates,
      ),
    ).toBe(1);
    expect(
      fallbackCarrierWebsiteIndex("HDI Global Specialty SE", [
        { website: "https://www.hdi.global/", title: "HDI Global" },
      ]),
    ).toBe(0);
  });

  it("does not accept a directory based on title text alone", () => {
    expect(
      fallbackCarrierWebsiteIndex("Markel American Insurance Company", [
        {
          website: "https://www.dnb.com/",
          title: "Markel American Insurance Company profile",
        },
      ]),
    ).toBe(-1);
  });

  it("rejects a generic Allianz redirect page", () => {
    expect(
      fallbackCarrierWebsiteIndex("Allianz Global Assistance", [
        {
          website: "https://www.allianz.com/redirect",
          title: "Redirecting | Allianz",
        },
        {
          website: "https://www.allianz-assistance.ca/",
          title: "Allianz Global Assistance Canada",
        },
      ]),
    ).toBe(1);
  });

  it("does not conflate similarly named insurance businesses", () => {
    expect(
      fallbackCarrierWebsiteIndex("Northwoods Continental Insurance Company", [
        {
          website: "https://www.northwoodsins.com/",
          title: "Northwoods Insurance | Full-Service Insurance Brokerage",
        },
      ]),
    ).toBe(-1);
  });

  it("accepts an official domain built from the carrier name's acronym", () => {
    const carrierName =
      "Lloyd's Underwriters led by: Tokio Marine Kiln, Syndicate No. 0510 KLN and Syndicate No. 1880 KLN, under contract number PG109C/26-PC(L)";
    expect(
      fallbackCarrierWebsiteIndex(
        carrierName,
        [{ website: "https://www.tmkiln.com/", title: "Home" }],
      ),
    ).toBe(0);
    expect(
      carrierWebsiteCandidateHasAffinity(
        carrierName,
        { website: "https://www.tmkiln.com/", title: "Home" },
      ),
    ).toBe(true);
    expect(
      carrierWebsiteCandidateHasAffinity(
        carrierName,
        {
          website: "https://theinsurindex.com/",
          title: "Tokio Marine Kiln - Insurindex",
        },
      ),
    ).toBe(false);
  });

  it("matches the AXIS official domain without treating Lloyd's contract syntax as identity", () => {
    const carrierName =
      "Lloyd's Underwriters led by: Axis, Syndicate No. 1686, under contract no. B1306C503492600";
    const candidate = {
      website: "https://www.axiscapital.com/",
      title: "AXIS | Specialty Insurance and Reinsurance",
    };

    expect(carrierWebsiteCandidateHasAffinity(carrierName, candidate)).toBe(
      true,
    );
    expect(fallbackCarrierWebsiteIndex(carrierName, [candidate])).toBe(0);
  });

  it("accepts a public trading name only when it is visible on the selected official site", () => {
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

  it("records a trading-name relationship only when the retrieval evidence states it", () => {
    const carrier =
      "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472";
    const publicName = "Liberty Specialty Markets";

    expect(
      verifiedCarrierNameRelationship(
        carrier,
        publicName,
        "trading_name",
        "Liberty Specialty Markets is a trading name for Liberty Managing Agency Limited, for and on behalf of Syndicate 4472.",
      ),
    ).toBe("trading_name");
    expect(
      verifiedCarrierNameRelationship(
        carrier,
        publicName,
        "trading_name",
        "Liberty Specialty Markets provides specialty insurance.",
      ),
    ).toBe(undefined);
  });

  it("resolves Lloyd's Syndicate 4472 to Liberty Specialty Markets from first-party evidence without a model", () => {
    expect(
      firstPartyCarrierPublicIdentity(
        "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
        [
          {
            website:
              "https://www.libertyspecialtymarkets.com/about-us/our-strengths/financial-strength-and-rating",
            title:
              "Financial Strength and Ratings - Liberty Specialty Markets",
            siteName: "Liberty Specialty Markets",
            identityEvidence:
              "Liberty Specialty Markets is a trading name for Liberty Managing Agency Limited, for and on behalf of Syndicate 4472 at Lloyd's of London.",
          },
        ],
      ),
    ).toEqual({
      candidateIndex: 0,
      publicName: "Liberty Specialty Markets",
      nameRelationship: "trading_name",
      score: 10,
    });
  });

  it("rejects a third-party membership page as the Allianz public identity", () => {
    expect(
      firstPartyCarrierPublicIdentity(
        "Allianz Global Assistance",
        [{
          website: "https://www.satw.org/",
          title: "Society of American Travel Writers",
          siteName: "SATW",
          identityEvidence:
            "Allianz Global Assistance is proud to be a member of SATW.",
        }],
      ),
    ).toBeUndefined();
  });

  it("rejects an aggregator as the Tokio Marine Kiln public identity", () => {
    expect(
      firstPartyCarrierPublicIdentity(
        "Lloyd's Underwriters led by Tokio Marine Kiln Syndicate 0510",
        [{
          website: "https://theinsurindex.com/",
          title: "Insurindex",
          siteName: "Insurindex",
          identityEvidence:
            "Tokio Marine Kiln Syndicate 0510 operates under the Insurindex group brand.",
        }],
      ),
    ).toBeUndefined();
  });

  it("ranks an official carrier domain above a third-party mention", () => {
    expect(
      carrierWebsiteCandidateHasAffinity(
        "Allianz Global Assistance",
        {
          website: "https://www.allianz-assistance.ca/en_CA.html",
          title: "Allianz Global Assistance Canada",
        },
      ),
    ).toBe(true);
    expect(
      carrierWebsiteCandidateHasAffinity(
        "Allianz Global Assistance",
        {
          website: "https://www.satw.org/",
          title: "Allianz Global Assistance member profile",
        },
      ),
    ).toBe(false);
  });

  it("does not relabel an official carrier domain with an unrelated page name", () => {
    expect(
      carrierPublicNameHasAffinity(
        "Allianz Global Assistance",
        "Allianz Partners",
      ),
    ).toBe(true);
    expect(
      carrierPublicNameHasAffinity(
        "Allianz Global Assistance",
        "SATW",
      ),
    ).toBe(false);
    expect(
      carrierPublicNameHasAffinity(
        "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
        "Liberty Specialty Markets",
      ),
    ).toBe(true);
  });
});
