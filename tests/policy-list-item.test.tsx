import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyListItem } from "../components/policy-list-item";

describe("PolicyListItem", () => {
  it("renders canonical display dates for differently formatted stored values", () => {
    const numeric = renderToStaticMarkup(
      <PolicyListItem
        carrier="Highland Risk Services"
        policyNumber="NWC-TEC-3110-26-01"
        effectiveDate="03/15/2026"
        expirationDate="03/15/2027"
        pipelineStatus="complete"
      />,
    );
    const named = renderToStaticMarkup(
      <PolicyListItem
        carrier="Diesel Insurance Solutions Inc"
        policyNumber="DSLA1000035-00"
        effectiveDate="Mar 08 2026"
        expirationDate="Mar 08 2027"
        pipelineStatus="complete"
      />,
    );

    expect(numeric).toContain("Mar 15, 2026 – Mar 15, 2027");
    expect(named).toContain("Mar 8, 2026 – Mar 8, 2027");
  });

  it("keeps continuous policy terms open-ended", () => {
    const markup = renderToStaticMarkup(
      <PolicyListItem
        carrier="Continuous Carrier"
        policyNumber="CONTINUOUS-100"
        effectiveDate="07/28/2026"
        expirationDate="07/28/2027"
        policyTermType="continuous"
        pipelineStatus="complete"
      />,
    );

    expect(markup).toContain("Jul 28, 2026 — Until Cancelled");
    expect(markup).not.toContain("Jul 28, 2027");
  });

  it("renders each product line separately instead of joining them with dots", () => {
    const markup = renderToStaticMarkup(
      <PolicyListItem
        carrier="Northwoods Continental"
        policyNumber="NWC-100"
        linesOfBusiness={["EO", "OLIB"]}
        pipelineStatus="complete"
      />,
    );

    expect(markup).toContain("<li");
    expect(markup).toContain("Errors and Omissions");
    expect(markup).toContain("Other Liability");
    expect(markup).not.toContain("Errors and Omissions · Other Liability");
  });

  it("uses a restrained carrier-derived color, readable text, a favicon, and a softly masked pattern", () => {
    const markup = renderToStaticMarkup(
      <PolicyListItem
        carrier="Clearcover"
        carrierIdentity={{
          displayName: "Clearcover",
          legalEntities: [],
          legalEntityRelationship: "single",
          sourceNodeIds: [],
          sourceSpanIds: [],
          branding: {
            website: "https://clearcover.example",
            accentColor: "#FDE047",
            iconUrl: "https://clearcover.example/favicon.png",
            confidence: "high",
            sourceUrls: [],
            enrichmentVersion: 9,
            updatedAt: 1,
          },
        }}
        policyNumber="CC-100"
        linesOfBusiness={["AUTOB"]}
        pipelineStatus="complete"
      />,
    );

    expect(markup).toContain("background-color:#928841");
    expect(markup).toContain("color:#FFFFFF");
    expect(markup).toContain("repeating-");
    expect(markup).toContain("radial-gradient(ellipse at 100% 100%");
    expect(markup).toContain("https://clearcover.example/favicon.png");
    expect(markup).not.toContain("uppercase");
    expect(markup).not.toContain("inset-x-0 top-0 h-1");
  });

  it("uses the verified public brand instead of the extracted legal insurer on branded surfaces", () => {
    const markup = renderToStaticMarkup(
      <PolicyListItem
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
            accentColor: "#002D72",
            iconUrl:
              "https://libertyspecialtymarkets.example/favicon.png",
            confidence: "high",
            sourceUrls: [],
            enrichmentVersion: 9,
            updatedAt: 1,
          },
        }}
        policyNumber="PRP0000104-01"
        linesOfBusiness={["OLIB"]}
        pipelineStatus="complete"
      />,
    );

    expect(markup).toContain("Liberty Specialty Markets");
    expect(markup).not.toContain(
      "Lloyd&#x27;s Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
    );
  });

  it("uses insurer overrides and suppresses mismatched extracted branding", () => {
    const markup = renderToStaticMarkup(
      <PolicyListItem
        carrier="Extracted Carrier"
        carrierIdentity={{
          displayName: "Extracted Brand",
          sourceName: "Extracted Carrier",
          legalEntities: [{
            name: "Extracted Carrier",
            sourceNodeIds: [],
            sourceSpanIds: [],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: [],
          sourceSpanIds: [],
          branding: {
            website: "https://extracted.example",
            accentColor: "#002D72",
            iconUrl: "https://extracted.example/favicon.png",
            confidence: "high",
            sourceUrls: [],
            enrichmentVersion: 16,
            updatedAt: 1,
          },
        }}
        policyDetailOverrides={{
          insurer: {
            name: "Corrected Insurer",
          },
        }}
        policyNumber="OVERRIDE-100"
        linesOfBusiness={["CGL"]}
        pipelineStatus="complete"
      />,
    );

    expect(markup).toContain("Corrected Insurer");
    expect(markup).not.toContain("Extracted Brand");
    expect(markup).not.toContain("https://extracted.example/favicon.png");
  });
});
