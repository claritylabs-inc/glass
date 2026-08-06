import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(__dirname, "..", path), "utf8");
}

describe("operator client management surfaces", () => {
  it("keeps the client list drawer as a compact preview", () => {
    const clients = read("app/operator/clients/page.tsx");

    expect(clients).toContain("OperationalLabelValueList");
    expect(clients).toContain("Manage client");
    expect(clients).not.toContain("FeatureFlagToggleRow");
    expect(clients).not.toContain("AgentChannelsSection");
    expect(clients).not.toContain("updateClientSettings");
  });

  it("owns client settings on a tabbed detail page", () => {
    const client = read("app/operator/clients/[clientOrgId]/page.tsx");

    expect(client).toContain('{ id: "overview", label: "Overview" }');
    expect(client).toContain('{ id: "features", label: "Beta features" }');
    expect(client).toContain('{ id: "channels", label: "Agent channels" }');
    expect(client).toContain("useLocalFirstAutoSave");
    expect(client).toContain("FeatureFlagToggleRow");
    expect(client).toContain("AgentChannelsSection");
  });

  it("separates global Slack infrastructure from client setup", () => {
    const operatorChannels = read("app/operator/channels/page.tsx");
    const clientChannels = read(
      "components/settings/agent-channels-section.tsx",
    );
    const sidebar = read("app/operator/operator-sidebar.tsx");

    expect(operatorChannels).toContain("getSlackHostStatus");
    expect(operatorChannels).toContain("beginHost");
    expect(operatorChannels).toContain("setOperatorSlackIdentity");
    expect(sidebar).toContain('href="/operator/channels"');
    expect(clientChannels).toContain('title="Service channel invitation"');
    expect(clientChannels).not.toContain("getSlackHostStatus");
    expect(clientChannels).not.toContain("beginHost");
    expect(clientChannels).not.toContain("setOperatorSlackIdentity");
  });

  it("shows a pending service channel before the client connects", () => {
    const agentChannels = read("convex/agentChannels.ts");
    const overview = agentChannels.slice(
      agentChannels.indexOf("async function channelOverview"),
      agentChannels.indexOf("async function setupActorKind"),
    );

    expect(overview).toContain('withIndex("by_clientOrgId_and_status"');
    expect(overview).not.toContain('withIndex("by_connectionId_and_status"');
  });
});
