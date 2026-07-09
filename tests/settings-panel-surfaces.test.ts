import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("settings panel surfaces", () => {
  it("keeps mailbox rows read-only and moves management into a right panel", () => {
    const list = read("components/settings/email-connections-section.tsx");
    const drawers = read("components/settings/email-connection-drawers.tsx");

    expect(list).toContain("MailboxSettingsDrawer");
    expect(list).toContain("setSelectedAccountId(account._id)");
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
      'redirect("/settings?section=notifications")',
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
});
