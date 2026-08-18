import { describe, expect, test } from "vitest";
import {
  parseSlackEventPayload,
  parseSlackLifecyclePayload,
} from "./slackPayload";

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
  test("normalizes installation and channel lifecycle identity", () => {
    expect(
      parseSlackLifecyclePayload(
        {
          type: "event_callback",
          team_id: "T-CUSTOMER",
          api_app_id: "A-GLASS",
          event_id: "Ev-revoked",
          event_time: 1_800_000_000,
          authorizations: [{ team_id: "T-CUSTOMER" }],
          event: {
            type: "tokens_revoked",
            tokens: { bot: ["U-GLASS"], oauth: ["U-HUMAN"] },
          },
        },
        "hash",
        1,
      ),
    ).toMatchObject({
      eventKey: "slack:Ev-revoked",
      eventType: "tokens_revoked",
      teamId: "T-CUSTOMER",
      authorizationTeamId: "T-CUSTOMER",
      apiAppId: "A-GLASS",
      botUserIds: ["U-GLASS"],
      eventAt: 1_800_000_000_000,
    });
    expect(
      parseSlackLifecyclePayload(
        {
          type: "event_callback",
          team_id: "T-CUSTOMER",
          event: {
            type: "channel_id_changed",
            old_channel_id: "C-OLD",
            new_channel_id: "C-NEW",
          },
        },
        "stable-hash",
        2,
      ),
    ).toMatchObject({
      eventType: "channel_id_changed",
      oldChannelId: "C-OLD",
      newChannelId: "C-NEW",
      payloadHash: "stable-hash",
    });
  });

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
      isPrivateChannel: false,
      isBotEcho: false,
    });
    expect(
      parseSlackEventPayload(
        payload({
          type: "message",
          subtype: "message_changed",
          message: {
            ts: "1800000000.100",
            thread_ts: "1800000000.000",
            user: "U-CUSTOMER",
            user_team: "T-CUSTOMER",
            text: "edited",
          },
        }),
      ),
    ).toMatchObject({ eventType: "edit" });

    const serialized = payload();
    delete (serialized.event as { user_team?: string }).user_team;
    expect(parseSlackEventPayload(serialized)).not.toHaveProperty(
      "senderTeamId",
    );
  });

  test("normalizes attachments, bot echoes, and stable DM conversation keys", () => {
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
      parseSlackEventPayload(
        payload({
          type: "message",
          subtype: "message_deleted",
          deleted_ts: "1800000000.100",
          previous_message: {
            ts: "1800000000.100",
            thread_ts: "1800000000.000",
            user: "U-CUSTOMER",
            user_team: "T-CUSTOMER",
            text: "deleted content",
          },
        }),
      ),
    ).toMatchObject({
      eventKey: "T-CUSTOMER:C-SERVICE:1800000000.100:delete:1800000000.100",
      eventType: "delete",
      content: "",
      messageTs: "1800000000.100",
    });
    expect(
      parseSlackEventPayload(payload({ bot_id: "B-GLASS" })),
    ).toMatchObject({ isBotEcho: true });
    const dm = payload();
    dm.event.channel = "D-PRIVATE";
    dm.event.channel_type = "im";
    expect(parseSlackEventPayload(dm)).toMatchObject({
      isDirectMessage: true,
      channelId: "D-PRIVATE",
      threadTs: "D-PRIVATE",
    });
    expect(
      parseSlackEventPayload(
        payload({ channel: "G-PRIVATE", channel_type: "group" }),
      ),
    ).toMatchObject({
      channelId: "G-PRIVATE",
      isDirectMessage: false,
      isPrivateChannel: true,
    });
  });
});
