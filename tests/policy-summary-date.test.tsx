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

  it("renders a continuous policy as active and until cancelled", () => {
    const markup = renderToStaticMarkup(
      <PolicySummary
        policyNumber="CONTINUOUS-100"
        effectiveDate="07/28/2026"
        expirationDate="01/01/2020"
        policyTermType="continuous"
        linesOfBusiness={["CGL"]}
      />,
    );

    expect(markup).toContain("Jul 28, 2026 — Until Cancelled");
    expect(markup).toContain(">Active<");
    expect(markup).not.toContain(">Expired<");
    expect(markup).not.toContain("Jan 1, 2020");
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

  it("gives broker-authored insurer overrides precedence over extracted branding", () => {
    const markup = renderToStaticMarkup(
      <PolicySummary
        carrier="Extracted Carrier"
        carrierDisplayName="Corrected Carrier"
        carrierIdentity={{
          displayName: "Extracted Carrier",
          sourceName: "Extracted Carrier Company",
          legalEntities: [{
            name: "Extracted Carrier Company",
            sourceNodeIds: [],
            sourceSpanIds: [],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: [],
          sourceSpanIds: [],
          branding: {
            website: "https://extracted.example",
            iconUrl: "https://extracted.example/favicon.png",
            accentColor: "#120C43",
            confidence: "high",
            sourceUrls: [],
            enrichmentVersion: 9,
            updatedAt: 1,
          },
        }}
        policyNumber="OVERRIDE-100"
        linesOfBusiness={["OLIB"]}
      />,
    );

    expect(markup).toContain("Corrected Carrier");
    expect(markup).not.toContain(">Extracted Carrier<");
    expect(markup).not.toContain("https://extracted.example/favicon.png");
  });
});
