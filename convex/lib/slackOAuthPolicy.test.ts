import { describe, expect, test } from "vitest";
import {
  missingSlackCustomerScopes,
  missingSlackHostScopes,
  SLACK_CUSTOMER_SCOPES,
  SLACK_HOST_SCOPES,
} from "./slackOAuthPolicy";

describe("Slack OAuth scope policy", () => {
  test("accepts the complete customer installation scope set", () => {
    expect(missingSlackCustomerScopes(SLACK_CUSTOMER_SCOPES)).toEqual([]);
    expect(SLACK_CUSTOMER_SCOPES).toEqual(
      expect.arrayContaining(["im:history", "users:read", "users:read.email"]),
    );
  });

  test("reports every missing required scope", () => {
    expect(missingSlackCustomerScopes(["app_mentions:read", "chat:write"])).toEqual(
      SLACK_CUSTOMER_SCOPES.filter(
        (scope) => scope !== "app_mentions:read" && scope !== "chat:write",
      ),
    );
  });

  test("requires Slack Connect channel scopes for the host installation", () => {
    expect(missingSlackHostScopes(SLACK_HOST_SCOPES)).toEqual([]);
    expect(missingSlackHostScopes(SLACK_CUSTOMER_SCOPES)).toEqual([
      "groups:write",
      "conversations.connect:write",
    ]);
  });
});
