/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { buildNotificationEmail } from "./notificationEmailTemplate";

describe("buildNotificationEmail", () => {
  test("client-targeted email uses notification sender and broker branding", () => {
    const result = buildNotificationEmail({
      title: "Your policy was delivered",
      body: "Smith Insurance delivered a policy.",
      ctaUrl: "https://app.glass.insure/policies/abc",
      ctaLabel: "View Policy",
      branding: {
        kind: "broker",
        brokerName: "Smith Insurance",
        agentDisplayName: "Sarah Smith",
        accentColor: "#1a56db",
        logoUrl: null,
      },
      siteUrl: "https://app.glass.insure",
    });

    expect(result.fromName).toBe("Glass Notifications");
    expect(result.html).toContain("Smith Insurance");
    expect(result.html).toContain("Your policy was delivered");
    expect(result.html).toContain("https://app.glass.insure/policies/abc");
    expect(result.text).toContain("View Policy");
  });

  test("broker-targeted email uses generic Glass branding", () => {
    const result = buildNotificationEmail({
      title: "Policy update",
      body: "Acme Co policy updated.",
      ctaUrl: "https://app.glass.insure/policies/xyz",
      ctaLabel: "Review",
      branding: { kind: "glass" },
      siteUrl: "https://app.glass.insure",
    });

    expect(result.fromName).toBe("Glass Notifications");
    expect(result.html).toContain("Policy update");
    expect(result.html).toContain("Glass");
    expect(result.html).toContain('src="https://app.glass.insure/glass-icon.jpg"');
    expect(result.text).toContain("Review");
  });

  test("thread label is rendered as compact auth-style context", () => {
    const result = buildNotificationEmail({
      title: "T",
      body: "B",
      ctaUrl: "https://app.glass.insure",
      ctaLabel: "CTA",
      branding: { kind: "glass" },
      siteUrl: "https://app.glass.insure",
      threadLabel: "Renewal Review",
    });

    expect(result.html).not.toContain("NOTIFICATION FOR THREAD");
    expect(result.html).not.toContain("Notification for thread");
    expect(result.html).toContain("Renewal Review");
    expect(result.html).toContain('<td align="center" style="padding:24px 40px 0 40px;">');
    expect(result.text).toContain("Thread: Renewal Review");
  });

  test("uses the neutral login email action treatment", () => {
    const result = buildNotificationEmail({
      title: "Policy update",
      body: "Acme Co policy updated.",
      ctaUrl: "https://app.glass.insure/policies/xyz",
      ctaLabel: "Review",
      branding: { kind: "glass" },
      siteUrl: "https://app.glass.insure",
    });

    expect(result.html).toContain("border-radius:999px");
    expect(result.html).toContain("background:#000000");
    expect(result.html).not.toContain("background:#2563eb");
    expect(result.html).toContain("Open in Glass:");
    expect(result.html).not.toContain("Sent by Glass Notifications.");
    expect(result.text).not.toContain("Glass Notifications");
  });

});
