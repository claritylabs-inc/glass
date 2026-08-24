import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateAgentTextForOrg, generateObjectForOrg } = vi.hoisted(() => ({
  generateAgentTextForOrg: vi.fn(),
  generateObjectForOrg: vi.fn(),
}));

vi.mock("./models", () => ({
  generateAgentTextForOrg,
  generateObjectForOrg,
  generatedTextFromResult: (result: { text?: string } | undefined) =>
    result?.text ?? "",
}));

import { runAgentTurn } from "./channelAgentRunner";

describe("shared agent turn recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateObjectForOrg.mockResolvedValue({
      object: { requiresPolicyEvidence: false, confidence: 1 },
    });
  });

  test("continues from completed tool results without exposing tools again", async () => {
    generateAgentTextForOrg
      .mockResolvedValueOnce({
        text: "",
        finishReason: "length",
        steps: [
          {
            toolCalls: [
              { toolName: "import_requirement_attachments", input: {} },
            ],
            toolResults: [
              {
                toolName: "import_requirement_attachments",
                output: { imported: true },
              },
            ],
          },
        ],
        response: {
          messages: [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "import-1",
                  toolName: "import_requirement_attachments",
                  output: { imported: true },
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        text: "The agreement was imported and reviewed.",
        finishReason: "stop",
        steps: [],
        response: { messages: [] },
      });

    const turn = await runAgentTurn({} as never, {
      orgId: "org-1" as never,
      task: "chat",
      messageText: "Review this agreement.",
      options: {
        maxOutputTokens: 8_192,
        system: "Use tools when needed.",
        messages: [{ role: "user", content: "Review this agreement." }],
        tools: { import_requirement_attachments: {} as never },
      },
      run: {
        taskKind: "query_reason",
        sessionKey: "thread-1",
        trace: {
          traceId: "message-1",
          label: "test.agent",
          phase: "query_reason",
          channel: "imessage",
        },
      },
    });

    expect(turn.text).toBe("The agreement was imported and reviewed.");
    expect(turn.audit.completedTools).toEqual([
      "import_requirement_attachments",
    ]);
    expect(generateAgentTextForOrg).toHaveBeenCalledTimes(2);
    const synthesisOptions = generateAgentTextForOrg.mock.calls[1]?.[3];
    expect(synthesisOptions).not.toHaveProperty("tools");
    expect(synthesisOptions).not.toHaveProperty("prepareStep");
    expect(synthesisOptions.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("Do not repeat any completed action"),
    });
  });
});
