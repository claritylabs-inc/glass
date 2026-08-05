import { describe, expect, test } from "vitest";
import { parseSlackEventPayload } from "./slackPayload";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T-CUSTOMER",
    event_id: "Ev-message-1",
    event: {
      type: "app_mention",
      ts: "1800000000.100",
      thread_ts: "1800000000.000",
      event_ts: "1800000000.100",
      channel: "C-SERVICE",
      channel_type: "channel",
      user: "U-CUSTOMER",
      user_team: "T-CUSTOMER",
      text: "<@U-GLASS> show my policy",
      ...overrides,
    },
  };
}

describe("Slack webhook payload narrowing", () => {
  test("normalizes mentions, threads, and edits", () => {
    expect(parseSlackEventPayload(payload())).toMatchObject({
      eventKey: "T-CUSTOMER:C-SERVICE:1800000000.100:message",
      providerEventId: "Ev-message-1",
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
      parseSlackEventPayload(payload({
        type: "message",
        subtype: "message_changed",
        message: {
          ts: "1800000000.100",
          thread_ts: "1800000000.000",
          user: "U-CUSTOMER",
          user_team: "T-CUSTOMER",
          text: "edited",
        },
      })),
    ).toMatchObject({ eventType: "edit" });

    const serialized = payload();
    delete (serialized.event as { user_team?: string }).user_team;
    expect(parseSlackEventPayload(serialized)).not.toHaveProperty(
      "senderTeamId",
    );
  });

  test("normalizes attachments and ignores reactions, bots, and DMs", () => {
    expect(
      parseSlackEventPayload(
        payload({
          text: "",
          files: [
            {
              id: "F-1",
              name: "policy.pdf",
              mimetype: "application/pdf",
              size: 1024,
            },
          ],
        }),
      ),
    ).toMatchObject({
      attachments: [
        {
          providerFileId: "F-1",
          filename: "policy.pdf",
          contentType: "application/pdf",
          size: 1024,
        },
      ],
    });
    expect(
      parseSlackEventPayload(payload({ subtype: "message_deleted", text: "" })),
    ).toBeNull();
    expect(
      parseSlackEventPayload(payload({ bot_id: "B-GLASS" })),
    ).toMatchObject({ isBotEcho: true });
    const dm = payload();
    dm.event.channel = "D-PRIVATE";
    dm.event.channel_type = "im";
    expect(parseSlackEventPayload(dm)).toMatchObject({ isDirectMessage: true });
  });
});
