import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSettingsNavigation, settingsPages } from "@/lib/settings-sections";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("settings maintenance placement", () => {
  it("keeps extracted-profile reset in the page header", () => {
    const organization = read("components/settings/organization-section.tsx");
    const profile = read(
      "components/settings/organization-insurance-profile.tsx",
    );

    expect(organization).toContain('setActions(');
    expect(organization).toContain('"Use extracted"');
    expect(organization).toContain("onResetActionChange");
    expect(profile).not.toContain("<PillButton");
  });

  it("keeps onboarding and destructive reset in Beta", () => {
    const organization = read("components/settings/organization-section.tsx");
    const beta = read("components/settings/beta-features-section.tsx");

    expect(organization).not.toContain("restartOnboarding");
    expect(organization).not.toContain("resetAccount");
    expect(beta).toContain("await restartOnboarding()");
    expect(beta).toContain("await resetAccount()");
    expect(beta).toContain("viewer?.isAdmin");
  });

  it("keeps Beta reachable for broker and client workspaces", () => {
    for (const isBroker of [false, true]) {
      const pages = settingsPages(getSettingsNavigation({
        isBroker,
        isStandaloneClient: !isBroker,
      }));
      expect(pages.map((page) => page.id)).toContain("beta");
    }
  });
});
