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
    expect(markup).toContain("Errors &amp; Omissions");
    expect(markup).toContain("Other Liability");
    expect(markup).not.toContain("Errors &amp; Omissions · Other Liability");
  });

  it("uses a restrained carrier-derived color, readable text, a favicon, and a softly masked pattern", () => {
    const markup = renderToStaticMarkup(
      <PolicyListItem
        carrier="Clearcover"
        carrierBrand={{
          accentColor: "#FDE047",
          iconUrl: "https://clearcover.example/favicon.png",
        }}
        policyNumber="CC-100"
        linesOfBusiness={["AUTOB"]}
        pipelineStatus="complete"
      />,
    );

    expect(markup).toContain("background-color:#5C5C3E");
    expect(markup).toContain("color:#FFFFFF");
    expect(markup).toContain("repeating-");
    expect(markup).toContain("radial-gradient(ellipse at 100% 100%");
    expect(markup).toContain("https://clearcover.example/favicon.png");
    expect(markup).not.toContain("uppercase");
    expect(markup).not.toContain("inset-x-0 top-0 h-1");
  });
});
