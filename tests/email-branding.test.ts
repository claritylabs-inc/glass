import { describe, it, expect } from "vitest";
import { getDefaultBranding } from "../convex/lib/branding";
import { buildAgentReplyEmail } from "../convex/lib/agentEmailTemplate";
import { buildOtpEmail, buildEmailLogoHtml } from "../convex/lib/emailTemplate";

const branding = getDefaultBranding();

describe("agentEmailTemplate", () => {
  it("title does not contain Glass", () => {
    const { html } = buildAgentReplyEmail("Hello world", branding);
    expect(html).not.toMatch(/Glass/i);
  });

  it("footer uses branding.brandName", () => {
    const { html } = buildAgentReplyEmail("Hello world", branding);
    expect(html).toContain("Glass");
  });

  it("uses custom brand name when provided", () => {
    const custom = { ...branding, brandName: "Acme" };
    const { html } = buildAgentReplyEmail("Hello world", custom);
    expect(html).toContain("Acme");
    expect(html).not.toMatch(/Glass/i);
  });
});

describe("emailTemplate logo", () => {
  it("buildEmailLogoHtml does not contain Glass", () => {
    const logo = buildEmailLogoHtml(branding);
    expect(logo).not.toMatch(/Glass/i);
  });

  it("OTP email does not contain Glass in text", () => {
    const { text } = buildOtpEmail("123456");
    expect(text).not.toMatch(/Glass/i);
  });
});
