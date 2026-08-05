import { describe, expect, test } from "vitest";
import {
  signSlackRequest,
  verifySlackRequest,
} from "./slackSecurity";

describe("Slack request signatures", () => {
  test("accepts a valid raw-body HMAC inside the replay window", async () => {
    const rawBody = JSON.stringify({ event: "messages", value: "exact bytes" });
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1_000));
    const signature = await signSlackRequest("secret", timestamp, rawBody);

    await expect(
      verifySlackRequest({ secret: "secret", timestamp, signature, rawBody, now }),
    ).resolves.toEqual({ ok: true });
  });

  test("rejects missing, stale, and body-mismatched signatures", async () => {
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1_000));
    const signature = await signSlackRequest("secret", timestamp, "body");

    await expect(
      verifySlackRequest({ secret: "secret", timestamp: null, signature, rawBody: "body", now }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature_headers" });
    await expect(
      verifySlackRequest({
        secret: "secret",
        timestamp: String(Number(timestamp) - 301),
        signature,
        rawBody: "body",
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: "stale_timestamp" });
    await expect(
      verifySlackRequest({ secret: "secret", timestamp, signature, rawBody: "changed", now }),
    ).resolves.toEqual({ ok: false, reason: "invalid_signature" });
  });
});
