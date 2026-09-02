import { describe, expect, test } from "vitest";
import {
  buildPrivateAgentHistoryMetadata,
  buildTextModelHistory,
  selectBoundedAgentHistory,
  shouldStartNewImessageTask,
  stripInternalAgentActivity,
} from "./agentMessageHistory";
import {
  createSlackThreadContextArtifact,
  slackThreadContextMessageTimestamps,
} from "./slackThreadContext";

describe("buildPrivateAgentHistoryMetadata", () => {
  test("collects compact JSON-safe workflow, tool, and attachment context", () => {
    const workflowOutcome = {
      workflowKind: "certificate_request",
      status: "completed",
      nextAction: "none",
      requiredSlots: [],
      forbiddenQuestions: [],
      forbiddenClaims: [],
      sideEffects: [],
      artifacts: [],
      comms: { headline: "Certificate generated" },
      audit: [],
    };
    expect(
      buildPrivateAgentHistoryMetadata({
        usedTools: ["lookup_policy", "generate_coi", "generate_coi"],
        attachments: [{ filename: "COI - Example Holder.pdf" }],
        toolArtifacts: [
          {
            type: "workflow_outcome",
            data: workflowOutcome,
          },
          {
            type: "imessage_attachment_delivery",
            data: {
              status: "failed",
              failures: [{ filename: "failed.pdf" }],
            },
          },
        ],
      }),
    ).toEqual({
      tools: ["lookup_policy", "generate_coi"],
      workflowOutcomes: [workflowOutcome],
      attachmentNames: ["COI - Example Holder.pdf"],
      attachmentFailures: ["failed.pdf"],
    });
  });

  test("drops invalid workflow metadata", () => {
    expect(
      buildPrivateAgentHistoryMetadata({
        toolArtifacts: [
          {
            type: "workflow_outcome",
            data: { unsafe: Symbol("unsafe") },
          },
        ],
      }),
    ).toBeUndefined();
  });
});

describe("stripInternalAgentActivity", () => {
  test("removes an echoed private tool trailer from customer-visible text", () => {
    expect(
      stripInternalAgentActivity(
        "That's the full book.\n\n[tool activity: tools: lookup_policy]",
      ),
    ).toBe("That's the full book.");
  });

  test("preserves a non-trailing legacy marker as ordinary content", () => {
    expect(
      stripInternalAgentActivity(
        "First paragraph.\n\n[TOOL ACTIVITY: tools: lookup_policy]\n\nSecond paragraph.",
      ),
    ).toBe(
      "First paragraph.\n\n[TOOL ACTIVITY: tools: lookup_policy]\n\nSecond paragraph.",
    );
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

  test("keeps at most 24 complete user turns with their replies", () => {
    const messages = Array.from({ length: 30 }, (_, index) => [
      message(`u${index}`, index * 2, "user"),
      message(`a${index}`, index * 2 + 1, "agent"),
    ]).flat();
    const selected = selectBoundedAgentHistory(messages, {
      currentMessageId: "u29",
    });
    expect(selected.userTurnCount).toBe(24);
    expect(selected.messages[0]._id).toBe("u6");
    expect(selected.messages.at(-1)?._id).toBe("a29");
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

  test("excludes only structured status records from model history", () => {
    const selected = selectBoundedAgentHistory(
      [
        message("u1", 1, "user", "Show me the draft."),
        {
          ...message("legacy", 2, "agent", "Email sent to a@example.com"),
          responseMessageId: "legacy:status",
        },
        {
          ...message("status", 3, "agent", "Email sent to b@example.com"),
          messageKind: "workflow_status" as const,
        },
      ],
      { currentMessageId: "u1" },
    );

    expect(selected.messages.map((item) => item._id)).toEqual(["u1", "legacy"]);
  });

  test("starts a new iMessage task at the seven-day inactivity boundary", () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(shouldStartNewImessageTask(1_000, 1_000 + sevenDays - 1)).toBe(
      false,
    );
    expect(shouldStartNewImessageTask(1_000, 1_000 + sevenDays)).toBe(true);
    expect(shouldStartNewImessageTask(undefined, sevenDays)).toBe(false);
  });
});

describe("Slack source-thread history", () => {
  test("adds only uncaptured earlier Slack messages before the current request", () => {
    const artifact = createSlackThreadContextArtifact(
      {
        messages: [
          {
            messageTs: "1800000000.000",
            senderUserId: "U-TERRY",
            content: "Original building quote requirements",
          },
          {
            messageTs: "1800000000.050",
            senderUserId: "U-TERRY",
            content: "Previously captured correction",
          },
          {
            messageTs: "1800000000.100",
            senderUserId: "U-TERRY",
            content: "Current request",
          },
          {
            messageTs: "1800000000.200",
            senderUserId: "U-OTHER",
            content: "Future reply",
          },
        ],
        truncated: false,
      },
      {
        knownMessageTimestamps: ["1800000000.050", "1800000000.100"],
        latestMessageTs: "1800000000.100",
      },
    );
    expect(artifact).toBeDefined();
    expect(slackThreadContextMessageTimestamps([artifact])).toEqual([
      "1800000000.000",
    ]);

    const history = buildTextModelHistory([
      {
        _id: "current",
        _creationTime: 1,
        role: "user",
        content: "Create the procurement request.",
        userName: "Terry",
        toolArtifacts: [artifact],
      },
    ]);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("Original building quote requirements"),
    });
    expect(String(history[0]?.content)).not.toContain(
      "Previously captured correction",
    );
    expect(String(history[0]?.content)).not.toContain("Future reply");
    expect(history[1]).toEqual({
      role: "user",
      content: "[Terry]: Create the procurement request.",
    });
  });
});
