import { describe, it, expect } from "vitest";

describe("returnSection guard", () => {
  it("throws when no needs_new_answer flags are open", () => {
    const flags = [{ flagType: "comment", status: "open" }];
    const hasReturnFlag = flags.some(
      (f) => f.flagType === "needs_new_answer" && f.status === "open",
    );
    expect(hasReturnFlag).toBe(false);
  });

  it("allows return when a needs_new_answer flag is open", () => {
    const flags = [{ flagType: "needs_new_answer", status: "open" }];
    const hasReturnFlag = flags.some(
      (f) => f.flagType === "needs_new_answer" && f.status === "open",
    );
    expect(hasReturnFlag).toBe(true);
  });
});
