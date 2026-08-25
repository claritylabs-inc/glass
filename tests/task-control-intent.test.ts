import { describe, expect, it, vi } from "vitest";
import { taskControlResponse } from "../convex/lib/taskControlIntent";
import { runWebChatTaskControl } from "../convex/lib/webChatDeterministicControls";
import type { Id } from "../convex/_generated/dataModel";

const ids = {
  orgId: "org-1" as Id<"organizations">,
  threadId: "thread-1" as Id<"threads">,
  agentMessageId: "agent-1" as Id<"threadMessages">,
  userMessageId: "user-1" as Id<"threadMessages">,
};

describe("task control commands", () => {
  it.each([
    ["/cancel", "cancel_task"],
    ["/reset", "reset_task"],
    ["/new", "reset_task"],
  ] as const)("applies the exact %s command", async (messageText, intent) => {
    const runMutation = vi.fn(
      async (_reference: unknown, _args: unknown) => null,
    );

    await expect(
      runWebChatTaskControl({ runMutation } as never, {
        ...ids,
        messageText,
        threadMessages: [],
      }),
    ).resolves.toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      threadId: ids.threadId,
      currentMessageId: ids.userMessageId,
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      id: ids.agentMessageId,
      content: taskControlResponse(intent),
    });
  });

  it.each([
    "never mind",
    "start over",
    "cancel this task",
    "no thanks",
    "leave it as is",
  ])("does not infer task control from prose: %s", async (messageText) => {
    const runMutation = vi.fn(
      async (_reference: unknown, _args: unknown) => null,
    );

    await expect(
      runWebChatTaskControl({ runMutation } as never, {
        ...ids,
        messageText,
        threadMessages: [],
      }),
    ).resolves.toBe(false);
    expect(runMutation).not.toHaveBeenCalled();
  });
});
