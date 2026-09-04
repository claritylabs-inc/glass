import { describe, expect, test } from "vitest";
import {
  selectBoundedAgentHistory,
  stripInternalAgentActivity,
} from "./agentMessageHistory";

describe("stripInternalAgentActivity", () => {
  test("removes an echoed private tool trailer from customer-visible text", () => {
    expect(
      stripInternalAgentActivity(
        "That's the full book.\n\n[tool activity: tools: lookup_policy]",
      ),
    ).toBe("That's the full book.");
  });

});

describe("bounded agent conversation history", () => {
  const message = (
    id: string,
    creationTime: number,
    role: "user" | "agent",
    content = id,
  ) => ({
    _id: id,
    _creationTime: creationTime,
    role,
    content,
  });

  test("clips only on complete prior turns and never drops the active request", () => {
    const selected = selectBoundedAgentHistory(
      [
        message("u1", 1, "user", "x".repeat(600)),
        message("a1", 2, "agent", "y".repeat(600)),
        message("u2", 3, "user", "active request"),
      ],
      { currentMessageId: "u2", maxEstimatedTokens: 10 },
    );
    expect(selected.messages.map((item) => item._id)).toEqual(["u2"]);
    expect(selected.estimatedTokenCount).toBe(0);
  });
});
