import dayjs from "dayjs";

const SIGNATURE_PREFIX = "v0=";
export const SLACK_REQUEST_REPLAY_WINDOW_SECONDS = 5 * 60;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function equalConstantTime(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function signSlackRequest(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
  return `${SIGNATURE_PREFIX}${hex(signature)}`;
}

export async function verifySlackRequest(args: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!args.timestamp || !args.signature) {
    return { ok: false, reason: "missing_signature_headers" };
  }

  const timestampSeconds = Number(args.timestamp);
  const nowSeconds = Math.floor((args.now ?? dayjs().valueOf()) / 1000);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) >
      SLACK_REQUEST_REPLAY_WINDOW_SECONDS
  ) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = await signSlackRequest(
    args.secret,
    args.timestamp,
    args.rawBody,
  );
  return equalConstantTime(expected, args.signature)
    ? { ok: true }
    : { ok: false, reason: "invalid_signature" };
}
