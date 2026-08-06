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

  it("separates client contact, agent channels, and delivery settings", () => {
    const clientSettings = read("app/clients/[clientOrgId]/settings/page.tsx");
    const agentChannels = read("components/settings/agent-channels-section.tsx");
    const delivery = read("components/settings/policy-delivery-section.tsx");

    expect(clientSettings).toContain('id: "broker", label: "Broker contact"');
    expect(clientSettings).toContain('id: "agent-channels", label: "Agent channels"');
    expect(clientSettings).toContain(
      'id: "policy-delivery", label: "Policy delivery"',
    );
    expect(clientSettings).toContain('searchParams.get("tab")');
    expect(agentChannels).toContain('title="Channel access"');
    expect(agentChannels).toContain('title="Client Slack workspace"');
    expect(agentChannels).toMatch(/third-party Slack\s+Connect participants/);
    expect(delivery).toContain('title="Automatic policy delivery"');
    expect(delivery).toContain("Customize for this client");
    expect(delivery).toContain("Rules are checked in order");
    expect(read("app/deliveries/page.tsx")).toContain(
      'type DeliveryChannel = "email" | "imessage" | "slack"',
    );
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

  it("carries Slack through the shared COI source and attachment path", () => {
    const toolExecutors = read("convex/lib/agentToolExecutors.ts");
    const slackInbound = read("convex/actions/handleInboundSlack.ts");

    expect(toolExecutors).toContain(
      'type AgentToolSurface = "web" | "email" | "imessage" | "slack" | "mcp"',
    );
    expect(toolExecutors).toContain("return surface");
    for (const path of [
      "convex/actions/generateCoi.ts",
      "convex/certificates.ts",
      "convex/certificateLifecycle.ts",
    ]) {
      expect(read(path)).toContain('v.literal("slack")');
    }
    expect(slackInbound).toContain("response.attachments");
    expect(slackInbound).toContain("actions.sendSlack.send");
  });
});
