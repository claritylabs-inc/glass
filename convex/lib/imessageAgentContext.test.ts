import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";

const { transcribeAudioForOrgMock, transcribeAudioForPublicTaskMock } =
  vi.hoisted(() => ({
    transcribeAudioForOrgMock: vi.fn(),
    transcribeAudioForPublicTaskMock: vi.fn(),
  }));

vi.mock("./models", () => ({
  transcribeAudioForOrg: transcribeAudioForOrgMock,
  transcribeAudioForPublicTask: transcribeAudioForPublicTaskMock,
}));

import {
  buildImessageModelMessages,
  buildImessageRetrievalQuery,
  buildRecentImessageTextContext,
  transcribeImessageVoiceMemos,
} from "./imessageAgentContext";

describe("iMessage agent context helpers", () => {
  test("turns a voice memo into labeled text for the existing chat pipeline", async () => {
    transcribeAudioForOrgMock.mockResolvedValueOnce({
      text: "Please compare my current liability limits.",
      route: { provider: "openai", model: "gpt-4o-transcribe" },
      routeSource: "default",
      transport: "direct",
    });

    const input = await transcribeImessageVoiceMemos({} as never, {
      orgId: "org-1" as Id<"organizations">,
      messageText: "(attachment)",
      attachments: [
        {
          name: "voice-memo.m4a",
          mimeType: "audio/mp4",
          data: Buffer.from("audio").toString("base64"),
        },
      ],
    });

    expect(input).toMatchObject({
      hasVoiceMemos: true,
      messageText:
        "[Voice memo transcript: voice-memo.m4a]\nPlease compare my current liability limits.",
      transcripts: [
        {
          filename: "voice-memo.m4a",
          text: "Please compare my current liability limits.",
        },
      ],
      failures: [],
    });
    expect(transcribeAudioForOrgMock).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.objectContaining({
        filename: "voice-memo.m4a",
        mediaType: "audio/mp4",
      }),
    );
    expect(transcribeAudioForPublicTaskMock).not.toHaveBeenCalled();
  });

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

  test("builds model messages with compact assistant tool activity", async () => {
    const messages = await buildImessageModelMessages({
      history: [
        { role: "user", userName: "Terry", content: "Generate a COI" },
        {
          role: "agent",
          content: "COI generated and attached.",
          usedTools: ["generate_coi"],
          attachments: [{ filename: "COI - Example Holder.pdf" }],
        },
      ],
      messageText: "Where is the PDF?",
      currentSpeakerLabel: "Terry",
      attachmentRecords: [],
    });

    expect(messages).toEqual([
      { role: "user", content: "[Terry]: Generate a COI" },
      {
        role: "assistant",
        content:
          'COI generated and attached.\n\n[tool activity: tools: generate_coi; attached: "COI - Example Holder.pdf"]',
      },
      { role: "user", content: "[Terry]: Where is the PDF?" },
    ]);
  });
});
