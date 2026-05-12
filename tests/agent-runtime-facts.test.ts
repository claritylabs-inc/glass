import { describe, expect, it } from "vitest";
import { buildAgentCapabilityPrompt, buildRuntimeFacts } from "../convex/lib/aiUtils";

describe("agent runtime facts", () => {
  it("includes current date and timezone in the shared base prompt", () => {
    const prompt = buildAgentCapabilityPrompt({
      companyName: "Acme",
      mode: "direct",
      platform: "web",
      now: new Date("2026-05-12T15:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });

    expect(prompt).toContain("RUNTIME FACTS:");
    expect(prompt).toContain("Current date: Tuesday, May 12, 2026");
    expect(prompt).toContain("Time zone: America/Los_Angeles");
    expect(prompt).toContain("whether a policy is active, expired, upcoming, or needs renewal");
  });

  it("does not make agents infer today from policy dates", () => {
    const facts = buildRuntimeFacts({
      now: new Date("2026-05-12T15:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });

    expect(facts).toContain("Do not infer today's date from policy effective or expiration dates.");
  });
});
