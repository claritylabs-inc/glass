import { afterEach, describe, expect, it } from "vitest";

import {
  isApprovedOperatorSlackChannel,
  isSafeOperatorSlackConversation,
} from "./operatorSlackConfig";

const originalChannelIds = process.env.OPERATOR_SLACK_CHANNEL_IDS;

afterEach(() => {
  if (originalChannelIds === undefined) {
    delete process.env.OPERATOR_SLACK_CHANNEL_IDS;
  } else {
    process.env.OPERATOR_SLACK_CHANNEL_IDS = originalChannelIds;
  }
});

describe("operator Slack conversation safety", () => {
  it("allows DMs and joined private host channels only", () => {
    expect(
      isSafeOperatorSlackConversation({ isDirectMessage: true }),
    ).toBe(true);
    expect(
      isSafeOperatorSlackConversation({
        isDirectMessage: false,
        isMember: true,
        isPrivate: true,
        isShared: false,
      }),
    ).toBe(true);
    expect(
      isSafeOperatorSlackConversation({
        isDirectMessage: false,
        isMember: true,
        isPrivate: false,
        isShared: false,
      }),
    ).toBe(false);
    expect(
      isSafeOperatorSlackConversation({
        isDirectMessage: false,
        isMember: true,
        isPrivate: true,
        isShared: true,
      }),
    ).toBe(false);
  });
});

describe("operator Slack channel narrowing", () => {
  it("fails closed when no channel allowlist is configured", () => {
    delete process.env.OPERATOR_SLACK_CHANNEL_IDS;
    expect(isApprovedOperatorSlackChannel("C-INTERNAL")).toBe(false);
  });

  it("allows only explicitly listed channels when narrowed", () => {
    process.env.OPERATOR_SLACK_CHANNEL_IDS = "C-ONE, C-TWO";
    expect(isApprovedOperatorSlackChannel("C-TWO")).toBe(true);
    expect(isApprovedOperatorSlackChannel("C-THREE")).toBe(false);
  });
});
