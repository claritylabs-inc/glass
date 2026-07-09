import { describe, expect, test } from "vitest";
import {
  canAutoExecuteMailboxDecision,
  effectiveConnectedEmailAutomation,
  sanitizeMailboxAutomationDecision,
  mailboxMessageIdentity,
  type MailboxAutomationDecision,
} from "./mailboxAutomation";

function decision(
  overrides: Partial<MailboxAutomationDecision> = {},
): MailboxAutomationDecision {
  return {
    emailRef: "account:INBOX:42",
    classification: "multiple",
    confidence: 0.95,
    reason: "Explicit policy and requirements package.",
    policyGroups: [{ filenames: ["Policy.pdf", "requirements.docx"] }],
    requirementFilenames: ["requirements.docx", "missing.pdf"],
    includeEmailBodyAsRequirements: false,
    requirementSourceType: "client_contract",
    requirementScope: "own_org",
    extractCompanyMemory: false,
    attentionTitle: null,
    attentionBody: null,
    ...overrides,
  };
}

describe("mailbox automation decisions", () => {
  test("defaults every unattended action off", () => {
    expect(effectiveConnectedEmailAutomation()).toEqual({
      policyImports: false,
      requirementImports: false,
      companyMemory: false,
    });
  });

  test("keeps only exact, supported attachment selections", () => {
    const sanitized = sanitizeMailboxAutomationDecision(decision(), [
      { filename: "Policy.pdf", contentType: "application/pdf" },
      {
        filename: "requirements.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]);
    expect(sanitized.policyGroups).toEqual([{ filenames: ["Policy.pdf"] }]);
    expect(sanitized.requirementFilenames).toEqual(["requirements.docx"]);
  });

  test("requires high confidence and never auto-executes review decisions", () => {
    expect(canAutoExecuteMailboxDecision(decision())).toBe(true);
    expect(canAutoExecuteMailboxDecision(decision({ confidence: 0.89 }))).toBe(false);
    expect(
      canAutoExecuteMailboxDecision(
        decision({ classification: "review_needed", confidence: 1 }),
      ),
    ).toBe(false);
  });

  test("turns low-confidence ignore decisions into review items", () => {
    const sanitized = sanitizeMailboxAutomationDecision(
      decision({ classification: "ignore", confidence: 0.4 }),
      [],
    );
    expect(sanitized.classification).toBe("review_needed");
    expect(sanitized.reason).toContain("Low-confidence ignore decision");
  });

  test("prefers normalized Message-ID identity with a UID fallback", () => {
    const base = {
      accountId: "account",
      mailbox: "INBOX",
      uidValidity: "one",
      uid: 42,
    };
    expect(
      mailboxMessageIdentity({ ...base, messageId: " <ABC@Example.com> " }),
    ).toBe("message-id:abc@example.com");
    expect(mailboxMessageIdentity(base)).toBe("account:INBOX:one:42");
  });
});
