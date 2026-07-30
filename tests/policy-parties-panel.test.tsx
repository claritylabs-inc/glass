import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyPartiesPanel } from "../app/policies/[id]/policy-parties-panel";

describe("PolicyPartiesPanel", () => {
  it("renders the operating carrier and source-faithful legal entities", () => {
    const markup = renderToStaticMarkup(
      <PolicyPartiesPanel
        policy={{
          carrier: "Allianz Global Assistance",
          carrierIdentity: {
            displayName: "Allianz Global Assistance",
            operatingName: "Allianz Global Assistance",
            legalEntities: [
              {
                name: "CUMIS General Insurance Company",
                sourceNodeIds: ["carrier-identity"],
                sourceSpanIds: ["span-carrier-identity"],
              },
              {
                name: "AZGA Service Canada Inc.",
                sourceNodeIds: ["carrier-identity"],
                sourceSpanIds: ["span-carrier-identity"],
              },
            ],
            legalEntityRelationship: "and_or",
            sourceNodeIds: ["carrier-identity"],
            sourceSpanIds: ["span-carrier-identity"],
          },
          generalAgent: {
            agencyName: "ALLIANZ GLOBAL ASSISTANCE",
          },
          operationalProfile: {
            parties: [
              {
                role: "carrier",
                name: "Allianz Global Assistance",
              },
              {
                role: "insurer",
                name: "CUMIS General Insurance Company",
              },
              {
                role: "insurer",
                name: "AZGA Service Canada Inc.",
              },
              {
                role: "administrator",
                name: "ALLIANZ GLOBAL ASSISTANCE",
              },
            ],
          },
        }}
      />,
    );

    expect(markup).toContain("Carrier");
    expect(markup).toContain("Operating name");
    expect(markup).toContain("Allianz Global Assistance");
    expect(markup).toContain(
      "CUMIS General Insurance Company and/or AZGA Service Canada Inc.",
    );
    expect(markup).not.toContain("Legal relationship");
    expect(markup).not.toContain("General Agent");
  });
});
