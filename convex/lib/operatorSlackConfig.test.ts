import { afterEach, describe, expect, it } from "vitest";

import { isApprovedOperatorSlackChannel } from "./operatorSlackConfig";

const originalChannelIds = process.env.OPERATOR_SLACK_CHANNEL_IDS;

afterEach(() => {
  if (originalChannelIds === undefined) {
    delete process.env.OPERATOR_SLACK_CHANNEL_IDS;
  } else {
    process.env.OPERATOR_SLACK_CHANNEL_IDS = originalChannelIds;
  }
});

describe("operator Slack channel narrowing", () => {
  it("allows every host channel when no narrowing list is configured", () => {
    delete process.env.OPERATOR_SLACK_CHANNEL_IDS;
    expect(isApprovedOperatorSlackChannel("C-INTERNAL")).toBe(true);
  });

  it("allows only explicitly listed channels when narrowed", () => {
    process.env.OPERATOR_SLACK_CHANNEL_IDS = "C-ONE, C-TWO";
    expect(isApprovedOperatorSlackChannel("C-TWO")).toBe(true);
    expect(isApprovedOperatorSlackChannel("C-THREE")).toBe(false);
  });
});
