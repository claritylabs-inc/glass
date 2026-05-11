import { describe, it, expect } from "vitest";
import { getDefaultBranding } from "../convex/lib/branding";
import { buildAgentReplyEmail } from "../convex/lib/agentEmailTemplate";
import { buildOtpEmail, buildEmailLogoHtml } from "../convex/lib/emailTemplate";

const branding = getDefaultBranding();

describe("agentEmailTemplate", () => {
  it("includes Glass in the default title", () => {
    const { html } = buildAgentReplyEmail("Hello world", branding);
    expect(html).toContain("<title>Glass Response</title>");
  });

  it("footer uses branding.brandName", () => {
    const { html } = buildAgentReplyEmail("Hello world", branding);
    expect(html).toContain("Glass");
  });

  it("uses custom brand name when provided", () => {
    const custom = { ...branding, brandName: "Acme", agentDisplayName: "Acme Agent" };
    const { html } = buildAgentReplyEmail("Hello world", custom);
    expect(html).toContain("Acme");
    expect(html).toContain("<title>Acme Response</title>");
  });
});

describe("emailTemplate logo", () => {
  it("buildEmailLogoHtml uses the public asset host for default Glass icons", () => {
    const logo = buildEmailLogoHtml(branding, "https://dev.claritylabs.inc");
    expect(logo).toContain('src="https://glass.claritylabs.inc/glass-icon.jpg"');
    expect(logo).toContain("Glass");
  });

  it("OTP email includes the current Glass brand in text", () => {
    const { text } = buildOtpEmail("123456");
    expect(text).toMatch(/Glass/i);
  });
});
