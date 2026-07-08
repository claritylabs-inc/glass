import { describe, expect, it } from "vitest";

import { selectCertificateForm } from "./select";

describe("selectCertificateForm", () => {
  it("honors explicit form hints", () => {
    expect(
      selectCertificateForm({
        linesOfBusiness: ["CGL"],
        formHint: "ACORD 28",
      }),
    ).toBe("acord28");
  });

  it("routes flood policies to ACORD 29", () => {
    expect(selectCertificateForm({ linesOfBusiness: ["FLOOD"] })).toBe(
      "acord29",
    );
  });

  it("uses evidence forms for property interest holders", () => {
    expect(
      selectCertificateForm({
        linesOfBusiness: ["PROPC"],
        holderRelationship: "mortgagee",
      }),
    ).toBe("acord28");
    expect(
      selectCertificateForm({
        linesOfBusiness: ["HOME"],
        holderRelationship: "loss_payee",
      }),
    ).toBe("acord27");
  });

  it("uses ACORD 24 for plain property certificates", () => {
    expect(selectCertificateForm({ linesOfBusiness: ["INMRC"] })).toBe(
      "acord24",
    );
  });

  it("routes marine, garage, and default liability forms", () => {
    expect(selectCertificateForm({ linesOfBusiness: ["COMAR"] })).toBe(
      "acord31",
    );
    expect(
      selectCertificateForm({
        linesOfBusiness: ["AUTOB"],
        operationalProfile: { operations: "auto repair garage" },
      }),
    ).toBe("acord30");
    expect(selectCertificateForm({ linesOfBusiness: ["CGL"] })).toBe(
      "acord25",
    );
  });
});
