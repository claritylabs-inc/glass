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
    const confirmedKey = hook.indexOf(
      "lastSavedKeyRef.current = queuedKey",
      flushResolution,
    );

    expect(flushResolution).toBeGreaterThan(-1);
    expect(confirmedKey).toBeGreaterThan(flushResolution);
    expect(hook).toContain('toast.error("Changes weren’t saved"');
  });

  it("tracks raw validated inputs and the complete policy draft as intent", () => {
    const organization = read("components/settings/organization-section.tsx");
    const agent = read("components/settings/broker-agent-tab.tsx");
    const policy = read("app/policies/[id]/policy-breakdown-editor.tsx");

    expect(organization).toContain("valueKey: slug");
    expect(agent).toContain("valueKey: agentHandle");
    expect(policy).toContain(
      "valueKey: JSON.stringify({ id: policy._id, draft })",
    );
  });

  it("keeps dirty-state decisions in the hook and stale writes out of the durable outbox", () => {
    const hook = read("lib/sync/use-local-first-auto-save.ts");
    const profile = read("app/profile/page.tsx");
    const broker = read("app/operator/page.tsx");
    const client = read("app/operator/clients/page.tsx");

    expect(hook).toContain("sequencer.run");
    expect(hook).not.toContain("enqueueMutation");
    expect(hook).not.toContain("flushPendingMutations");
    expect(profile).not.toContain("canSave: hasChanges");
    expect(broker).not.toContain("canSave: settingsDirty");
    expect(client).not.toContain("canSave: settingsDirty");
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

  it("keeps unsaved interaction state recoverable during close, clear, and rename", () => {
    const mailbox = read("components/settings/email-connection-drawers.tsx");
    const mailboxClose = mailbox.slice(
      mailbox.indexOf("async function handleDrawerOpenChange"),
      mailbox.indexOf("async function runManualScan"),
    );
    const policyDelivery = read(
      "components/settings/policy-delivery-section.tsx",
    );
    const resetOverride = policyDelivery.slice(
      policyDelivery.indexOf("async function resetOverride"),
      policyDelivery.indexOf("async function addOverride"),
    );
    const rename = read("components/editable-breadcrumb-title.tsx");

    expect(mailboxClose).toContain(
      "const saved = await settingsAutoSave.saveNow",
    );
    expect(mailboxClose).toContain("if (!saved) return");
    expect(mailboxClose.indexOf("if (!saved) return")).toBeLessThan(
      mailboxClose.indexOf("onOpenChange(open)"),
    );
    expect(resetOverride.indexOf("await settingsAutoSave.saveNow()")).toBeLessThan(
      resetOverride.indexOf("await clearOverride"),
    );
    expect(rename).toContain("setRenameGeneration((current) => current + 1)");
    expect(rename).toContain('resetKey: `${saveKey}:${renameGeneration}`');
  });
});
