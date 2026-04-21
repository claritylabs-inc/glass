/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { buildNotificationEmail } from "./notificationEmailTemplate";

describe("buildNotificationEmail", () => {
  test("client-targeted email includes broker name in from-name", () => {
    const result = buildNotificationEmail({
      title: "Your application was sent",
      body: "Smith Insurance sent you an application.",
      ctaUrl: "https://glass.app/applications/abc",
      ctaLabel: "View Application",
      branding: {
        kind: "broker",
        brokerName: "Smith Insurance",
        agentDisplayName: "Sarah Smith",
        accentColor: "#1a56db",
        logoUrl: null,
      },
      siteUrl: "https://glass.app",
    });

    expect(result.fromName).toBe("Sarah Smith via Glass");
    expect(result.html).toContain("Smith Insurance");
    expect(result.html).toContain("Your application was sent");
    expect(result.html).toContain("https://glass.app/applications/abc");
    expect(result.text).toContain("View Application");
  });

  test("broker-targeted email uses generic Glass branding", () => {
    const result = buildNotificationEmail({
      title: "Client submitted application",
      body: "Acme Co submitted an application.",
      ctaUrl: "https://glass.app/broker/applications/xyz",
      ctaLabel: "Review",
      branding: { kind: "glass" },
      siteUrl: "https://glass.app",
    });

    expect(result.fromName).toBe("Glass");
    expect(result.html).toContain("Client submitted application");
    expect(result.html).toContain("Glass");
    expect(result.text).toContain("Review");
  });

  test("broker name falls back to brokerName when agentDisplayName is null", () => {
    const result = buildNotificationEmail({
      title: "T", body: "B", ctaUrl: "https://glass.app", ctaLabel: "CTA",
      branding: {
        kind: "broker",
        brokerName: "Smith Insurance",
        agentDisplayName: null,
        accentColor: "#000",
        logoUrl: null,
      },
      siteUrl: "https://glass.app",
    });

    expect(result.fromName).toBe("Smith Insurance via Glass");
  });
});
