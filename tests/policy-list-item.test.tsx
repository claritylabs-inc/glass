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
});
