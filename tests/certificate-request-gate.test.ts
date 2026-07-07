import { describe, expect, it } from "vitest";
import {
  evaluateCertificateRequestGate,
  inferCertificateEndorsements,
  isEvidenceGatedOnly,
} from "../convex/lib/certificateRequestGate";

describe("certificate request gate", () => {
  it("allows ordinary certificate holder requests without endorsement language", () => {
    const verdict = evaluateCertificateRequestGate({
      certificateHolder: "Acme Property Management\n123 Main St",
      policy: {
        summary: "Commercial general liability policy.",
      },
    });

    expect(verdict.status).toBe("allowed");
    expect(verdict.requiredChanges).toEqual([]);
  });

  it("infers explicit endorsement requests from structured selections and request text", () => {
    expect(
      inferCertificateEndorsements({
        requestText: "Please add the landlord as additional insured with waiver of subrogation.",
        requestedEndorsements: ["primary_non_contributory"],
      }),
    ).toEqual([
      "primary_non_contributory",
      "additional_insured",
      "waiver_of_subrogation",
    ]);
  });

  it("distinguishes evidence-gated endorsements from true policy changes", () => {
    expect(
      isEvidenceGatedOnly([
        "additional_insured",
        "waiver_of_subrogation",
        "primary_non_contributory",
        "loss_payee",
        "mortgagee",
      ]),
    ).toBe(true);
    expect(isEvidenceGatedOnly(["named_insured"])).toBe(false);
  });

  it("holds endorsement requests when no source-backed policy evidence is available", () => {
    const verdict = evaluateCertificateRequestGate({
      certificateHolder: "Acme Property Management",
      requestText: "Add Acme as additional insured.",
      requestedEndorsements: ["additional_insured"],
    });

    expect(verdict.status).toBe("held");
    if (verdict.status === "held") {
      expect(verdict.reasonCode).toBe("missing_policy_evidence");
      expect(verdict.requiredChanges).toEqual(["additional_insured"]);
    }
  });

  it("holds when requested endorsement support is not found in policy wording", () => {
    const verdict = evaluateCertificateRequestGate({
      requestText: "Add Acme as additional insured.",
      policy: {
        summary: "Business auto policy with hired and non-owned auto coverage.",
      },
      sourceSpans: [
        {
          spanId: "span-1",
          text: "Additional insured status applies only by endorsement and must be endorsed before it is shown on a certificate.",
          pageStart: 4,
        },
      ],
    });

    expect(verdict.status).toBe("held");
    if (verdict.status === "held") {
      expect(verdict.reasonCode).toBe("conflicting_policy_evidence");
      expect(verdict.evidence[0]?.sourceSpanIds).toEqual(["span-1"]);
    }
  });

  it("allows when policy wording supports every requested endorsement", () => {
    const verdict = evaluateCertificateRequestGate({
      requestText:
        "Issue certificate with additional insured and waiver of subrogation.",
      sourceSpans: [
        {
          spanId: "ai-blanket",
          sectionId: "CG 20 33",
          text: "Blanket additional insured status applies where required by written contract.",
        },
        {
          spanId: "wos-blanket",
          sectionId: "CG 24 04",
          text: "Transfer of rights of recovery against others is waived where required by written contract.",
        },
      ],
    });

    expect(verdict.status).toBe("allowed");
    expect(verdict.requiredChanges).toEqual([
      "additional_insured",
      "waiver_of_subrogation",
    ]);
    expect(verdict.evidence).toHaveLength(2);
  });
});
