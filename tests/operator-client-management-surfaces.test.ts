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
    expect(brokers).toContain('setPanelMode("details")');
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

  it("keeps agent email address changes in the shared Channels owner", () => {
    const brokers = read("app/operator/brokers/page.tsx");
    const clients = read("app/operator/clients/operator-clients-page.tsx");
    const channels = read("components/settings/agent-channels-section.tsx");
    const operator = read("convex/operator.ts");
    const createClient = operator.slice(
      operator.indexOf("export const createSoloClient = action"),
      operator.indexOf("export const updateClientSettings = mutation"),
    );
    const updateBroker = operator.slice(
      operator.indexOf("export const updateBrokerSettings = mutation"),
      operator.indexOf("export const launchBroker = action"),
    );

    expect(brokers.match(/<Field label="Agent handle">/g)).toHaveLength(1);
    expect(clients).not.toContain("HandleAvailability");
    expect(clients).not.toContain("checkHandleAvailability");
    expect(createClient).not.toContain("agentHandle");
    expect(updateBroker).not.toContain("agentHandle");
    expect(channels).toContain("BrokerAgentChannelsSection");
    expect(channels).toContain("<AgentEmailAddressField");
  });

  it("owns client settings on a tabbed detail page", () => {
    const client = read("app/operator/clients/[clientOrgId]/page.tsx");
    const companyDetails = read(
      "app/operator/clients/[clientOrgId]/client-company-details.tsx",
    );

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
    expect(client).toContain(
      'aria-label="Company details and insurance profile"',
    );
    expect(client).toContain('<OperationalPanelBody className="space-y-4">');
    expect(companyDetails).not.toContain("OperationalPanel");
    expect(client).not.toContain("Login and activation email");
    expect(client).toContain('aria-labelledby="client-identity-title"');
    expect(client).toContain('breadcrumbDetail={client?.name ?? "Client"}');
    expect(client).not.toContain('title="Agent address"');
    expect(client).not.toContain("checkHandleAvailability");
    expect(client).not.toContain("agentHandle:");
    expect(client).not.toContain('title="Primary contact"');
    expect(client).not.toContain("checkUserPhoneAvailability");
    expect(client).not.toContain("primaryContactName:");
    expect(client).not.toContain("primaryContactEmail:");
    expect(client).not.toContain("primaryContactPhone:");
    expect(client).not.toContain("showPanelDescriptions");
  });

  it("sends client activation emails from admin rows on the Team tab", () => {
    const client = read("app/operator/clients/[clientOrgId]/page.tsx");
    const team = read("components/settings/team-section.tsx");

    expect(client).toContain('activeTab === "overview"');
    expect(client).toContain('activeTab === "team"');
    expect(client).toContain("inviteOpen={teamInviteOpen}");
    expect(client).toContain("onInviteOpenChange={setTeamInviteOpen}");
    expect(client).toContain("showInviteAction={false}");
    expect(team).toContain("controlledInviteOpen ?? uncontrolledInviteOpen");
    expect(team).toContain("operatorClientOrgId && showInviteAction");
    expect(team).toContain("api.operator.launchSoloClient");
    expect(team).toContain('member.role === "admin"');
    expect(team).toContain('"Send activation"');
    expect(team).toContain('"Resend activation"');
    expect(team).toContain("adminUserId: member.userId");
  });

  it("separates global Slack infrastructure from client setup", () => {
    const operatorChannels = read("app/operator/channels/page.tsx");
    const clientChannels = read(
      "components/settings/agent-channels-section.tsx",
    );
    const slackConnectionFields = read(
      "components/settings/slack-connection-fields.tsx",
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
    expect(clientChannels).toContain('title="Agent email address"');
    expect(clientChannels).toContain(
      '<StatusTag tone="neutral">Read only</StatusTag>',
    );
    expect(clientChannels).not.toContain(
      "Changes apply to every client served by that broker.",
    );
    expect(clientChannels).toContain(
      "updateStandaloneAgentEmailHandleForOperator",
    );
    expect(clientChannels).toContain("BrokerAgentChannelsSection");
    expect(clientChannels).toContain("startSlackSetup");
    expect(clientChannels).toContain("Step {stepIndex + 1} of");
    expect(clientChannels).toContain("Skip for now");
    expect(clientChannels).toContain("Finish setup");
    expect(clientChannels).toContain("Reinstall");
    expect(clientChannels).toContain('<TabsList variant="pill">');
    expect(clientChannels).toContain('label="Disconnect Slack"');
    expect(clientChannels).toContain("iconOnly");
    expect(clientChannels).toContain(
      "<DialogTitle>Disconnect Slack</DialogTitle>",
    );
    expect(clientChannels).toContain("Retry invite");
    expect(clientChannels).toContain("Automatic posts begin after");
    expect(clientChannels).not.toContain("window.location.assign(url)");
    expect(operatorChannels).not.toContain("window.location.assign(url)");
    expect(clientChannels).not.toContain("getSlackHostStatus");
    expect(clientChannels).not.toContain("beginHost");
    expect(clientChannels).not.toContain("setOperatorSlackIdentity");
    expect(slackConnectionFields).toContain("Default channel");
    expect(slackConnectionFields).toContain("Active channels");
    expect(clientChannels).toContain("Client support channel");
    expect(clientChannels).toContain("Operators not added");
    expect(slackConnectionFields).toContain("leavePublicChannel");
    expect(slackConnectionFields).toContain("Remove Glass from #");
  });

  it("shows a pending service channel before the client connects", () => {
    const agentChannels = read("convex/agentChannels.ts");
    const overview = agentChannels.slice(
      agentChannels.indexOf("async function channelOverview"),
      agentChannels.indexOf("async function setupActorKind"),
    );

    expect(overview).toContain('withIndex("by_clientOrgId_and_status"');
    expect(overview.indexOf("const supportChannel")).toBeLessThan(
      overview.indexOf("const joinedChannels = connection"),
    );
    expect(overview).toContain("primaryChannel: supportChannel");
  });
});
