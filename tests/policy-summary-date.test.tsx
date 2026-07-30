import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicySummary } from "@/app/policies/[id]/policy-summary";

describe("PolicySummary date display", () => {
  it("formats the policy period with the shared display-date convention", () => {
    const markup = renderToStaticMarkup(
      <PolicySummary
        policyNumber="DSLA1000035-00"
        effectiveDate="03/08/2026"
        expirationDate="03/08/2027"
        linesOfBusiness={["IM"]}
      />,
    );

    expect(markup).toContain("Mar 8, 2026 – Mar 8, 2027");
    expect(markup).not.toContain("03/08/2026");
  });

  it("uses the verified public carrier name in the policy overview", () => {
    const markup = renderToStaticMarkup(
      <PolicySummary
        carrier="Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472"
        carrierIdentity={{
          displayName: "Liberty Specialty Markets",
          sourceName:
            "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
          publicNameRelationship: "trading_name",
          legalEntities: [],
          legalEntityRelationship: "single",
          sourceNodeIds: [],
          sourceSpanIds: [],
          branding: {
            website: "https://libertyspecialtymarkets.example",
            accentColor: "#120C43",
            confidence: "high",
            sourceUrls: [],
            enrichmentVersion: 9,
            updatedAt: 1,
          },
        }}
        policyNumber="PRP0000104-01"
        linesOfBusiness={["OLIB"]}
      />,
    );

    expect(markup).toContain("Liberty Specialty Markets");
    expect(markup).not.toContain(
      "Lloyd&#x27;s Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
    );
  });
});
