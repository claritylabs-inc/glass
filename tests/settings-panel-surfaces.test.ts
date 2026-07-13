import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { formatTeamMemberPhone } from "@/components/settings/team-members-list";
import {
  businessNumberValidationError,
  feinValidationError,
} from "@/components/settings/organization-insurance-profile";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("organization profile identifier validation", () => {
  it("rejects short identifiers and accepts complete values", () => {
    expect(feinValidationError("12345678")).toBe("Enter a 9-digit FEIN.");
    expect(feinValidationError("12-3456789")).toBeUndefined();
    expect(businessNumberValidationError("12345678")).toBe(
      "Enter 9 digits, optionally followed by a program account.",
    );
    expect(businessNumberValidationError("123456789")).toBeUndefined();
    expect(businessNumberValidationError("123456789 RC 0001")).toBeUndefined();
  });
});

describe("settings panel surfaces", () => {
  it("uses one structural section treatment across editable forms and drawers", () => {
    const primitive = read("components/ui/form-section.tsx");
    const policyEditor = read("app/policies/[id]/policy-details-editor.tsx");
    const policyBreakdown = read(
      "app/policies/[id]/policy-breakdown-editor.tsx",
    );
    const organizationProfile = read(
      "components/settings/organization-insurance-profile.tsx",
    );
    const mailboxDrawer = read(
      "components/settings/email-connection-drawers.tsx",
    );
    const notificationDrawer = read(
      "components/settings/notification-preferences-section.tsx",
    );
    const teamDrawer = read(
      "components/settings/team-member-edit-drawer.tsx",
    );
    const compliance = read("components/compliance-page.tsx");

    expect(primitive).toContain("border-t border-foreground/6 pt-4");
    expect(primitive).toContain(
      "text-base font-medium leading-5 text-foreground",
    );
    expect(primitive).toContain("text-base leading-5 text-muted-foreground");
    expect(primitive).toContain("{action ?");
    expect(policyEditor).toContain("<FormSection title={label}>");
    expect(policyEditor).toContain('title="Additional named insureds"');
    expect(policyBreakdown).toContain('title="Premium breakdown"');
    expect(policyBreakdown).toContain('title="Taxes and fees"');
    expect(policyBreakdown).toContain('title="Coverages"');
    expect(organizationProfile).toContain('title="Insurance profile"');
    expect(mailboxDrawer).toContain('title="Organization sharing"');
    expect(notificationDrawer).toContain('title="Delivery channels"');
    expect(teamDrawer).toContain('title="Account email"');
    expect(compliance).toContain('title="Limits"');
    expect(compliance).toContain('title="Requirements"');
    expect(policyEditor).not.toContain("<legend");
  });

  it("keeps organization identity compact and policy declarations policy-scoped", () => {
    const organization = read("components/settings/organization-section.tsx");
    const profile = read("components/settings/organization-insurance-profile.tsx");
    const policy = read("app/policies/[id]/policy-parties-panel.tsx");
    const policyEditor = read("app/policies/[id]/policy-details-editor.tsx");
    const summary = read("app/policies/[id]/policy-summary.tsx");
    const details = read("app/policies/[id]/policy-details-tab.tsx");
    const detailBody = read("app/policies/[id]/policy-detail-body.tsx");
    const coverages = read("app/policies/[id]/policy-coverages-tab.tsx");

    expect(organization).not.toContain("Used to match named insureds");
    expect(organization).not.toContain("Company Context");
    expect(profile).toContain("AddressAutofillInput");
    expect(profile).toContain("onBlur={saveAfterChange}");
    expect(profile).toContain("onRetrieve={saveAfterChange}");
    expect(profile).toContain("IRS_ENTITY_TYPES");
    expect(profile).toContain('label="FEIN"');
    expect(profile).toContain('label="Business number"');
    expect(profile).toContain("aria-invalid={Boolean(error)}");
    expect(profile).toContain("Enter a 9-digit FEIN.");
    expect(profile).toContain(
      "Enter 9 digits, optionally followed by a program account.",
    );
    expect(profile).toContain(
      "canSave: !disabled && !feinError && !businessNumberError",
    );
    expect(profile).not.toContain('label="Named insured"');
    expect(profile).not.toContain("Additional named insureds");
    expect(policy).toContain("OperationalPanelHeader");
    expect(policy).toContain("OperationalLabelValueRow");
    expect(policy).toContain('title="Insured"');
    expect(policy).toContain('title="Producer"');
    expect(policy).toContain('title="Insurer"');
    expect(policy).toContain('title="General Agent"');
    expect(policy).toContain('onEdit("insured")');
    expect(policy).toContain('onEdit("producer")');
    expect(policy).toContain('onEdit("insurer")');
    expect(policy).toContain('onEdit("generalAgent")');
    expect(policy).toContain('label="NAIC number"');
    expect(policy).toContain('label="License number"');
    expect(policy).toContain("@container/policy-parties");
    expect(policy).toContain(
      "@3xl/policy-parties:grid-cols-2 @5xl/policy-parties:grid-cols-3",
    );
    expect(policy).toContain("Additional named insureds");
    expect(policy).not.toContain("Description of operations");
    expect(summary).toContain('label="Description of operations"');
    expect(summary).toContain("operationsDescription");
    expect(summary).toContain('className="border-t border-foreground/6"');
    const editActionIndex = summary.indexOf("{onEdit ?");
    const renewalStatusIndex = summary.indexOf("{isRenewal &&");
    const lifecycleStatusIndex = summary.indexOf("<StatusBadge");
    expect(editActionIndex).toBeGreaterThan(-1);
    expect(renewalStatusIndex).toBeGreaterThan(-1);
    expect(lifecycleStatusIndex).toBeGreaterThan(-1);
    expect(renewalStatusIndex).toBeLessThan(editActionIndex);
    expect(lifecycleStatusIndex).toBeLessThan(editActionIndex);
    expect(summary).not.toContain('SummaryRow label="Administrator"');
    expect(summary).not.toContain('SummaryRow label="Carrier"');
    expect(summary).not.toContain('SummaryRow label="Broker"');
    expect(summary).not.toContain('SummaryRow label="Named insured"');
    expect(details).not.toContain("CoverageBreakdownCards");
    expect(detailBody).toContain('{ id: "coverages" as const, label: "Coverages" }');
    expect(detailBody).toContain('activeTab === "coverages"');
    expect(detailBody).toContain("<PolicyCoveragesTab");
    expect(coverages).toContain("CoverageBreakdownCards");
    expect(policy).not.toContain("useMutation");
    expect(policy).not.toContain("AutoSaveStatus");
    expect(policy).not.toContain("AddressAutofillInput");
    expect(policy).not.toContain("<Input");
    expect(policy).not.toContain("<textarea");
    expect(policyEditor).toContain("SettingsDrawer");
    expect(policyEditor).toContain("AddressAutofillInput");
    expect(policyEditor).toContain('label="Producer"');
    expect(policyEditor).toContain('label="Producer address"');
    expect(policyEditor).not.toContain("Producer / broker");
    expect(policyEditor).toContain('type="date"');
    expect(policyEditor).toContain('inputMode="decimal"');
    expect(policyEditor).toContain("PhoneInput");
    expect(policyEditor).toContain('type="email"');
    expect(policyEditor).toContain("useLocalFirstAutoSave");
    expect(policyEditor).toContain("autoSave: false");
    expect(policyEditor).toContain("AutoSaveStatus");
  });

  it("keeps mailbox rows read-only and moves management into a right panel", () => {
    const list = read("components/settings/email-connections-section.tsx");
    const drawers = read("components/settings/email-connection-drawers.tsx");

    expect(list).toContain("MailboxSettingsDrawer");
    expect(list).toContain("void openMailbox(account._id)");
    expect(list).toContain("automationSummary(account)");
    expect(list).toContain("lastScanAt ?? account.lastTestedAt");
    expect(list).not.toContain("EmailScopeSelect");
    expect(list).not.toContain('variant="destructive"');
    expect(drawers).toContain("confirmDisconnect");
    expect(drawers).toContain("AutomationToggleRows");
    expect(drawers).toContain("automation: AUTOMATION_ENABLED");
    expect(drawers).toContain("api.connectedEmail.updateSettings");
  });

  it("edits and deletes memory in a settings drawer instead of the list", () => {
    const memory = read("components/settings/memory-section.tsx");

    expect(memory).toContain("MemoryEditDrawer");
    expect(memory).toContain("setSelectedMemoryId(memory._id)");
    expect(memory).toContain("<SettingsDrawer");
    expect(memory).toContain("confirmDelete");
    expect(memory).toContain("<Textarea");
    expect(memory).not.toContain("window.confirm");
    expect(memory).not.toContain("<textarea");
  });

  it("uses default notification inheritance and drawer-based event overrides", () => {
    const settings = read("app/settings/page.tsx");
    const notificationsRoute = read("app/settings/notifications/page.tsx");
    const notifications = read(
      "components/settings/notification-preferences-section.tsx",
    );

    expect(settings).toContain("NotificationPreferencesSection");
    expect(settings).not.toContain("./notifications/page");
    expect(notificationsRoute).toContain(
      'redirect("/settings?section=workflows&tab=notifications")',
    );
    expect(notifications).toContain("NotificationPreferenceDrawer");
    expect(notifications).toContain('explicitPreference("__all__", channel)');
    expect(notifications).toContain("api.notificationPreferences.setChannels");
    expect(notifications).toContain("Default email delivery");
    expect(notifications).toContain("Default text delivery");
    expect(notifications).not.toContain("Master control");
    expect(notifications).not.toContain("<table");
    expect(notifications).not.toContain("api as any");
  });

  it("renders team members as clickable table rows without edit actions", () => {
    const team = read("components/settings/team-members-list.tsx");

    expect(team).toContain("<Table");
    expect(team).toContain("<TableHeader>");
    expect(team).toContain("<TableRow");
    expect(team).toContain(">Email</TableHead>");
    expect(team).toContain(">Phone</TableHead>");
    expect(team).toContain("formatTeamMemberPhone(member.phone)");
    expect(team).toContain("parsePhoneNumberFromString");
    expect(team).toContain("onEditMember(member)");
    expect(team).toContain('tabIndex={canEditMembers ? 0 : undefined}');
    expect(team).not.toContain("OperationalPanelHeader");
    expect(team).not.toContain(">Contact</TableHead>");
    expect(team).not.toContain("Edit Team Member");
    expect(team).not.toContain("Set Primary");

    const section = read("components/settings/team-section.tsx");
    expect(section).toContain(
      'editPhone.trim() !== (member.phone ?? "").trim()',
    );
  });

  it("formats team member phone numbers for display", () => {
    expect(formatTeamMemberPhone("+12025550102")).toBe("(202) 555-0102");
    expect(formatTeamMemberPhone("+442079460018")).toBe(
      "+44 20 7946 0018",
    );
    expect(formatTeamMemberPhone()).toBe("-");
  });

  it("splits integrations into focused MCP, CLI, and advanced surfaces", () => {
    const settings = read("app/settings/page.tsx");
    const sections = read("lib/settings-sections.ts");
    const connections = read("components/settings/connections-section.tsx");

    expect(settings).toContain("<ConnectionsSection tab={tab} />");
    expect(sections).toContain('{ id: "mcp", label: "MCP" }');
    expect(sections).toContain('{ id: "cli", label: "CLI" }');
    expect(sections).toContain('{ id: "advanced", label: "Advanced" }');
    expect(connections).toContain('if (tab === "cli") return <CliSection />');
    expect(connections).toContain('if (tab === "advanced") return <AdvancedSection />');
    expect(connections).toContain("Settings → Connectors");
    expect(connections).toContain("Settings → Apps → Advanced settings");
    expect(connections).toContain("<SiClaude");
    expect(connections).toContain('<ModelProviderLogo provider="openai"');
    expect(connections).toContain("https://claude.ai/new#settings/customize-connectors");
    expect(connections).toContain("https://chatgpt.com/#settings/Connectors");
    expect(connections).toContain("Open Claude");
    expect(connections).toContain("Open ChatGPT");
    expect(connections).not.toContain("Claude web or desktop");
    expect(connections).not.toContain("Custom app with MCP");
    expect(connections).not.toContain("api.apiKeys");
    expect(connections).not.toContain('title="API keys"');
    expect(connections).toContain('title="Connected apps"');
    expect(connections).toContain('title="Local MCP clients"');
    expect(connections).not.toContain("showAdvanced");
  });
});
