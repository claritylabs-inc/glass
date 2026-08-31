import { describe, expect, test } from "vitest";
import {
  isSlackOperatorClassification,
  parseSlackInteraction,
  slackActionToken,
} from "./slackInteractions";

describe("Slack interactions", () => {
  test("parses form-encoded block actions and extracts opaque tokens", () => {
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        team: { id: "T-CUSTOMER" },
        user: { id: "U-CUSTOMER", team_id: "T-ACTOR" },
        channel: { id: "C-PRIMARY" },
        message: { ts: "1800.1" },
        actions: [{
          action_id: "spot_response_feedback",
          action_ts: "1800.2",
          value: "negative:opaque-token",
        }],
      }),
    }).toString();
    const payload = parseSlackInteraction(body);
    expect(payload).toMatchObject({
      teamId: "T-CUSTOMER",
      actorTeamId: "T-ACTOR",
      userId: "U-CUSTOMER",
      channelId: "C-PRIMARY",
      messageTs: "1800.1",
      actionId: "spot_response_feedback",
    });
    expect(payload?.type).toBe("block_actions");
    if (payload?.type !== "block_actions") throw new Error("Expected block action");
    expect(slackActionToken(payload.actionId, payload.value)).toEqual({
      token: "opaque-token",
      value: "negative",
    });
    expect(slackActionToken(
      "spot_response_feedback_negative",
      "negative:opaque-token",
    )).toEqual({ token: "opaque-token", value: "negative" });
  });

  test("parses optional feedback detail submissions", () => {
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: "view_submission",
        team: { id: "T-CUSTOMER" },
        user: { id: "U-CUSTOMER", team_id: "T-ACTOR" },
        view: {
          callback_id: "spot_negative_feedback",
          private_metadata: "interaction-1",
          state: {
            values: {
              spot_feedback_comment_block: {
                spot_feedback_comment: {
                  action_id: "spot_feedback_comment",
                  value: "It missed an endorsement.",
                },
              },
            },
          },
        },
      }),
    }).toString();
    expect(parseSlackInteraction(body)).toEqual({
      type: "view_submission",
      teamId: "T-CUSTOMER",
      actorTeamId: "T-ACTOR",
      userId: "U-CUSTOMER",
      callbackId: "spot_negative_feedback",
      privateMetadata: "interaction-1",
      comment: "It missed an endorsement.",
    });
  });

  test("normalizes legacy controls during the 30-day action window", () => {
    const blockBody = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        team: { id: "T-CUSTOMER" },
        user: { id: "U-CUSTOMER", team_id: "T-ACTOR" },
        channel: { id: "C-PRIMARY" },
        actions: [{
          action_id: "glass_request_human",
          value: "opaque-token",
        }],
      }),
    }).toString();
    expect(parseSlackInteraction(blockBody)).toMatchObject({
      type: "block_actions",
      actionId: "spot_request_human",
    });

    const viewBody = new URLSearchParams({
      payload: JSON.stringify({
        type: "view_submission",
        team: { id: "T-CUSTOMER" },
        user: { id: "U-CUSTOMER", team_id: "T-ACTOR" },
        view: {
          callback_id: "glass_negative_feedback",
          private_metadata: "interaction-1",
          state: {
            values: {
              glass_feedback_comment_block: {
                glass_feedback_comment: {
                  action_id: "glass_feedback_comment",
                  value: "It missed an endorsement.",
                },
              },
            },
          },
        },
      }),
    }).toString();
    expect(parseSlackInteraction(viewBody)).toMatchObject({
      type: "view_submission",
      callbackId: "spot_negative_feedback",
      comment: "It missed an endorsement.",
    });
    expect(slackActionToken(
      "glass_response_feedback_negative",
      "negative:opaque-token",
    )).toEqual({ token: "opaque-token", value: "negative" });
    expect(isSlackOperatorClassification("glass_operator")).toBe(true);
    expect(isSlackOperatorClassification("spot_operator")).toBe(true);
  });

  test("rejects malformed and unsupported payloads", () => {
    expect(parseSlackInteraction("payload=not-json")).toBeNull();
    expect(parseSlackInteraction(new URLSearchParams({
      payload: JSON.stringify({ type: "shortcut" }),
    }).toString())).toBeNull();
    expect(slackActionToken("spot_response_feedback", "maybe:token")).toBeNull();
  });
});
