import { describe, expect, it } from "vitest";
import {
  certificateHolderDisplayBlock,
  holderSnapshot,
} from "../convex/lib/certificateIdentity";
import { certificateHolderActionAddress } from "../components/certificates/certificate-workspace";

describe("certificate holder consistency helpers", () => {
  it("builds one canonical holder block for storage and PDF rendering", () => {
    const block = certificateHolderDisplayBlock({
      displayName: "Deeptrust Inc.",
      contactName: "Adyan Tanver",
      email: "adyan@claritylabs.inc",
      phone: "+1 415 555 0134",
      address: {
        line1: "123 Market Street",
        line2: "Suite 400",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
      },
    });

    expect(block).toBe([
      "Deeptrust Inc.",
      "Attn: Adyan Tanver",
      "Email: adyan@claritylabs.inc",
      "Phone: +1 415 555 0134",
      "123 Market Street",
      "Suite 400",
      "San Francisco, CA 94105",
    ].join("\n"));
  });

  it("stores the same contact fields in holder snapshots", () => {
    expect(holderSnapshot({
      displayName: "Deeptrust Inc.",
      contactName: "Adyan Tanver",
      email: "adyan@claritylabs.inc",
      phone: "+1 415 555 0134",
      address: { formatted: "123 Market Street\nSan Francisco, CA 94105" },
    })).toEqual({
      displayName: "Deeptrust Inc.",
      contactName: "Adyan Tanver",
      email: "adyan@claritylabs.inc",
      phone: "+1 415 555 0134",
      address: { formatted: "123 Market Street\nSan Francisco, CA 94105" },
    });
  });

  it("preserves every line of a formatted-only address in an edit draft", () => {
    expect(certificateHolderActionAddress({
      displayName: "Deeptrust Inc.",
      address: {
        formatted: "123 Market Street\nSuite 400\nSan Francisco, CA 94105\nUnited States",
      },
    })).toEqual({
      addressLine1: "123 Market Street",
      addressLine2: "Suite 400, San Francisco, CA 94105, United States",
      city: undefined,
      state: undefined,
      postalCode: undefined,
      country: undefined,
    });
  });
});
