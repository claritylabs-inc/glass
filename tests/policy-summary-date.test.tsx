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
});
