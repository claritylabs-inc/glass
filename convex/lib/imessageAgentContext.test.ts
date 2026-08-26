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
  buildRecentImessageTextContext,
  imessageAgentTaskForAttachments,
  transcribeImessageVoiceMemos,
} from "./imessageAgentContext";

describe("iMessage agent context helpers", () => {
  test("routes image attachments through the vision-capable chat task", () => {
    expect(
      imessageAgentTaskForAttachments([
        {
          filename: "image.png",
          contentType: "image/png",
          size: 5,
          buffer: Buffer.from("image"),
        },
      ]),
    ).toBe("chat_vision");
    expect(
      imessageAgentTaskForAttachments([
        {
          filename: "requirements.pdf",
          contentType: "application/pdf",
          size: 3,
          buffer: Buffer.from("pdf"),
        },
      ]),
    ).toBe("chat");
  });

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
          messageKind: "workflow_status",
        },
        {
          role: "user",
          userName: "Terry",
          content: "Show my policies",
        },
        {
          role: "agent",
          content: "You have one active policy.",
        },
      ]),
    ).toBe("Terry: Show my policies\nGlass: You have one active policy.");
  });

  test("keeps non-workflow artifacts out of private history and skips current echo", async () => {
    const messages = await buildImessageModelMessages({
      history: [
        {
          _id: "current",
          _creationTime: 1,
          role: "user",
          content: "Current message",
        },
        {
          _id: "agent-1",
          _creationTime: 2,
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
      currentMessageId: "current" as Id<"threadMessages">,
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

  test("builds model messages with private assistant tool activity", async () => {
    const messages = await buildImessageModelMessages({
      history: [
        {
          _id: "user-1",
          _creationTime: 1,
          role: "user",
          userName: "Terry",
          content: "Generate a COI",
        },
        {
          _id: "agent-1",
          _creationTime: 2,
          role: "agent",
          content: "COI generated and attached.",
          usedTools: ["generate_coi"],
          attachments: [{ filename: "COI - Example Holder.pdf" }],
        },
      ],
      messageText: "Where is the PDF?",
      currentSpeakerLabel: "Terry",
      attachmentRecords: [],
      currentMessageId: "current-2" as Id<"threadMessages">,
    });

    expect(messages).toEqual([
      { role: "user", content: "[Terry]: Generate a COI" },
      {
        role: "assistant",
        content: "COI generated and attached.",
        providerOptions: {
          glass: {
            privateHistory: {
              tools: ["generate_coi"],
              workflowOutcomes: [],
              attachmentNames: ["COI - Example Holder.pdf"],
              attachmentFailures: [],
            },
          },
        },
      },
      { role: "user", content: "[Terry]: Where is the PDF?" },
    ]);
  });
});
