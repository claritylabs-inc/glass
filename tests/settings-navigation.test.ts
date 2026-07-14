import { describe, expect, it } from "vitest";
import {
  getSettingsNavigation,
  resolveSettingsDestination,
  settingsPages,
} from "../lib/settings-sections";

describe("settings navigation", () => {
  it("groups integrations and mailboxes as separate pages", () => {
    const groups = getSettingsNavigation({
      isBroker: false,
      isStandaloneClient: true,
    });
    const integrationGroup = groups.find((group) => group.label === "Connections");
    expect(integrationGroup?.pages.map((page) => page.id)).toEqual([
      "integrations",
      "mailboxes",
    ]);
    expect(settingsPages(groups).map((page) => page.id)).toEqual([
      "organization",
      "team",
      "agent",
      "workflows",
      "integrations",
      "mailboxes",
      "beta",
    ]);
    expect(
      integrationGroup?.pages
        .find((page) => page.id === "integrations")
        ?.tabs.map((tab) => tab.id),
    ).toEqual(["mcp", "cli", "advanced"]);
  });

  it("uses role-aware tabs and resolves legacy deep links", () => {
    const brokerGroups = getSettingsNavigation({
      isBroker: true,
      isStandaloneClient: false,
    });
    const agent = settingsPages(brokerGroups).find((page) => page.id === "agent");
    expect(agent?.tabs.map((tab) => tab.id)).toEqual(["behavior", "models"]);
    expect(resolveSettingsDestination({
      requestedSection: "connections",
      requestedTab: null,
      groups: brokerGroups,
    })).toMatchObject({ section: "integrations", tab: "mcp" });
    expect(resolveSettingsDestination({
      requestedSection: "email",
      requestedTab: null,
      groups: brokerGroups,
    })).toMatchObject({ section: "mailboxes", tab: "mailboxes" });
    expect(resolveSettingsDestination({
      requestedSection: "notifications",
      requestedTab: null,
      groups: brokerGroups,
    })).toMatchObject({ section: "workflows", tab: "notifications" });
  });
});
