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
  "app/policies/[id]/policy-breakdown-editor.tsx",
  "app/profile/page.tsx",
  "components/compliance-page.tsx",
  "components/editable-breadcrumb-title.tsx",
  "components/settings/broker-agent-tab.tsx",
  "components/settings/broker-identity-section.tsx",
  "components/settings/certificate-workflow-section.tsx",
  "components/settings/client-email-routing-section.tsx",
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

  it("defers organization text and address writes until focus leaves the field", () => {
    const organization = read("components/settings/organization-section.tsx");
    const organizationProfile = read(
      "components/settings/organization-insurance-profile.tsx",
    );
    const addressAutofill = read("components/ui/address-autofill-input.tsx");
    const policyDelivery = read("components/settings/policy-delivery-section.tsx");
    const compliance = read("components/compliance-page.tsx");

    expect(organization).toContain("autoSave: !slugFocused");
    expect(organization).toContain("autoSave: false");
    expect(organization).toContain("onBlur={() => void saveOrgSettingsNow()}");
    expect(organizationProfile).toContain("autoSave: false");
    expect(organizationProfile).toContain("void saveProfileNow()");
    expect(organizationProfile).toContain("onRetrieve={saveAfterChange}");
    expect(addressAutofill).toContain("onBlur={onBlur}");
    expect(addressAutofill).toContain("onRetrieve?.(address)");
    expect(policyDelivery).toContain("autoSave: !copyInstructionsFocused");
    expect(policyDelivery).toContain("void settingsAutoSave.saveNow()");
    expect(compliance).toContain("autoSave: !textFieldFocused");
    expect(compliance).toContain("void autoSave.saveNow()");
  });

  it("renders one aggregate save status on the organization settings page", () => {
    const organization = read("components/settings/organization-section.tsx");
    expect(organization.match(/<AutoSaveStatus\s+status=/g)).toHaveLength(1);
    expect(organization).toContain("profileAutoSaveStatus");
    expect(organization).toContain("brandingAutoSaveStatus");
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
    const clientSettings = read(
      "components/settings/client-email-routing-section.tsx",
    );
    const orgs = read("convex/orgs.ts");

    expect(clientSettings).toContain("EMAIL_PATTERN.test(value)");
    expect(clientSettings).toContain("DOMAIN_PATTERN.test(value)");
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
      "const saved = await saveSettingsBeforeAction()",
    );
    expect(mailboxClose).toContain("if (!open && canManageMailbox)");
    expect(mailboxClose).not.toContain("if (!open && hasChanges");
    expect(mailboxClose).toContain("if (!saved) return");
    expect(mailboxClose.indexOf("if (!saved) return")).toBeLessThan(
      mailboxClose.indexOf("onOpenChange(open)"),
    );
    expect(resetOverride.indexOf("const saved = await settingsAutoSave.saveNow()")).toBeLessThan(
      resetOverride.indexOf("if (!saved) {"),
    );
    expect(resetOverride.indexOf("if (!saved) {")).toBeLessThan(
      resetOverride.indexOf("await clearOverride"),
    );
    expect(resetOverride.indexOf("setClearingOverride(true)")).toBeLessThan(
      resetOverride.indexOf("await settingsAutoSave.saveNow()"),
    );
    expect(resetOverride).not.toContain("finally");
    const clearSuccess = resetOverride.slice(
      resetOverride.indexOf("try {"),
      resetOverride.indexOf("} catch"),
    );
    expect(clearSuccess).toContain('toast.success("Client override cleared")');
    expect(clearSuccess).not.toContain("setClearingOverride(false)");
    expect(policyDelivery).toContain("disabled={clearingOverride}");
    expect(rename).toContain("setRenameGeneration((current) => current + 1)");
    expect(rename).toContain('resetKey: `${saveKey}:${renameGeneration}`');
    expect(rename).toContain(
      'const showSaveStatus = autoSave.status !== "saved"',
    );
    expect(rename).toContain("showSaveStatus ? (");
  });

  it("drains operator saves before dependent actions", () => {
    const broker = read("app/operator/page.tsx");
    const client = read("app/operator/clients/page.tsx");
    const organization = read(
      "components/settings/organization-section.tsx",
    );

    for (const [source, helper, autoSave] of [
      [
        broker,
        "saveBrokerSettingsBeforeTransition",
        "brokerSettingsAutoSave",
      ],
      [client, "saveClientSettingsBeforeAction", "clientSettingsAutoSave"],
    ] as const) {
      expect(source).toContain(`return ${autoSave}.saveNow()`);
      expect(source).not.toContain("settingsDirty");
      expect(source.indexOf(`await ${helper}()`)).toBeLessThan(
        source.indexOf("await startImpersonation"),
      );
    }

    expect(broker.indexOf("await saveBrokerSettingsBeforeTransition()")).toBeLessThan(
      broker.indexOf("await launchBroker"),
    );
    expect(client.indexOf("await saveClientSettingsBeforeAction()")).toBeLessThan(
      client.indexOf("await launchClient"),
    );
    expect(broker).toContain(
      '<fieldset disabled={busy} className="space-y-3">',
    );
    expect(client).toContain(
      '<fieldset disabled={busy} className="space-y-4">',
    );
    expect(organization).toContain("slug === currentSlug ||");
  });
});
