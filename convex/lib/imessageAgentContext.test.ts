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

  test("builds model messages without artifact context and skips current echo", async () => {
    const messages = await buildImessageModelMessages({
      history: [
        { role: "user", content: "Current message" },
        {
          role: "agent",
          content: "Certificate follow-up is on hold.",
          toolArtifacts: [
            {
              type: "certificate_hold",
              data: {
                policyId: "policy-1",
                holderName: "Example Holder",
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
    expect(messages[0]).toEqual({
      role: "assistant",
      content: "Certificate follow-up is on hold.",
    });
    expect(messages[1]).toEqual({
      role: "user",
      content: "[Terry]: Current message",
    });
  });
});
