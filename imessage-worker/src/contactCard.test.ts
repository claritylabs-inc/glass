import { describe, expect, it } from "vitest";

import { resolveContactCardPhone } from "./contactCard.js";

describe("resolveContactCardPhone", () => {
  it("prefers Spot contact-card phone configuration", () => {
    expect(
      resolveContactCardPhone({
        SPOT_IMESSAGE_CONTACT_PHONE: "+14165550100",
        NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER: "+14165550101",
        GLASS_IMESSAGE_CONTACT_PHONE: "+14165550102",
        NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER: "+14165550103",
      }),
    ).toBe("+14165550100");
  });

  it("falls back to legacy Glass contact-card phone configuration", () => {
    expect(
      resolveContactCardPhone({
        NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER: "+14165550103",
      }),
    ).toBe("+14165550103");
  });
});
