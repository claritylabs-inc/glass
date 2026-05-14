import { createHash, createHmac, randomBytes } from "node:crypto";

export type OperatorAuth = {
  tokenId?: string;
  timestamp: number;
  nonce: string;
  bodyHash: string;
  signature: string;
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signOperatorRequest(params: {
  token: string;
  tokenId?: string;
  body: unknown;
}): OperatorAuth {
  const timestamp = Date.now();
  const nonce = randomBytes(24).toString("hex");
  const bodyHash = sha256Hex(stableStringify(params.body));
  const message = `${params.tokenId ?? ""}.${timestamp}.${nonce}.${bodyHash}`;
  const signature = createHmac("sha256", params.token).update(message).digest("hex");
  return {
    tokenId: params.tokenId,
    timestamp,
    nonce,
    bodyHash,
    signature,
  };
}
