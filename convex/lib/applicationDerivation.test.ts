import { describe, it, expect } from "vitest";
import { deriveApplicationStatus } from "./applicationDerivation";

type GroupStatus = "not_started" | "in_progress" | "submitted" | "returned" | "accepted";

describe("deriveApplicationStatus", () => {
  it("all not_started → sent", () => {
    expect(deriveApplicationStatus(["not_started", "not_started"])).toBe("sent");
  });

  it("any in_progress → in_progress", () => {
    expect(deriveApplicationStatus(["not_started", "in_progress"])).toBe("in_progress");
  });

  it("any returned → in_progress", () => {
    expect(deriveApplicationStatus(["accepted", "returned"])).toBe("in_progress");
  });

  it("all submitted or accepted, at least one submitted → awaiting_review", () => {
    expect(deriveApplicationStatus(["submitted", "accepted"])).toBe("awaiting_review");
  });

  it("all submitted → awaiting_review", () => {
    expect(deriveApplicationStatus(["submitted", "submitted"])).toBe("awaiting_review");
  });

  it("all accepted → complete", () => {
    expect(deriveApplicationStatus(["accepted", "accepted"])).toBe("complete");
  });

  it("empty group list → sent", () => {
    expect(deriveApplicationStatus([])).toBe("sent");
  });
});
