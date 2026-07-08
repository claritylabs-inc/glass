import { describe, expect, it } from "vitest";
import {
  certificateHolderIdentity,
  compareCertificateHolderIdentities,
  resolveDeterministicCertificateHolder,
  type CertificateHolderResolutionCandidate,
} from "../convex/lib/certificateHolderResolution";

function candidate(
  id: string,
  displayName: string,
  address?: Parameters<typeof certificateHolderIdentity>[0]["address"],
  issuedAt = 1,
): CertificateHolderResolutionCandidate<{ id: string }> {
  return {
    candidateId: id,
    identity: certificateHolderIdentity({ displayName, address }),
    issuedAt,
    createdAt: issuedAt,
    data: { id },
  };
}

describe("certificate holder identity resolution", () => {
  it("matches split suite and combined-suite address variants", () => {
    const requested = certificateHolderIdentity({
      displayName: "Polychain Capital Fund IV",
      address: {
        line1: "548 Market Street",
        line2: "Suite 64375",
        city: "San Francisco",
        state: "CA",
        postalCode: "94104",
      },
    });
    const existing = certificateHolderIdentity({
      displayName: "Polychain Capital Fund IV",
      address: {
        line1: "548 Market Street, Suite 64375",
        city: "San Francisco",
        state: "CA",
        postalCode: "94104",
      },
    });

    expect(compareCertificateHolderIdentities(requested, existing)).toMatchObject({
      verdict: "same_holder",
      confidence: "high",
    });
  });

  it("reuses the single current same-name holder when the request has no address", () => {
    const result = resolveDeterministicCertificateHolder(
      certificateHolderIdentity({ displayName: "Polychain Capital Fund IV" }),
      [
        candidate("existing", "Polychain Capital Fund IV", {
          line1: "548 Market Street",
          line2: "Suite 64375",
          city: "San Francisco",
          state: "CA",
          postalCode: "94104",
        }),
      ],
    );

    expect(result).toMatchObject({
      verdict: "same_holder",
      candidate: { candidateId: "existing" },
    });
  });

  it("reuses the latest same-name holder when duplicate candidates do not have conflicting addresses", () => {
    const result = resolveDeterministicCertificateHolder(
      certificateHolderIdentity({ displayName: "Polychain Capital Fund IV" }),
      [
        candidate("addressed", "Polychain Capital Fund IV", {
          line1: "548 Market Street",
          line2: "Suite 64375",
          city: "San Francisco",
          state: "CA",
          postalCode: "94104",
        }, 1),
        candidate("missing-address", "Polychain Capital Fund IV", undefined, 2),
      ],
    );

    expect(result).toMatchObject({
      verdict: "same_holder",
      candidate: { candidateId: "missing-address" },
    });
  });

  it("does not merge different suite or postal-code identities", () => {
    const requested = certificateHolderIdentity({
      displayName: "Polychain Capital Fund IV",
      address: {
        line1: "548 Market Street",
        line2: "Suite 64375",
        city: "San Francisco",
        state: "CA",
        postalCode: "94104",
      },
    });
    const otherSuite = certificateHolderIdentity({
      displayName: "Polychain Capital Fund IV",
      address: {
        line1: "548 Market Street",
        line2: "Suite 999",
        city: "San Francisco",
        state: "CA",
        postalCode: "94104",
      },
    });
    const otherPostalCode = certificateHolderIdentity({
      displayName: "Polychain Capital Fund IV",
      address: {
        line1: "548 Market Street",
        line2: "Suite 64375",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
      },
    });

    expect(compareCertificateHolderIdentities(requested, otherSuite)).toMatchObject({
      verdict: "different_holder",
    });
    expect(compareCertificateHolderIdentities(requested, otherPostalCode)).toMatchObject({
      verdict: "different_holder",
    });
  });

  it("returns ambiguous instead of generating when same-name candidates have conflicting addresses", () => {
    const result = resolveDeterministicCertificateHolder(
      certificateHolderIdentity({ displayName: "Polychain Capital Fund IV" }),
      [
        candidate("suite-a", "Polychain Capital Fund IV", {
          line1: "548 Market Street",
          line2: "Suite 64375",
          city: "San Francisco",
          state: "CA",
          postalCode: "94104",
        }),
        candidate("suite-b", "Polychain Capital Fund IV", {
          line1: "548 Market Street",
          line2: "Suite 999",
          city: "San Francisco",
          state: "CA",
          postalCode: "94104",
        }),
      ],
    );

    expect(result).toMatchObject({
      verdict: "ambiguous",
      reason: "Holder name matches multiple issued certificates with different addresses.",
    });
  });
});
