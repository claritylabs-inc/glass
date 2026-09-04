import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  transcribeAudioForOperatorTaskMock,
  transcribeAudioForOrgMock,
  transcribeAudioForPublicTaskMock,
} = vi.hoisted(() => ({
  transcribeAudioForOperatorTaskMock: vi.fn(),
  transcribeAudioForOrgMock: vi.fn(),
  transcribeAudioForPublicTaskMock: vi.fn(),
}));

vi.mock("./models", () => ({
  transcribeAudioForOperatorTask: transcribeAudioForOperatorTaskMock,
  transcribeAudioForOrg: transcribeAudioForOrgMock,
  transcribeAudioForPublicTask: transcribeAudioForPublicTaskMock,
}));

import { prepareInboundImessageTurn } from "./imessageAgentContext";

describe("iMessage agent context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("transcribes operator voice notes without dropping other attachments", async () => {
    transcribeAudioForOperatorTaskMock.mockResolvedValueOnce({
      text: "Record that we provided the requested information.",
      route: { provider: "openai", model: "gpt-4o-transcribe" },
      routeSource: "global",
      transport: "direct",
    });
    const document = {
      name: "follow-up.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf").toString("base64"),
    };

    const input = await prepareInboundImessageTurn({} as never, {
      scope: { kind: "operator" },
      messageText: "(attachment)",
      attachments: [
        {
          name: "voice-memo.m4a",
          mimeType: "audio/mp4",
          data: Buffer.from("audio").toString("base64"),
        },
        document,
      ],
    });

    expect(input).toMatchObject({
      messageText:
        "[Voice memo transcript: voice-memo.m4a]\nRecord that we provided the requested information.",
      failures: [],
      nonAudioAttachments: [document],
    });
    expect(transcribeAudioForOperatorTaskMock).toHaveBeenCalledOnce();
    expect(transcribeAudioForOrgMock).not.toHaveBeenCalled();
    expect(transcribeAudioForPublicTaskMock).not.toHaveBeenCalled();
  });
});
