import type { Id } from "../_generated/dataModel";

export function resolveLegacyDeliveryOwner(input: {
  deliveryOwnerOrgId?: Id<"organizations">;
  clientOrgId?: Id<"organizations">;
  brokerOrgId?: Id<"organizations">;
}) {
  return input.deliveryOwnerOrgId ?? input.clientOrgId ?? input.brokerOrgId;
}
