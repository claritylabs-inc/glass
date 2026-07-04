/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
  ACTIVE_NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
  COALESCE_WINDOW_MS,
  buildCoalesceKey,
  getEffectiveEmailDefault,
  getNotificationSettingsRows,
} from "./notificationTypes";

describe("NOTIFICATION_SEVERITY", () => {
  test("broker event types have severity", () => {
    expect(NOTIFICATION_SEVERITY["client_invitation_accepted"]).toBe("info");
    expect(NOTIFICATION_SEVERITY["broker_action"]).toBe("info");
  });

  test("client event types have severity", () => {
    expect(NOTIFICATION_SEVERITY["incomplete_extraction"]).toBe("warning");
    expect(NOTIFICATION_SEVERITY["vendor_policy_expired"]).toBe("critical");
  });
});

describe("COALESCE_WINDOW_MS", () => {
  test("types with windows return the configured window", () => {
    expect(COALESCE_WINDOW_MS["vendor_compliance_gap"]).toBe(24 * 60 * 60 * 1000);
  });

  test("types without windows return undefined", () => {
    expect(COALESCE_WINDOW_MS["client_invitation_accepted"]).toBeUndefined();
  });
});

describe("buildCoalesceKey", () => {
  test("returns stable key with the configured bucket", () => {
    const now = 1_000_000_000_000; // ms
    const windowMs = 24 * 60 * 60 * 1000;
    const key = buildCoalesceKey(
      ["vendor_compliance_gap", "clientOrg1", "relationship1"],
      windowMs,
      now,
    );
    const bucket = Math.floor(now / windowMs);
    expect(key).toBe(`vendor_compliance_gap:clientOrg1:relationship1:${bucket}`);
  });
});

describe("getEffectiveEmailDefault", () => {
  test("critical and warning default to email on", () => {
    expect(getEffectiveEmailDefault("warning")).toBe(true);
    expect(getEffectiveEmailDefault("critical")).toBe(true);
  });

  test("info defaults to email off", () => {
    expect(getEffectiveEmailDefault("info")).toBe(false);
  });
});

describe("notification settings rows", () => {
  test("only exposes active producer-backed types", () => {
    const settingsTypes = [
      ...getNotificationSettingsRows("broker"),
      ...getNotificationSettingsRows("client"),
    ].map((row) => row.type);

    for (const type of settingsTypes) {
      expect(ACTIVE_NOTIFICATION_TYPES).toContain(type);
    }
    expect(settingsTypes).not.toContain("client_document_uploaded");
    expect(settingsTypes).not.toContain("policy_delivered_by_broker");
    expect(settingsTypes).not.toContain("renewal_reminder");
    expect(settingsTypes).not.toContain("policy_lapsed");
  });
});
