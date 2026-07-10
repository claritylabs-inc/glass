import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

const AUTO_SAVE_SURFACES = [
  "app/operator/page.tsx",
  "app/operator/clients/page.tsx",
  "app/clients/[clientOrgId]/settings/page.tsx",
  "app/policies/[id]/policy-breakdown-editor.tsx",
  "app/profile/page.tsx",
  "components/compliance-page.tsx",
  "components/editable-breadcrumb-title.tsx",
  "components/settings/broker-agent-tab.tsx",
  "components/settings/broker-identity-section.tsx",
  "components/settings/certificate-workflow-section.tsx",
  "components/settings/email-connection-drawers.tsx",
  "components/settings/organization-section.tsx",
  "components/settings/policy-delivery-section.tsx",
];

describe("auto-save surfaces", () => {
  it("uses the shared persistence and status primitives everywhere", () => {
    for (const path of AUTO_SAVE_SURFACES) {
      const source = read(path);
      expect(source, path).toContain("useLocalFirstAutoSave");
      expect(source, path).toContain("AutoSaveStatus");
      expect(source, path).not.toContain("saveTimerRef");
      expect(source, path).not.toContain("settingsSaveStatus");
      expect(source, path).not.toContain("Saved on change");
    }
  });

  it("marks saves complete only after the backend flush resolves", () => {
    const hook = read("lib/sync/use-local-first-auto-save.ts");
    const flushResolution = hook.indexOf(".then((flushResult)");
    const confirmedKey = hook.indexOf("lastSavedKeyRef.current = queuedKey");

    expect(flushResolution).toBeGreaterThan(-1);
    expect(confirmedKey).toBeGreaterThan(flushResolution);
    expect(hook).toContain('toast.error("Changes weren’t saved"');
  });

  it("defers long-form text until blur without blocking validated controls", () => {
    const organization = read("components/settings/organization-section.tsx");
    const policyDelivery = read("components/settings/policy-delivery-section.tsx");
    const compliance = read("components/compliance-page.tsx");

    expect(organization).toContain("autoSave: !contextFocused");
    expect(organization).toContain("void contextAutoSave.saveNow()");
    expect(policyDelivery).toContain("autoSave: !copyInstructionsFocused");
    expect(policyDelivery).toContain("void settingsAutoSave.saveNow()");
    expect(compliance).toContain("autoSave: !textFieldFocused");
    expect(compliance).toContain("void autoSave.saveNow()");
  });

  it("checks operator identifiers before edit auto-save", () => {
    const operatorPage = read("app/operator/page.tsx");
    const clientPage = read("app/operator/clients/page.tsx");
    const backend = read("convex/operator.ts");

    expect(operatorPage).toContain("editIdentifierCheck");
    expect(operatorPage).toContain("ownerOrgId: selected._id");
    expect(clientPage).toContain("editHandleAvailability");
    expect(clientPage).toContain("excludeOrgId: selected?._id");
    expect(backend).toContain('ownerOrgId: v.optional(v.id("organizations"))');
  });

  it("keeps client sender validation aligned with backend writes", () => {
    const clientSettings = read("app/clients/[clientOrgId]/settings/page.tsx");
    const orgs = read("convex/orgs.ts");

    expect(clientSettings).toContain("EMAIL_PATTERN.test(v)");
    expect(clientSettings).toContain("DOMAIN_PATTERN.test(v)");
    expect(orgs).toContain("emailPattern.test(email)");
    expect(orgs).toContain("domainPattern.test(domain)");
  });
});
