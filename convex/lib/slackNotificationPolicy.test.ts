import { describe, expect, test } from "vitest";
import { slackNotificationCategory } from "./notificationTypes";

describe("Slack notification policy", () => {
  test("allows only safe client and opt-in vendor categories", () => {
    expect(slackNotificationCategory("own_compliance_gap")).toBe("safe");
    expect(slackNotificationCategory("own_compliance_resolved")).toBe("safe");
    expect(slackNotificationCategory("policy_change_needs_info")).toBe("safe");
    expect(slackNotificationCategory("policy_change_completed")).toBe("safe");
    expect(slackNotificationCategory("vendor_compliance_gap")).toBe("vendor");
    expect(slackNotificationCategory("vendor_policy_expiring")).toBe("vendor");
  });

  test("excludes mailbox, extraction, broker, and onboarding events", () => {
    expect(slackNotificationCategory("mailbox_attention")).toBeNull();
    expect(slackNotificationCategory("incomplete_extraction")).toBeNull();
    expect(slackNotificationCategory("broker_action")).toBeNull();
    expect(slackNotificationCategory("client_onboarding_completed")).toBeNull();
  });
});
