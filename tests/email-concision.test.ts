import { describe, expect, it } from "vitest";
import { buildChannelInstructions } from "../convex/lib/aiUtils";
import { readFileSync } from "fs";
import { join } from "path";

describe("email concision instructions", () => {
  it("tells inbound email replies to stay selective and avoid open-ended offers", () => {
    const instructions = buildChannelInstructions({
      platform: "email",
      autoSendEmails: true,
      effectiveMode: "direct",
    });

    expect(instructions).toContain("Default to a concise practical answer");
    expect(instructions).toContain("2-4 policy facts");
    expect(instructions).toContain("Do not end with open-ended offers");
  });

  it("states iMessage email capability explicitly", () => {
    const available = buildChannelInstructions({
      platform: "imessage",
      canSendEmail: true,
      autoSendEmails: false,
    });
    const unavailable = buildChannelInstructions({
      platform: "imessage",
      canSendEmail: false,
      emailUnavailableReason: "No Glass agent email handle is configured.",
    });

    expect(available).toContain("Email sending is available in this channel.");
    expect(available).toContain("Do not infer capability from older conversation history.");
    expect(available).toContain('draft first and ask "Ready to send?"');
    expect(unavailable).toContain(
      "Email sending is unavailable in this channel: No Glass agent email handle is configured.",
    );
  });

  it("routes inbound email through the email_reply model route", () => {
    const source = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundEmail.ts"),
      "utf-8",
    );

    expect(source).toContain('getModelForOrg(ctx, orgId, "email_reply")');
    expect(source).toContain('getProviderOptionsForTask("email_reply")');
  });
});
