const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyQuoWebhookSignature(args: {
  compactPayload: string;
  signatureHeader: string;
  signingKey: string;
  now: number;
}): Promise<boolean> {
  let binaryKey: ArrayBuffer;
  try {
    binaryKey = decodeBase64(args.signingKey);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    binaryKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  const signatures = args.signatureHeader
    .split(",")
    .map((value) => value.trim());

  for (const signature of signatures) {
    const [scheme, version, timestamp, providedDigest] = signature.split(";");
    if (scheme !== "hmac" || version !== "1" || !providedDigest) continue;

    const timestampMs = Number(timestamp);
    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(args.now - timestampMs) > MAX_TIMESTAMP_AGE_MS
    ) {
      continue;
    }

    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestamp}.${args.compactPayload}`),
    );
    if (constantTimeEqual(encodeBase64(digest), providedDigest)) return true;
  }

  return false;
}
