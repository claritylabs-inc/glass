import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(__dirname, "..", path), "utf8");
}

describe("policy delivery automation surfaces", () => {
  it("has durable settings, rules, jobs, and attempts tables", () => {
    const schema = read("convex/schema.ts");
    expect(schema).toContain("policyDeliverySettings: defineTable");
    expect(schema).toContain("policyDeliveryRules: defineTable");
    expect(schema).toContain("policyDeliveryJobs: defineTable");
    expect(schema).toContain("policyDeliveryAttempts: defineTable");
    expect(schema).toContain("deliveryContactKey: v.optional(v.string())");
  });

  it("runs delivery after policy extraction and endorsement append", () => {
    const extraction = read("convex/actions/policyExtraction.ts");
    const changes = read("convex/policyChanges.ts");
    expect(extraction).toContain("policyDelivery.enqueueInternal");
    expect(extraction).toContain('sourceKind: "policy"');
    expect(changes).toContain("policyDelivery.enqueueInternal");
    expect(changes).toContain('sourceKind: "endorsement"');
  });

  it("does not send the old broker-upload notification before extraction", () => {
    const policies = read("convex/policies.ts");
    const createBrokerUpload = policies.slice(
      policies.indexOf("export const createBrokerUpload"),
      policies.indexOf("export const listForBroker"),
    );
    expect(createBrokerUpload).not.toContain("policy_delivered_by_broker");
    expect(createBrokerUpload).not.toContain("quote_delivered_by_broker");
  });

  it("adds broker UI for settings, overrides, and delivery queue", () => {
    expect(read("app/settings/page.tsx")).toContain("PolicyDeliverySection");
    expect(read("app/clients/[clientOrgId]/settings/page.tsx")).toContain("PolicyDeliverySection");
    expect(read("app/deliveries/page.tsx")).toContain("policyDelivery.listQueue");
    expect(read("components/app-sidebar/nav-config.tsx")).toContain('href: "/deliveries"');
  });
});
