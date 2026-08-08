import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(__dirname, "..", path), "utf8");
}

describe("operator client management surfaces", () => {
  it("uses clients as the operator home and keeps brokers addressable", () => {
    const home = read("app/operator/page.tsx");
    const brokers = read("app/operator/brokers/page.tsx");
    const sidebar = read("app/operator/operator-sidebar.tsx");

    expect(home).toContain(
      'import OperatorClientsPage from "./clients/operator-clients-page"',
    );
    expect(sidebar.indexOf('label="Clients"')).toBeLessThan(
      sidebar.indexOf('label="Brokers"'),
    );
    expect(sidebar).toContain('href="/operator/brokers"');
    expect(sidebar).toContain('href="/operator"');
    expect(brokers).toContain('searchParams.get("broker")');
    expect(brokers).toContain("setPanelMode(\"details\")");
  });

  it("keeps the client list drawer as a compact preview", () => {
    const clients = read("app/operator/clients/operator-clients-page.tsx");

    expect(clients).toContain("OperationalLabelValueList");
    expect(clients).toContain("Manage client");
    expect(clients).toContain(
      '<OperationalLabelValueList title="Client details">',
    );
    expect(clients).toContain(
      '<OperationalLabelValueList title="Agent channels">',
    );
    expect(clients).toContain('label="Active channels"');
    expect(clients).toContain('label="Email"');
    expect(clients).toContain('label="Slack"');
    expect(clients).not.toContain("AGENT_TEXT_NUMBER_DISPLAY");
    expect(clients).not.toContain("FeatureFlagToggleRow");
    expect(clients).not.toContain("AgentChannelsSection");
    expect(clients).not.toContain("updateClientSettings");
  });

  it("owns client settings on a tabbed detail page", () => {
    const client = read("app/operator/clients/[clientOrgId]/page.tsx");

    expect(client).toContain('{ id: "overview", label: "Overview" }');
    expect(client).toContain('{ id: "team", label: "Team" }');
    expect(client).toContain('{ id: "features", label: "Beta features" }');
    expect(client).toContain('{ id: "channels", label: "Agent channels" }');
    expect(client).toContain("useLocalFirstAutoSave");
    expect(client).toContain("FeatureFlagToggleRow");
    expect(client).toContain("AgentChannelsSection");
    expect(client).toContain("OrganizationInsuranceProfile");
    expect(client).toContain("TeamSection");
    expect(client).toContain("getClientSupportDetails");
    expect(client).toContain('aria-labelledby="client-identity-title"');
    expect(client).toContain('breadcrumbDetail={client?.name ?? "Client"}');
    expect(client).toContain(
      '<FormSection title="Agent address" divided={false}>',
    );
    expect(client).toContain(
      '<FormSection title="Primary contact" divided={false}>',
    );
    expect(client).not.toContain("showPanelDescriptions");
  });

  it("separates global Slack infrastructure from client setup", () => {
    const operatorChannels = read("app/operator/channels/page.tsx");
    const clientChannels = read(
      "components/settings/agent-channels-section.tsx",
    );
    const sidebar = read("app/operator/operator-sidebar.tsx");

    expect(operatorChannels).toContain("getSlackHostStatus");
    expect(operatorChannels).toContain("listOperatorSlackIdentities");
    expect(operatorChannels).toContain("beginHost");
    expect(operatorChannels).toContain("openOAuthTab");
    expect(operatorChannels).toContain("setOperatorSlackIdentity");
    expect(operatorChannels).toContain("Connect workspace");
    expect(operatorChannels).toContain("Slack not enabled");
    expect(operatorChannels).toContain("Clarity workspace");
    expect(operatorChannels).toContain("Test mode");
    expect(operatorChannels).toContain("Slack workspace name");
    expect(operatorChannels).toContain("Slack team ID");
    expect(operatorChannels).toContain("Operator Slack identities");
    expect(operatorChannels).toContain("Other Glass operators");
    expect(operatorChannels).toContain("Slack member ID");
    expect(operatorChannels).toContain("How to find your member ID");
    expect(operatorChannels).toContain("Copy member ID");
    expect(operatorChannels).toContain("Save identity");
    expect(operatorChannels).toContain("Workspace mismatch");
    expect(operatorChannels).toContain(
      '<TabsTrigger value="slack">Slack</TabsTrigger>',
    );
    expect(operatorChannels).toContain('<TabsContent value="slack">');
    expect(operatorChannels).toContain("<SettingsDrawer");
    expect(operatorChannels).toContain("rightPanel={rightPanel}");
    expect(operatorChannels).toContain('className="space-y-3"');
    expect(operatorChannels).toContain("bg-popover px-4 py-3");
    expect(operatorChannels).not.toContain("SLACK_CLARITY_TEAM_ID");
    expect(operatorChannels).not.toContain(
      "Connect the Clarity workspace once",
    );
    expect(operatorChannels).not.toContain("host workspace fixture");
    expect(operatorChannels).not.toContain("max-w-4xl");
    expect(sidebar).toContain('href="/operator/channels"');
    expect(clientChannels).toContain("<SettingsDrawer");
    expect(clientChannels).toContain("openOAuthTab");
    expect(clientChannels).not.toContain("window.location.assign(url)");
    expect(operatorChannels).not.toContain("window.location.assign(url)");
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
