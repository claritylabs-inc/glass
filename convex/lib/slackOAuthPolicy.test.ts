import { describe, expect, test } from "vitest";
import {
  missingSlackCustomerScopes,
  SLACK_CUSTOMER_SCOPES,
} from "./slackOAuthPolicy";

describe("Slack OAuth scope policy", () => {
  test("accepts the complete customer installation scope set", () => {
    expect(missingSlackCustomerScopes(SLACK_CUSTOMER_SCOPES)).toEqual([]);
  });

  test("reports every missing required scope", () => {
    expect(missingSlackCustomerScopes(["app_mentions:read", "chat:write"])).toEqual(
      SLACK_CUSTOMER_SCOPES.filter(
        (scope) => scope !== "app_mentions:read" && scope !== "chat:write",
      ),
    );
  });
});
