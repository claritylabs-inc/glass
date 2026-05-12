/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
  NOTIFICATION_SEVERITY,
  COALESCE_WINDOW_MS,
  buildCoalesceKey,
  getEffectiveEmailDefault,
} from "./notificationTypes";

describe("NOTIFICATION_SEVERITY", () => {
  test("broker event types have severity", () => {
    expect(NOTIFICATION_SEVERITY["client_invitation_accepted"]).toBe("info");
    expect(NOTIFICATION_SEVERITY["extraction_error"]).toBe("warning");
  });

  test("client event types have severity", () => {
    expect(NOTIFICATION_SEVERITY["renewal_reminder"]).toBe("warning");
    expect(NOTIFICATION_SEVERITY["extraction_error"]).toBe("warning");
  });
});

describe("COALESCE_WINDOW_MS", () => {
  test("types with windows return 10 minutes in ms", () => {
    expect(COALESCE_WINDOW_MS["client_document_uploaded"]).toBe(10 * 60 * 1000);
  });

  test("types without windows return undefined", () => {
    expect(COALESCE_WINDOW_MS["client_invitation_accepted"]).toBeUndefined();
  });
});

describe("buildCoalesceKey", () => {
  test("returns stable key with 10-min bucket", () => {
    const now = 1_000_000_000_000; // ms
    const key = buildCoalesceKey(
      ["client_document_uploaded", "brokerOrg1", "clientOrg1"],
      10 * 60 * 1000,
      now,
    );
    // bucket = Math.floor(now / windowMs)
    const bucket = Math.floor(now / (10 * 60 * 1000));
    expect(key).toBe(`client_document_uploaded:brokerOrg1:clientOrg1:${bucket}`);
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
