/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  createAuthorizationCode,
  exchangeAuthCode,
  refreshAccessToken,
  registerClient,
  validateAccessTokenWithScopes,
} from "./oauth";

const modules = import.meta.glob("./**/*.ts");
const createAuthorizationCodeFn = createAuthorizationCode as any;
const exchangeAuthCodeFn = exchangeAuthCode as any;
const refreshAccessTokenFn = refreshAccessToken as any;
const registerClientFn = registerClient as any;
const validateAccessTokenWithScopesFn = validateAccessTokenWithScopes as any;
const REDIRECT_URI = "https://app.example/callback";

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function pkceChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function seedOAuthClientAndUser() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      email: "alice@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });
    return { orgId, userId };
  });

  const client = await t.mutation(registerClientFn, {
    clientName: "Test OAuth App",
    redirectUris: [REDIRECT_URI],
  });

  return {
    t,
    ...ids,
    clientId: client.client_id as string,
    verifier: "test-code-verifier",
    codeChallenge: await pkceChallenge("test-code-verifier"),
  };
}

type OAuthTestHandle = Awaited<ReturnType<typeof seedOAuthClientAndUser>>["t"];

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function createCode(options: {
  t: OAuthTestHandle;
  userId: Id<"users">;
  clientId: string;
  codeChallenge: string;
  scope?: string;
}) {
  return options.t
    .withIdentity(sessionFor(options.userId))
    .mutation(createAuthorizationCodeFn, {
      clientId: options.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: options.codeChallenge,
      scope: options.scope,
    });
}

async function getAuthCodeRecord(t: OAuthTestHandle, codeRaw: string) {
  const codeHash = await sha256Hex(codeRaw);
  return t.run(async (ctx) =>
    ctx.db
      .query("oauthAuthCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .first(),
  );
}

async function validateRawAccessToken(
  t: OAuthTestHandle,
  accessToken: string,
) {
  return t.query(validateAccessTokenWithScopesFn, {
    tokenHash: await sha256Hex(accessToken),
  });
}

describe("oauth scopes", () => {
  test("defaults missing requested scope to read-only through exchange", async () => {
    const { t, userId, clientId, codeChallenge, verifier } =
      await seedOAuthClientAndUser();

    const codeRaw = await createCode({ t, userId, clientId, codeChallenge });
    const codeRecord = await getAuthCodeRecord(t, codeRaw);
    expect(codeRecord).toMatchObject({
      scope: "read",
      scopes: ["read"],
    });

    const exchanged = await t.mutation(exchangeAuthCodeFn, {
      codeRaw,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    const token = await validateRawAccessToken(t, exchanged.access_token);

    expect(token?.scopes).toEqual(["read"]);
  });

  test("preserves read write scopes through exchange and refresh", async () => {
    const { t, userId, clientId, codeChallenge, verifier } =
      await seedOAuthClientAndUser();

    const codeRaw = await createCode({
      t,
      userId,
      clientId,
      codeChallenge,
      scope: "read write read",
    });
    const codeRecord = await getAuthCodeRecord(t, codeRaw);
    expect(codeRecord).toMatchObject({
      scope: "read write",
      scopes: ["read", "write"],
    });

    const exchanged = await t.mutation(exchangeAuthCodeFn, {
      codeRaw,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    const firstToken = await validateRawAccessToken(t, exchanged.access_token);
    expect(firstToken?.scopes).toEqual(["read", "write"]);

    const refreshed = await t.mutation(refreshAccessTokenFn, {
      refreshTokenRaw: exchanged.refresh_token,
      clientId,
    });
    const refreshedToken = await validateRawAccessToken(t, refreshed.access_token);

    expect(refreshedToken?.scopes).toEqual(["read", "write"]);
  });

  test("rejects unsupported requested scopes", async () => {
    const { t, userId, clientId, codeChallenge } = await seedOAuthClientAndUser();

    await expect(
      createCode({
        t,
        userId,
        clientId,
        codeChallenge,
        scope: "read delete",
      }),
    ).rejects.toThrow("invalid_scope: unsupported scope delete");

    const codes = await t.run(async (ctx) => ctx.db.query("oauthAuthCodes").collect());
    expect(codes).toHaveLength(0);
  });

  test("validates legacy tokens that only stored the scope string", async () => {
    const { t, orgId, userId, clientId } = await seedOAuthClientAndUser();
    const rawToken = "prsm_at_legacy";
    await t.run(async (ctx) => {
      await ctx.db.insert("oauthTokens", {
        tokenHash: await sha256Hex(rawToken),
        clientId,
        userId,
        orgId,
        scope: "read write",
        expiresAt: dayjs().add(1, "hour").valueOf(),
        createdAt: dayjs().valueOf(),
      });
    });

    const token = await validateRawAccessToken(t, rawToken);

    expect(token?.scopes).toEqual(["read", "write"]);
  });
});
