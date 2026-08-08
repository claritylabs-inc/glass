import { describe, expect, it } from "vitest";
import { getOperatorImpersonationReturnHref } from "./operator-navigation";

describe("operator navigation", () => {
  it("returns to the impersonated client detail", () => {
    expect(
      getOperatorImpersonationReturnHref({
        targetOrgId: "client-123",
        targetOrgType: "client",
      }),
    ).toBe("/operator/clients/client-123");
  });

  it("returns to the selected broker drawer", () => {
    expect(
      getOperatorImpersonationReturnHref({
        targetOrgId: "broker-456",
        targetOrgType: "broker",
      }),
    ).toBe("/operator/brokers?broker=broker-456");
  });

  it("falls back to the operator client home", () => {
    expect(getOperatorImpersonationReturnHref(null)).toBe("/operator");
  });
});
