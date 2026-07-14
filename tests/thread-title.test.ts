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
    ).toBe("Send COI");
  });

  it("keeps certificate-generation titles tightly scoped", () => {
    expect(
      fallbackTitle(
        "Can you generate a new certificate for Northwoods Continental Insurance Company with ReLease Coverage Company as the holder?",
      ),
    ).toBe("Generate COI");
    expect(
      fallbackTitle("Can you update this certificate with a description of operations?"),
    ).toBe("Update COI");
    expect(fallbackTitle("Draft a certificate for the new holder")).toBe(
      "Draft COI",
    );
  });

  it("rejects noisy or conversational generated titles", () => {
    expect(normalizeGeneratedTitle("Send Caitlin Caitlinle2445 Gmail")).toBeNull();
    expect(normalizeGeneratedTitle("Email caitlinle2445@gmail.com")).toBeNull();
    expect(normalizeGeneratedTitle("Can You Generate New")).toBeNull();
    expect(normalizeGeneratedTitle("Generate A New Certificate For Northwoods")).toBeNull();
    expect(normalizeGeneratedTitle("Generate COI")).toBe("Generate COI");
  });

  it("rejects model planning output instead of storing it as the title", () => {
    expect(normalizeGeneratedTitle("1. **Analyze the Request:**")).toBeNull();
    expect(
      normalizeGeneratedTitle(
        "1. **Analyze the Request:**\n2. **Identify the Deliverable:**",
      ),
    ).toBeNull();
    expect(normalizeGeneratedTitle("Analyze the user request")).toBeNull();

    const fallback = fallbackTitle(
      "Can you generate a new COI for ReLease Coverage Company and draft an email with it?",
    );
    expect(normalizeGeneratedTitle("1. **Analyze the Request:**") ?? fallback).toBe(
      "Generate COI",
    );
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
    expect(TITLE_SYSTEM_PROMPT).toContain("Use 2-4 words");
  });
});
