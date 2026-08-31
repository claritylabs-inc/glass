/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { resolveInstallation } from "./actions/slackCredentials";
import {
  decryptSlackCredential,
  encryptSlackCredential,
} from "./lib/slackCredentials";

const modules = import.meta.glob("./**/*.ts");
const resolveInstallationFn = resolveInstallation as any;

beforeEach(() => {
  vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", "slack-encryption-test-key");
  vi.stubEnv("SLACK_CLIENT_ID", "client-id");
  vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Slack installation credentials", () => {
  test("binds ciphertext to the workspace identity", () => {
    const encrypted = encryptSlackCredential("xoxb-secret", "T-ONE");
    expect(decryptSlackCredential(encrypted, "T-ONE")).toBe("xoxb-secret");
    expect(() => decryptSlackCredential(encrypted, "T-TWO")).toThrow();
    expect(encrypted).not.toContain("xoxb-secret");
  });

  test("rotates an expiring bot token and persists the new one", async () => {
    const t = convexTest(schema, modules);
    const installationId = await t.run(async (ctx) =>
      await ctx.db.insert("slackInstallations", {
        teamId: "T-CUSTOMER",
        teamName: "Customer",
        kind: "customer",
        botUserId: "U-SPOT",
        encryptedBotToken: encryptSlackCredential(
          "xoxe.xoxb-old",
          "T-CUSTOMER",
        ),
        encryptedRefreshToken: encryptSlackCredential(
          "xoxe-refresh-old",
          "T-CUSTOMER",
        ),
        botTokenExpiresAt: 1,
        grantedScopes: ["chat:write"],
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxe.xoxb-new",
            refresh_token: "xoxe-refresh-new",
            expires_in: 43_200,
            bot_user_id: "U-SPOT",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      t.action(resolveInstallationFn, { teamId: "T-CUSTOMER" }),
    ).resolves.toMatchObject({
      teamId: "T-CUSTOMER",
      botToken: "xoxe.xoxb-new",
      botUserId: "U-SPOT",
    });
    const installation = await t.run((ctx) => ctx.db.get(installationId));
    expect(
      decryptSlackCredential(
        installation?.encryptedBotToken ?? "",
        "T-CUSTOMER",
      ),
    ).toBe("xoxe.xoxb-new");
    expect(
      decryptSlackCredential(
        installation?.encryptedRefreshToken ?? "",
        "T-CUSTOMER",
      ),
    ).toBe("xoxe-refresh-new");
  });
});
