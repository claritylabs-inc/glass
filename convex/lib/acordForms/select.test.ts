import { describe, expect, it } from "vitest";

import { selectCertificateForm } from "./select";

describe("selectCertificateForm", () => {
  it("honors explicit form hints", () => {
    expect(
      selectCertificateForm({
        policyTypes: ["general_liability"],
        formHint: "ACORD 28",
      }),
    ).toBe("acord28");
  });

  it("routes flood policies to ACORD 29", () => {
    expect(selectCertificateForm({ policyTypes: ["flood_nfip"] })).toBe(
      "acord29",
    );
    expect(selectCertificateForm({ policyTypes: ["flood_private"] })).toBe(
      "acord29",
    );
  });

  it("uses evidence forms for property interest holders", () => {
    expect(
      selectCertificateForm({
        policyTypes: ["commercial_property"],
        holderRelationship: "mortgagee",
      }),
    ).toBe("acord28");
    expect(
      selectCertificateForm({
        policyTypes: ["homeowners_ho3"],
        holderRelationship: "loss_payee",
      }),
    ).toBe("acord27");
  });

  it("routes commercial inland marine property forms to ACORD 31", () => {
    expect(selectCertificateForm({ policyTypes: ["builders_risk"] })).toBe(
      "acord31",
    );
  });

  it("routes marine, garage, and default liability forms", () => {
    expect(selectCertificateForm({ policyTypes: ["ocean_marine"] })).toBe(
      "acord31",
    );
    expect(
      selectCertificateForm({
        policyTypes: ["commercial_auto"],
        operationalProfile: { operations: "auto repair garage" },
      }),
    ).toBe("acord30");
    expect(selectCertificateForm({ policyTypes: ["general_liability"] })).toBe(
      "acord25",
    );
  });
});
