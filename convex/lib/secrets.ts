// convex/lib/secrets.ts
// AES-256-GCM encryption for integration account tokens stored at rest.
// Key source: INTEGRATION_TOKEN_ENC_KEY env var (base64url-encoded 32-byte key).
// In dev/test when the env var is absent, a fixed dev key is used with a console warning.

const DEV_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes

function getKeyMaterial(): Uint8Array {
  const raw = process.env.INTEGRATION_TOKEN_ENC_KEY ?? "";
  if (!raw) {
    console.warn(
      "[secrets] INTEGRATION_TOKEN_ENC_KEY not set — using dev key. DO NOT use in production.",
    );
    return Uint8Array.from(atob(DEV_KEY_B64), (c) => c.charCodeAt(0));
  }
  return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
}

async function getCryptoKey(usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", getKeyMaterial(), "AES-GCM", false, usage);
}

/** Encrypt plaintext → base64url-encoded ciphertext with embedded 12-byte IV. */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getCryptoKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  // Layout: [12-byte iv][ciphertext]
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), 12);
  return btoa(String.fromCharCode(...combined))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decrypt base64url-encoded ciphertext produced by `encrypt`. */
export async function decrypt(ciphertext: string): Promise<string> {
  const key = await getCryptoKey(["decrypt"]);
  // Normalize base64url → base64
  const b64 = ciphertext.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const combined = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}
