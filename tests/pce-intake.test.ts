import { describe, expect, it } from "vitest";
import { evaluatePceIntake } from "../convex/lib/pceIntake";

describe("PCE intake guard", () => {
  it("blocks certificate-holder-only COI requests", () => {
    const decision = evaluatePceIntake({
      requestKind: "certificate_holder_only",
      requestText: "Issue the COI with Clarity Labs Inc. as the certificate holder.",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.kind).toBe("certificate_holder_only");
    if (!decision.allowed) {
      expect(decision.message).toContain("certificate holder");
      expect(decision.message).not.toContain("PCE");
      expect(decision.message).not.toContain("not a policy change");
    }
  });

  it("does not treat certificate holder wording as PCE without an endorsement request", () => {
    const decision = evaluatePceIntake({
      requestKind: "certificate_endorsement_request",
      requestText: "Please update the certificate holder to Clarity Labs Inc. and send the COI.",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.kind).toBe("certificate_holder_only");
    if (!decision.allowed) {
      expect(decision.message).not.toContain("PCE");
      expect(decision.message).not.toContain("not a policy change");
    }
  });

  it("allows explicit policy-record endorsement requests", () => {
    const decision = evaluatePceIntake({
      requestKind: "additional_insured_change",
      requestText: "Add Clarity Labs Inc. as an additional insured by endorsement.",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.kind).toBe("additional_insured_change");
  });

  it("infers named-insured changes when no kind is supplied", () => {
    const decision = evaluatePceIntake({
      requestText: "Change the named insured on the E&O policy to Clarity Labs Inc.",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.kind).toBe("named_insured_change");
  });
});
