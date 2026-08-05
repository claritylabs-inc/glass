import { describe, expect, test } from "vitest";
import {
  signSpectrumWebhook,
  verifySpectrumWebhook,
} from "./slackSecurity";

describe("Spectrum Slack webhook signatures", () => {
  test("accepts a valid raw-body HMAC inside the replay window", async () => {
    const rawBody = JSON.stringify({ event: "messages", value: "exact bytes" });
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1_000));
    const signature = await signSpectrumWebhook("secret", timestamp, rawBody);

    await expect(
      verifySpectrumWebhook({ secret: "secret", timestamp, signature, rawBody, now }),
    ).resolves.toEqual({ ok: true });
  });

  test("rejects missing, stale, and body-mismatched signatures", async () => {
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1_000));
    const signature = await signSpectrumWebhook("secret", timestamp, "body");

    await expect(
      verifySpectrumWebhook({ secret: "secret", timestamp: null, signature, rawBody: "body", now }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature_headers" });
    await expect(
      verifySpectrumWebhook({
        secret: "secret",
        timestamp: String(Number(timestamp) - 301),
        signature,
        rawBody: "body",
        now,
      }),
    ).resolves.toEqual({ ok: false, reason: "stale_timestamp" });
    await expect(
      verifySpectrumWebhook({ secret: "secret", timestamp, signature, rawBody: "changed", now }),
    ).resolves.toEqual({ ok: false, reason: "invalid_signature" });
  });
});
