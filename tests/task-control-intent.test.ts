import { describe, expect, it } from "vitest";
import { parseTaskControlCommand } from "../convex/lib/taskControlIntent";

describe("task control commands", () => {
  it.each([
    ["/cancel", "cancel_task"],
    ["/reset", "reset_task"],
    ["/new", "reset_task"],
  ] as const)("recognizes the exact %s command", (messageText, intent) => {
    expect(parseTaskControlCommand(messageText)).toBe(intent);
  });

  it.each([
    "never mind",
    "start over",
    "cancel this task",
    "no thanks",
    "leave it as is",
  ])("does not infer task control from prose: %s", (messageText) => {
    expect(parseTaskControlCommand(messageText)).toBeNull();
  });
});
