import { readFileSync } from "node:fs";
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
      expect.arrayContaining([
        "channels:join",
        "channels:write",
        "im:history",
        "users:read",
        "users:read.email",
      ]),
    );
  });

  test("keeps deployed manifests in sync with the host scope policy", () => {
    const manifest = JSON.parse(
      readFileSync("slack-worker/manifests/production.json", "utf8"),
    ) as { oauth_config: { scopes: { bot: string[] } } };
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining([...SLACK_HOST_SCOPES]),
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
