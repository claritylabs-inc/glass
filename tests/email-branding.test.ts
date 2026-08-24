import { describe, it, expect } from "vitest";
import { getDefaultBranding } from "../convex/lib/branding";
import { buildAgentReplyEmail } from "../convex/lib/agentEmailTemplate";

const branding = getDefaultBranding();

describe("agentEmailTemplate", () => {
  it("includes Glass in the default title", () => {
    const { html } = buildAgentReplyEmail("Hello world", branding);
    expect(html).toContain("<title>Glass Response</title>");
  });

  it("uses custom brand name when provided", () => {
    const custom = { ...branding, brandName: "Acme", agentDisplayName: "Acme Agent" };
    const { html } = buildAgentReplyEmail("Hello world", custom);
    expect(html).toContain("<title>Acme Response</title>");
  });
});
