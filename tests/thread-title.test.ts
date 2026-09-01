import { describe, expect, it } from "vitest";
import {
  fallbackTitle,
  normalizeGeneratedTitle,
} from "../convex/actions/threadTitle";
import {
  isLegacyOperatorSlackTitle,
  slackChannelTitlePrefix,
  slackThreadTitle,
  slackThreadTitleSeed,
} from "../convex/lib/slackThreadTitle";

describe("thread title generation", () => {
  it("removes recipient noise while preserving Unicode work terms", () => {
    const title = fallbackTitle(
      "Send the certificate of insurance to caitlinle2445@gmail.com",
    );

    expect(title).toContain("Certificate");
    expect(title).not.toMatch(/@|gmail|caitlinle2445/i);
    expect(fallbackTitle("caitlinle2445@gmail.com")).toBe("New Chat");
    expect(fallbackTitle("Резюме полиса 東京保険")).toBe("Резюме Полиса 東京保険");
  });

  it("rejects recipient, conversational, and planning output", () => {
    expect(normalizeGeneratedTitle("Email caitlinle2445@gmail.com")).toBeNull();
    expect(normalizeGeneratedTitle("Can You Generate New")).toBeNull();
    expect(normalizeGeneratedTitle("1. **Analyze the Request:**")).toBeNull();
    expect(normalizeGeneratedTitle("Analyze the user request")).toBeNull();
    expect(normalizeGeneratedTitle("Résumé Politique Tokyo")).toBe(
      "Résumé Politique Tokyo",
    );
  });

  it("combines a friendly Slack channel with a concise generated topic", () => {
    const prefix = slackChannelTitlePrefix({
      channelId: "C05UNKNOWN",
      channelName: "renewal-support",
    });

    expect(prefix).toBe("#renewal-support");
    expect(slackThreadTitle(prefix, "Review Cyber Renewal")).toBe(
      "#renewal-support · Review Cyber Renewal",
    );
    expect(
      slackChannelTitlePrefix({ channelId: "C05UNKNOWN" }),
    ).toBe("#C05UNKNOWN");
  });

  it("removes Slack mentions from the title seed and recognizes legacy titles", () => {
    expect(
      slackThreadTitleSeed(
        "<@U-SPOT>   summarize the property coverage exclusions",
      ),
    ).toBe("summarize the property coverage exclusions");
    expect(isLegacyOperatorSlackTitle("Slack · C05UNKNOWN", "C05UNKNOWN"))
      .toBe(true);
    expect(isLegacyOperatorSlackTitle("#renewals", "C05UNKNOWN")).toBe(false);
  });
});
