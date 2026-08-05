import { describe, expect, test } from "vitest";
import { parseSlackWebhookPayload } from "./slackPayload";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: "messages",
    message: {
      id: "message-1",
      ts: "1800000000.100",
      threadTs: "1800000000.000",
      platform: "slack",
      sender: { id: "U-CUSTOMER", teamId: "T-CUSTOMER", displayName: "Avery" },
      content: { type: "text", text: "<@U-GLASS> show my policy" },
      ...overrides,
    },
    space: { id: "C-SERVICE", teamId: "T-CUSTOMER", type: "channel" },
  };
}

describe("Slack webhook payload narrowing", () => {
  test("normalizes mentions, threads, and edits", () => {
    expect(parseSlackWebhookPayload(payload(), "webhook-1")).toMatchObject({
      eventKey: "webhook-1:message-1",
      teamId: "T-CUSTOMER",
      channelId: "C-SERVICE",
      threadTs: "1800000000.000",
      senderTeamId: "T-CUSTOMER",
      senderUserId: "U-CUSTOMER",
      eventType: "message",
      isDirectMessage: false,
      isBotEcho: false,
    });
    expect(
      parseSlackWebhookPayload(payload({ subtype: "message_changed" })),
    ).toMatchObject({ eventType: "edit" });

    const serialized = payload();
    const serializedSender = serialized.message.sender as {
      id: string;
      teamId?: string;
      displayName?: string;
    };
    delete serializedSender.teamId;
    delete serializedSender.displayName;
    expect(parseSlackWebhookPayload(serialized)).not.toHaveProperty(
      "senderTeamId",
    );
  });

  test("normalizes attachments and ignores reactions, bots, and DMs", () => {
    expect(
      parseSlackWebhookPayload(
        payload({
          content: {
            type: "attachment",
            id: "F-1",
            name: "policy.pdf",
            mimeType: "application/pdf",
            size: 1024,
          },
        }),
      ),
    ).toMatchObject({
      attachment: {
        providerFileId: "F-1",
        filename: "policy.pdf",
        contentType: "application/pdf",
        size: 1024,
      },
    });
    expect(
      parseSlackWebhookPayload(payload({ content: { type: "reaction" } })),
    ).toBeNull();
    expect(
      parseSlackWebhookPayload(
        payload({ subtype: "message_deleted", content: { type: "text", text: "" } }),
      ),
    ).toBeNull();
    expect(
      parseSlackWebhookPayload(payload({ isFromMe: true })),
    ).toMatchObject({ isBotEcho: true });
    const dm = payload();
    dm.space = { id: "D-PRIVATE", teamId: "T-CUSTOMER", type: "dm" };
    expect(parseSlackWebhookPayload(dm)).toMatchObject({ isDirectMessage: true });
  });
});
