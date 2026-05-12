/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { buildNotificationEmail } from "./notificationEmailTemplate";

describe("buildNotificationEmail", () => {
  test("client-targeted email uses notification sender and broker branding", () => {
    const result = buildNotificationEmail({
      title: "Your policy was delivered",
      body: "Smith Insurance delivered a policy.",
      ctaUrl: "https://glass.app/policies/abc",
      ctaLabel: "View Policy",
      branding: {
        kind: "broker",
        brokerName: "Smith Insurance",
        agentDisplayName: "Sarah Smith",
        accentColor: "#1a56db",
        logoUrl: null,
      },
      siteUrl: "https://glass.app",
    });

    expect(result.fromName).toBe("Glass Notifications");
    expect(result.html).toContain("Smith Insurance");
    expect(result.html).toContain("Your policy was delivered");
    expect(result.html).toContain("https://glass.app/policies/abc");
    expect(result.text).toContain("View Policy");
  });

  test("broker-targeted email uses generic Glass branding", () => {
    const result = buildNotificationEmail({
      title: "Policy update",
      body: "Acme Co policy updated.",
      ctaUrl: "https://glass.app/policies/xyz",
      ctaLabel: "Review",
      branding: { kind: "glass" },
      siteUrl: "https://glass.app",
    });

    expect(result.fromName).toBe("Glass Notifications");
    expect(result.html).toContain("Policy update");
    expect(result.html).toContain("Glass");
    expect(result.html).toContain('src="https://glass.claritylabs.inc/glass-icon.jpg"');
    expect(result.text).toContain("Review");
  });

  test("thread label is prefaced in html and text", () => {
    const result = buildNotificationEmail({
      title: "T",
      body: "B",
      ctaUrl: "https://glass.app",
      ctaLabel: "CTA",
      branding: { kind: "glass" },
      siteUrl: "https://glass.app",
      threadLabel: "Renewal Review",
    });

    expect(result.html).toContain("Notification for thread");
    expect(result.html).toContain("Renewal Review");
    expect(result.text).toContain("Thread: Renewal Review");
  });
});
