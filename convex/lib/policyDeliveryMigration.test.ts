import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { resolveLegacyDeliveryOwner } from "./policyDeliveryMigration";

const clientOrgId = "client" as Id<"organizations">;
const brokerOrgId = "broker" as Id<"organizations">;

describe("policy delivery owner migration", () => {
  test("preserves an existing owner and assigns client-specific rows to the client", () => {
    expect(
      resolveLegacyDeliveryOwner({
        deliveryOwnerOrgId: brokerOrgId,
        clientOrgId,
        brokerOrgId,
      }),
    ).toBe(brokerOrgId);
    expect(resolveLegacyDeliveryOwner({ clientOrgId, brokerOrgId })).toBe(
      clientOrgId,
    );
  });

  test("retains the broker as owner only for global legacy rows", () => {
    expect(resolveLegacyDeliveryOwner({ brokerOrgId })).toBe(brokerOrgId);
    expect(resolveLegacyDeliveryOwner({})).toBeUndefined();
  });
});
