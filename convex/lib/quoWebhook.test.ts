import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { verifyQuoWebhookSignature } from "./quoWebhook";

function signedHeader(args: {
  payload: string;
  timestamp: number;
  signingKey: string;
}) {
  const digest = createHmac("sha256", Buffer.from(args.signingKey, "base64"))
    .update(`${args.timestamp}.${args.payload}`, "utf8")
    .digest("base64");
  return `hmac;1;${args.timestamp};${digest}`;
}

describe("verifyQuoWebhookSignature", () => {
  const now = 1_800_000_000_000;
  const signingKey = randomBytes(32).toString("base64");
  const payload = JSON.stringify({ id: "EV-test", type: "message.received" });

  test("accepts a current authentic signature", async () => {
    await expect(
      verifyQuoWebhookSignature({
        compactPayload: payload,
        signatureHeader: signedHeader({ payload, timestamp: now, signingKey }),
        signingKey,
        now,
      }),
    ).resolves.toBe(true);
  });

  test("rejects tampering and stale replay attempts", async () => {
    const signatureHeader = signedHeader({ payload, timestamp: now, signingKey });
    await expect(
      verifyQuoWebhookSignature({
        compactPayload: `${payload} `,
        signatureHeader,
        signingKey,
        now,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyQuoWebhookSignature({
        compactPayload: payload,
        signatureHeader,
        signingKey,
        now: now + 5 * 60 * 1000 + 1,
      }),
    ).resolves.toBe(false);
  });
});
