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

  it("owns client settings in the scoped per-client workspace", () => {
    const client = read("app/operator/clients/[clientOrgId]/page.tsx");
    const clientSidebar = read(
      "app/operator/clients/[clientOrgId]/operator-client-sidebar.tsx",
    );
    const settingsTabs = read(
      "app/operator/clients/[clientOrgId]/operator-client-tabs.tsx",
    );
    const companyDetails = read(
      "app/operator/clients/[clientOrgId]/client-company-details.tsx",
    );

    expect(clientSidebar).toContain('label="Overview"');
    expect(clientSidebar).toContain('label: "Policies"');
    expect(clientSidebar).toContain('label: "Compliance"');
    expect(clientSidebar).not.toContain('label: "Certificates"');
    expect(clientSidebar).toContain('label="Team"');
    expect(clientSidebar).toContain('label="Settings"');
    expect(clientSidebar).toContain('<SectionHeader label="Insurance"');
    expect(clientSidebar).toContain('<SectionHeader label="Settings"');
    expect(settingsTabs).toContain(
      '{ id: "features", label: "Beta features" }',
    );
    expect(settingsTabs).toContain(
      '{ id: "channels", label: "Agent channels" }',
    );
    expect(settingsTabs).toContain("OperatorClientSettingsTabs");
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
    expect(client).toContain('activeTab === "team"');
    expect(client).toContain('? "Settings"');
    expect(client).toContain("<OperatorClientSidebar");
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
    expect(team).toContain("member.isActivated");
    expect(team).toContain('<StatusTag tone="success">Active</StatusTag>');
    expect(team).toContain("adminUserId: member.userId");
  });

  it("keeps operator client sections in a grouped secondary sidebar", () => {
    const sidebar = read(
      "app/operator/clients/[clientOrgId]/operator-client-sidebar.tsx",
    );
    const policies = read(
      "app/operator/clients/[clientOrgId]/policies/page.tsx",
    );
    const policyWorkspace = read(
      "app/clients/[clientOrgId]/policies/managed-client-policy-workspace.tsx",
    );
    const compliance = read(
      "app/operator/clients/[clientOrgId]/compliance/page.tsx",
    );
    const certificates = read(
      "app/operator/clients/[clientOrgId]/certificates/page.tsx",
    );

    expect(sidebar).toContain('href="/operator"');
    expect(sidebar).toContain('label="Overview"');
    expect(sidebar).toContain('label: "Policies"');
    expect(sidebar).toContain('label: "Compliance"');
    expect(sidebar).not.toContain('label: "Certificates"');
    expect(sidebar).toContain('label="Team"');
    expect(sidebar).toContain('label="Settings"');
    expect(policies).toContain('<TabsList\n        variant="pill"');
    expect(policies).toContain('aria-label="Policy status"');
    expect(policies).toContain(
      '<div className="overflow-x-auto">{statusNavigation}</div>',
    );
    expect(policies).not.toContain("<Select");
    expect(policies).toContain("showStatusNavigation={false}");
    expect(policyWorkspace).toContain('policy.isDemo\n                          ? "demo"');
    expect(compliance).toContain(
      '<div className="overflow-x-auto">{toolbar}</div>',
    );
    expect(compliance).toContain("<OperatorCertificatesWorkspace");
    expect(compliance).not.toContain("OperatorClientTabs");
    expect(certificates).not.toContain("OperatorClientTabs");
    expect(certificates).toContain(
      "redirect(`/operator/clients/${clientOrgId}/compliance?tab=certificates`)",
    );
  });

  it("keeps the shared impersonation action on every operator client page", () => {
    const action = read(
      "app/operator/clients/[clientOrgId]/operator-client-impersonation-action.tsx",
    );
    const startHook = read("hooks/use-start-operator-impersonation.ts");
    const pages = [
      "app/operator/clients/[clientOrgId]/page.tsx",
      "app/operator/clients/[clientOrgId]/policies/page.tsx",
      "app/operator/clients/[clientOrgId]/policies/[id]/page.tsx",
      "app/operator/clients/[clientOrgId]/compliance/page.tsx",
    ].map(read);

    expect(action).toContain("useStartOperatorImpersonation");
    expect(action).toContain("useStopOperatorImpersonation");
    expect(action).toContain("UserRoundCog");
    expect(action).toContain("LogOut");
    expect(action).toContain('"Stop impersonating"');
    expect(action).toContain('"Impersonate"');
    expect(action).toContain('"Retry impersonation"');
    expect(action).toContain("expandLabel");
    expect(startHook).toContain("api.operator.startImpersonation");
    expect(startHook).toContain("useConvexConnectionState");
    expect(startHook).toContain("IMPERSONATION_ACK_TIMEOUT_MS");
    pages.forEach((page) => {
      expect(page).toContain("<OperatorClientImpersonationAction");
    });
  });

  it("orders policy actions by task frequency and consequence", () => {
    const detail = read("app/policies/[id]/policy-detail-body.tsx");
    const pdfButton = read("app/policies/[id]/policy-certificates-tab.tsx");
    const toolbarStart = detail.indexOf("onActions(\n      <>");
    const toolbarEnd = detail.indexOf(
      "return () => onActions(null)",
      toolbarStart,
    );
    const toolbar = detail.slice(toolbarStart, toolbarEnd);

    expect(toolbar.indexOf("<ViewPdfButton")).toBeLessThan(
      toolbar.indexOf("<RotateCw"),
    );
    expect(toolbar.indexOf("<RotateCw")).toBeLessThan(
      toolbar.indexOf("<Archive"),
    );
    expect(toolbar.indexOf("<Archive")).toBeLessThan(toolbar.indexOf("<Plus"));
    expect(toolbar.match(/expandLabel/g)).toHaveLength(3);
    expect(toolbar).toContain('variant="icon"');
    expect(toolbar).toContain("<RotateCw");
    expect(toolbar).toContain("<Archive");
    expect(toolbar).toContain("<Plus");
    expect(pdfButton).toContain("<Eye");
    expect(pdfButton).toContain('variant="icon"');
    expect(pdfButton).toContain("expandLabel");
    expect(pdfButton).toContain('"Hide PDF" : "View PDF"');
  });

  it("opens a dedicated operator policy workspace with extraction actions in a drawer", () => {
    const policies = read(
      "app/operator/clients/[clientOrgId]/policies/page.tsx",
    );
    const preview = read(
      "app/operator/clients/[clientOrgId]/policies/operator-policy-preview.tsx",
    );
    const detail = read("app/policies/[id]/policy-detail-body.tsx");
    const extraction = read(
      "app/policies/[id]/operator-policy-extraction-workspace.tsx",
    );
    const sidebar = read("app/operator/operator-sidebar.tsx");

    expect(policies).toContain("onPolicySelect={setPreviewPolicyId}");
    expect(policies).toContain("policyPreview={policyPreview}");
    expect(preview).toContain("<PolicyPreview");
    expect(preview).toContain("Open full workspace");
    expect(preview).not.toContain("?tab=extraction");
    expect(detail).toContain("<OperatorPolicyWorkspace");
    expect(detail).toContain("<OperatorPolicyExtractionHistory");
    expect(detail).toContain("<OperatorPolicyExtractionPanel");
    expect(detail).toContain("<OperatorPolicyInspectionPanel");
    expect(detail).toContain("Re-extract");
    expect(detail).toContain("Demo data");
    expect(detail).not.toContain('label: "Extraction"');
    expect(extraction).toContain("Targeted operations");
    expect(extraction).toContain("Recover coverages");
    expect(extraction).toContain("Rerun facts");
    expect(extraction).toContain("Rebuild index");
    expect(extraction).toContain("Referenced source evidence");
    expect(extraction).toContain("sourceSpans && sourceSpans.length > 0");
    expect(extraction).toContain("<SourceEvidenceList");
    expect(extraction).not.toContain("function SourceEvidenceTable");
    expect(extraction).not.toContain('title="Run history"');
    expect(extraction).toContain("ChevronRight");
    expect(extraction).toContain("hasMeaningfulData");
    expect(extraction).not.toContain("View data");
    expect(extraction).not.toContain(
      "Semantic document outline persisted from source parsing.",
    );
    expect(detail).toContain('label: "Extraction history"');
    expect(extraction).not.toContain("stored artifacts for this policy");
    expect(extraction).not.toContain("Full worker queue");
    expect(extraction).not.toContain("description=\"Reparse the original PDF");
    expect(extraction).toContain('<Tabs defaultValue="overview"');
    expect(extraction).toContain('<TabsList variant="pill"');
    expect(extraction).toContain('<TabsTrigger value="overview">Overview');
    expect(extraction).toContain('<TabsTrigger value="logs">Logs');
    expect(extraction).not.toContain('title="Extraction timeline"');
    expect(extraction).toContain("<TimelineWaterfall");
    expect(extraction).not.toContain('title="Event log"');
    expect(extraction).toContain('format("HH:mm:ss.SSS")');
    expect(extraction).toContain("<TraceEventRow");
    expect(extraction).toContain("<TraceEventList events={detail.events}");
    expect(extraction).toContain(
      "return events.map((event) => eventTiming(event, session));",
    );
    expect(sidebar).not.toContain('href="/operator/extractions"');
  });

  it("uses operator-owned certificate and compliance layouts", () => {
    const table = read("components/ui/table.tsx");
    const certificates = read(
      "app/operator/clients/[clientOrgId]/certificates/page.tsx",
    );
    const operatorCertificates = read(
      "app/operator/clients/[clientOrgId]/certificates/operator-certificates-workspace.tsx",
    );
    const compliance = read(
      "app/operator/clients/[clientOrgId]/compliance/page.tsx",
    );
    const sharedCompliance = read("components/compliance-page.tsx");

    expect(certificates).toContain("redirect(");
    expect(certificates).toContain("/compliance?tab=certificates");
    expect(operatorCertificates).not.toContain("CertificateStatusFilter");
    expect(operatorCertificates).not.toContain("certificateSearchText");
    expect(operatorCertificates).not.toContain("function Metric");
    expect(operatorCertificates).toContain('actionPresentation="labels"');
    expect(compliance).toContain("OperatorComplianceWorkspace");
    expect(compliance).toContain("OperatorCertificatesWorkspace");
    expect(compliance).not.toContain("<CompliancePage");
    expect(sharedCompliance).not.toContain("OperatorComplianceSummary");
    expect(sharedCompliance).not.toContain("OperatorComplianceLineSummary");
    expect(sharedCompliance).not.toContain('label: "Status by line"');
    expect(sharedCompliance).toContain('surface !== "operator"');
    expect(sharedCompliance).toContain(
      '{ value: "certificates", label: "Certificates" }',
    );
    expect(table).toContain("border-b border-foreground/6");
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
