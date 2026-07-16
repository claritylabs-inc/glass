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

  it("runs delivery after policy extraction without the removed policy-change module", () => {
    const extraction = read("convex/actions/policyExtraction.ts");
    expect(extraction).toContain("policyDelivery.enqueueInternal");
    expect(extraction).toContain('sourceKind: "policy"');
    expect(() => read("convex/policyChanges.ts")).toThrow();
  });

  it("does not send the old broker-upload notification before extraction", () => {
    const policies = read("convex/policies.ts");
    const createBrokerUpload = policies.slice(
      policies.indexOf("export const createBrokerUpload"),
      policies.indexOf("export const listForBroker"),
    );
    expect(createBrokerUpload).not.toContain("policy_delivered_by_broker");
  });

  it("adds broker UI for settings, overrides, and delivery queue", () => {
    expect(read("app/settings/page.tsx")).toContain("PolicyDeliverySection");
    expect(read("app/clients/[clientOrgId]/settings/page.tsx")).toContain("PolicyDeliverySection");
    expect(read("app/deliveries/page.tsx")).toContain("policyDelivery.listQueue");
    expect(read("components/app-sidebar/nav-config.tsx")).toContain('href: "/deliveries"');
  });

  it("separates client contact, agent email, and delivery settings", () => {
    const clientSettings = read("app/clients/[clientOrgId]/settings/page.tsx");
    const emailRouting = read(
      "components/settings/client-email-routing-section.tsx",
    );
    const delivery = read("components/settings/policy-delivery-section.tsx");

    expect(clientSettings).toContain('id: "broker", label: "Broker contact"');
    expect(clientSettings).toContain('id: "agent-email", label: "Agent email"');
    expect(clientSettings).toContain(
      'id: "policy-delivery", label: "Policy delivery"',
    );
    expect(clientSettings).toContain('searchParams.get("tab")');
    expect(emailRouting).toContain('title="Inbound email access"');
    expect(emailRouting).toContain('label: "Approved addresses"');
    expect(emailRouting).toContain('label: "Client team"');
    expect(emailRouting).toContain('label: "Client team and domains"');
    expect(delivery).toContain('title="Automatic policy delivery"');
    expect(delivery).toContain("Customize for this client");
    expect(delivery).toContain("Rules are checked in order");
  });

  it("keeps thread aliases internal for email delivery replies", () => {
    const delivery = read("convex/actions/policyDelivery.ts");
    const pending = read("convex/actions/sendPendingEmail.ts");
    const chat = read("convex/actions/processThreadChat.ts");

    expect(delivery).not.toContain("replyTo: thread?.threadEmail");
    expect(delivery).toContain("\"Message-ID\": outboundMessageId");
    expect(delivery).toContain("messageId: outboundMessageId");
    expect(pending).not.toContain("payload.reply_to = thread.threadEmail");
    expect(chat).not.toContain("thread?.threadEmail ?? emailIdentity.agentAddress");
    expect(chat).not.toContain("agentAddress: thread?.threadEmail");
  });
});
