import { describe, expect, it } from "vitest";
import {
  buildTitlePromptContent,
  fallbackTitle,
  normalizeGeneratedTitle,
  TITLE_SYSTEM_PROMPT,
} from "../convex/actions/threadTitle";

describe("thread title generation", () => {
  it("prefers COI intent over recipient email noise", () => {
    expect(
      fallbackTitle("Send the certificate of insurance to caitlinle2445@gmail.com"),
    ).toBe("COI Email");
  });

  it("strips generated titles that contain email-address noise", () => {
    expect(normalizeGeneratedTitle("Send Caitlin Caitlinle2445 Gmail")).toBeNull();
    expect(normalizeGeneratedTitle("Email caitlinle2445@gmail.com")).toBeNull();
  });

  it("includes initial page context in the rename prompt", () => {
    const prompt = buildTitlePromptContent({
      userMessage: "send this over",
      initialContext: {
        pageType: "policy",
        summary: "Markel E&O policy for certificate of insurance generation",
      },
      attachments: [{ filename: "certificate-of-insurance.pdf", contentType: "application/pdf" }],
    });

    expect(prompt).toContain("Initial user request");
    expect(prompt).toContain("Starting page context");
    expect(prompt).toContain("Markel E&O policy");
    expect(prompt).toContain("certificate-of-insurance.pdf");
  });

  it("documents that titles should ignore recipients and capture work intent", () => {
    expect(TITLE_SYSTEM_PROMPT).toContain("actual work intent");
    expect(TITLE_SYSTEM_PROMPT).toContain("Prefer the action and deliverable/topic");
    expect(TITLE_SYSTEM_PROMPT).toContain("Never include raw email addresses");
  });
});
