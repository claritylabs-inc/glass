import { describe, it, expect } from "vitest";

// Pure logic extracted from assertCanEditApplicationDraft:
function checkDraftStatus(status: string): void {
  if (status !== "draft") throw new Error("Application is not in draft state");
}

// Pure logic from assertCanSendApplication:
function checkSendStatus(status: string): void {
  if (status !== "draft") throw new Error("Can only send draft applications");
}

// Pure logic from returnSection: client cannot call acceptSection
function checkClientCannotAccept(callerOrgId: string, brokerOrgId: string): void {
  if (callerOrgId !== brokerOrgId) throw new Error("Forbidden: broker org only");
}

describe("capability guards", () => {
  it("edit draft: rejects sent application", () => {
    expect(() => checkDraftStatus("sent")).toThrow("not in draft state");
  });

  it("edit draft: rejects complete application", () => {
    expect(() => checkDraftStatus("complete")).toThrow("not in draft state");
  });

  it("edit draft: allows draft application", () => {
    expect(() => checkDraftStatus("draft")).not.toThrow();
  });

  it("send: rejects already-sent application", () => {
    expect(() => checkSendStatus("sent")).toThrow("Can only send draft");
  });

  it("client cannot acceptSection (broker check)", () => {
    expect(() => checkClientCannotAccept("client-org", "broker-org")).toThrow("Forbidden");
  });

  it("broker can acceptSection", () => {
    expect(() => checkClientCannotAccept("broker-org", "broker-org")).not.toThrow();
  });
});
