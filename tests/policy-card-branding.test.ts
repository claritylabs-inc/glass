import { describe, expect, it } from "vitest";
import { tonePolicyCardColor } from "@/lib/policy-card-branding";

describe("policy card branding", () => {
  it("tones saturated website colors into a consistent dark palette", () => {
    expect(tonePolicyCardColor("#009C33")).toBe("#164939");
    expect(tonePolicyCardColor("#EE202E")).toBe("#582637");
    expect(tonePolicyCardColor("#DA532C")).toBe("#533537");
  });

  it("keeps the neutral fallback unchanged", () => {
    expect(tonePolicyCardColor()).toBe("#1E293B");
  });
});
