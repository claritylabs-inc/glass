import { describe, expect, test } from "vitest";
import {
  buildImessageModelMessages,
  buildImessageRetrievalQuery,
  buildRecentImessageTextContext,
} from "./imessageAgentContext";

describe("iMessage agent context helpers", () => {
  test("builds recent text context without status cue messages", () => {
    expect(
      buildRecentImessageTextContext([
        {
          role: "agent",
          content: "Working on it.",
          responseMessageId: "event:status",
        },
        { role: "user", userName: "Terry", content: "Show my policies" },
        { role: "agent", content: "You have one active policy." },
      ]),
    ).toBe("Terry: Show my policies\nGlass: You have one active policy.");
  });

  test("combines recent context and current message for retrieval", () => {
    expect(
      buildImessageRetrievalQuery({
        recentConversationContext: "Glass: You have one active policy.",
        messageText: "What are the limits?",
      }),
    ).toBe("Glass: You have one active policy.\nUser: What are the limits?");
  });

  test("builds model messages with artifact context and skips current echo", async () => {
    const messages = await buildImessageModelMessages({
      history: [
        { role: "user", content: "Current message" },
        {
          role: "agent",
          content: "Choose a program.",
          toolArtifacts: [
            {
              type: "certificate_program_selection",
              data: {
                policyId: "policy-1",
                holderName: "Example Holder",
                candidates: [
                  {
                    programId: "program-1",
                    programName: "Example Program",
                  },
                ],
                source: "imessage",
              },
            },
          ],
        },
      ],
      messageText: "Current message",
      currentSpeakerLabel: "Terry",
      attachmentRecords: [],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "assistant" });
    expect(JSON.stringify(messages[0])).toContain(
      "PENDING CERTIFIED COI PROGRAM SELECTION",
    );
    expect(messages[1]).toEqual({
      role: "user",
      content: "[Terry]: Current message",
    });
  });
});
