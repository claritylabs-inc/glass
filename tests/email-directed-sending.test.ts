import { describe, expect, it } from "vitest";
import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
} from "../convex/lib/emailCancelIntent";
import { resolveEmailAgentIdentity } from "../convex/lib/emailSubagent";
import { getAuthSiteUrl, getPortalUrlForOrg } from "../convex/lib/domains";
import {
  getAgentDomains,
  getAuthFromAddress,
  getNotificationFromAddress,
  isGlassOutboundAddress,
} from "../convex/lib/resend";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
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
    const identity = await resolveEmailAgentIdentity(
      {
        runQuery: async () => null,
        storage: { getUrl: async () => null },
      } as never,
      { name: "Standalone Client", type: "client" },
    );

    expect(identity).toMatchObject({
      canSend: true,
      agentAddress: "agent@glass.insure",
    });
    expect(identity.fromHeader).toContain("<agent@glass.insure>");
  });

  it("separates sending domains while retaining legacy inbound aliases", () => {
    expect(getNotificationFromAddress("Glass Notifications")).toContain(
      "<notifications@notifications.glass.insure>",
    );
    expect(getAuthFromAddress()).toBe("Glass <noreply@auth.glass.insure>");
    expect(getAgentDomains()).toEqual([
      "glass.insure",
      "glass.claritylabs.inc",
      "dev.claritylabs.inc",
    ]);
    expect(isGlassOutboundAddress("agent@glass.claritylabs.inc")).toBe(true);
    expect(isGlassOutboundAddress("noreply@auth.glass.insure")).toBe(true);
  });

  it("normalizes configured legacy development domains", () => {
    withEnv(
      {
        AGENT_DOMAIN: "dev.claritylabs.inc",
        AGENT_EMAIL_DOMAIN: undefined,
        NOTIFICATION_EMAIL_DOMAIN: "dev.claritylabs.inc",
        AUTH_EMAIL_DOMAIN: "dev.claritylabs.inc",
        AUTH_EMAIL_FROM: "Glass Login <noreply@dev.claritylabs.inc>",
      },
      () => {
        expect(getAgentDomains()).toContain("glass.insure");
        expect(getNotificationFromAddress("Glass Notifications")).toContain(
          "<notifications@dev.claritylabs.inc>",
        );
        expect(getAuthFromAddress()).toContain("<noreply@dev.claritylabs.inc>");
        expect(isGlassOutboundAddress("agent@dev.claritylabs.inc")).toBe(true);
      },
    );
  });

  it("uses the shared browser host for auth and tenant portals", () => {
    expect(getAuthSiteUrl()).toBe("https://app.glass.insure");
    expect(getPortalUrlForOrg({ type: "broker" } as never)).toBe(
      "https://app.glass.insure",
    );
    expect(getPortalUrlForOrg({ type: "client" } as never)).toBe(
      "https://app.glass.insure",
    );
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
