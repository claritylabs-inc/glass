import { describe, expect, test } from "vitest";

import {
  resolveSlackAutomaticChannel,
  resolveSlackAutomaticChannelId,
  resolveSlackSupportChannelId,
} from "./slackChannelRouting";

describe("Slack channel routing", () => {
  test("keeps automatic delivery independent from the support channel", () => {
    expect(
      resolveSlackAutomaticChannelId({
        automaticChannelId: "C-AUTOMATIC",
        automaticChannelRoutingConfiguredAt: 1,
      }),
    ).toBe("C-AUTOMATIC");
    expect(
      resolveSlackAutomaticChannel({
        automaticChannelId: "C-AUTOMATIC",
        automaticChannelName: "insurance",
        automaticChannelRoutingConfiguredAt: 1,
      }),
    ).toEqual({
      channelId: "C-AUTOMATIC",
      channelName: "insurance",
    });
    expect(
      resolveSlackSupportChannelId({
        customerChannelId: "C-SUPPORT-CUSTOMER",
        hostChannelId: "C-SUPPORT-HOST",
      }),
    ).toBe("C-SUPPORT-CUSTOMER");
  });

  test("does not silently enable automatic delivery from a support binding", () => {
    expect(
      resolveSlackAutomaticChannelId(
        { automaticChannelRoutingConfiguredAt: 1 },
        { hostChannelId: "C-SUPPORT-HOST" },
      ),
    ).toBeUndefined();
    expect(
      resolveSlackSupportChannelId({ hostChannelId: "C-SUPPORT-HOST" }),
    ).toBe("C-SUPPORT-HOST");
  });

  test("keeps the existing support destination until legacy rows are configured", () => {
    expect(
      resolveSlackAutomaticChannelId(
        {},
        {
          customerChannelId: "C-LEGACY-CUSTOMER",
          hostChannelId: "C-LEGACY-HOST",
        },
      ),
    ).toBe("C-LEGACY-CUSTOMER");
    expect(
      resolveSlackAutomaticChannel(
        {},
        {
          customerChannelId: "C-LEGACY-CUSTOMER",
          hostChannelId: "C-LEGACY-HOST",
          channelName: "spot-cove",
        },
      ),
    ).toEqual({
      channelId: "C-LEGACY-CUSTOMER",
      channelName: "spot-cove",
    });
  });
});
