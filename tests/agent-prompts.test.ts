import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const AGENT_ACTION_FILES = [
  "convex/actions/handleInboundEmail.ts",
  "convex/actions/processThreadChat.ts",
  "convex/actions/generateEmailBody.ts",
];

describe("Agent prompts: platform branding is explicit", () => {
  for (const relPath of AGENT_ACTION_FILES) {
    it(`${relPath} avoids bare legacy metadata branding`, () => {
      const src = readFileSync(join(__dirname, "..", relPath), "utf-8");
      const violations = src
        .split("\n")
        .filter((line) => /default:\s*["']Glass["']|siteName:\s*["']Glass["']/.test(line));
      expect(violations).toEqual([]);
    });
  }

  it("uses current Glass sender and signature copy where email is user-facing", () => {
    const emailBody = readFileSync(
      join(__dirname, "..", "convex/actions/generateEmailBody.ts"),
      "utf-8",
    );
    const inboundEmail = readFileSync(
      join(__dirname, "..", "convex/actions/handleInboundEmail.ts"),
      "utf-8",
    );
    const threadChat = readFileSync(
      join(__dirname, "..", "convex/actions/processThreadChat.ts"),
      "utf-8",
    );

    expect(emailBody).toContain("sent with Glass");
    expect(inboundEmail).toContain("Glass from Clarity Labs");
    expect(threadChat).toContain('getNotificationFromAddress("Glass Notifications")');
  });
});
