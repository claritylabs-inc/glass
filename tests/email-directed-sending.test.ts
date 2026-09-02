import { describe, expect, it } from "vitest";
import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
} from "../convex/lib/emailCancelIntent";
import { resolveEmailAgentIdentity } from "../convex/lib/emailSubagent";
import { getAuthSiteUrl, getPortalUrlForOrg } from "../convex/lib/domains";
import { isManagedSpotHost } from "../lib/domains";
import {
  getAgentDomains,
  getAuthFromAddress,
  getNotificationFromAddress,
  isSpotOutboundAddress,
} from "../convex/lib/resend";

function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("directed email safety", () => {
  it("falls back to the default agent identity", async () => {
    const identity = resolveEmailAgentIdentity({
      name: "Standalone Client",
      type: "client",
    });

    expect(identity).toMatchObject({
      canSend: true,
      agentAddress: "agent@spot.insure",
    });
    expect(identity.fromHeader).toContain("<agent@spot.insure>");
  });

  it("separates sending domains while retaining legacy inbound aliases", () => {
    expect(getNotificationFromAddress("Spot Notifications")).toContain(
      "<notifications@notifications.spot.insure>",
    );
    expect(getAuthFromAddress()).toBe("Spot <noreply@auth.spot.insure>");
    expect(getAgentDomains()).toEqual([
      "spot.insure",
      "glass.insure",
      "glass.claritylabs.inc",
      "spot.claritylabs.inc",
      "dev.claritylabs.inc",
    ]);
    expect(isSpotOutboundAddress("agent@spot.claritylabs.inc")).toBe(true);
    expect(isSpotOutboundAddress("agent@glass.insure")).toBe(true);
    expect(isSpotOutboundAddress("noreply@auth.spot.insure")).toBe(true);
  });

  it("normalizes configured legacy development domains", () => {
    withEnv(
      {
        AGENT_DOMAIN: "dev.claritylabs.inc",
        AGENT_EMAIL_DOMAIN: undefined,
        NOTIFICATION_EMAIL_DOMAIN: "dev.claritylabs.inc",
        AUTH_EMAIL_DOMAIN: "dev.claritylabs.inc",
        AUTH_EMAIL_FROM: "Spot Login <noreply@dev.claritylabs.inc>",
      },
      () => {
        expect(getAgentDomains()).toContain("spot.insure");
        expect(getNotificationFromAddress("Spot Notifications")).toContain(
          "<notifications@dev.claritylabs.inc>",
        );
        expect(getAuthFromAddress()).toContain("<noreply@dev.claritylabs.inc>");
        expect(isSpotOutboundAddress("agent@dev.claritylabs.inc")).toBe(true);
      },
    );
  });

  it("uses the shared browser host for auth and tenant portals", () => {
    expect(getAuthSiteUrl()).toBe("https://app.spot.insure");
    expect(getPortalUrlForOrg({ type: "broker" } as never)).toBe(
      "https://app.spot.insure",
    );
    expect(getPortalUrlForOrg({ type: "client" } as never)).toBe(
      "https://app.spot.insure",
    );
    expect(isManagedSpotHost("app.spot.insure")).toBe(true);
    expect(isManagedSpotHost("app.glass.insure")).toBe(true);
    expect(isManagedSpotHost("glass.claritylabs.inc")).toBe(true);
    expect(isManagedSpotHost("auth.glass.insure")).toBe(true);
  });

  it("distinguishes draft cancellation from insurance-document requests", () => {
    expect(
      isPendingEmailCancelIntent(
        "can you attach the cancellation email itself as an attachment?",
      ),
    ).toBe(false);
    expect(isPendingEmailCancelIntent("cancel")).toBe(true);
    expect(isPendingEmailCancelIntent("don't send")).toBe(true);
    expect(isPendingEmailCancelConfirmation("yes, cancel")).toBe(true);
    expect(isPendingEmailRestoreIntent("undo cancel")).toBe(true);
    expect(isPendingEmailRestoreIntent("restore the draft")).toBe(true);
  });
});
