import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { URL } from "node:url";
import { GlassConfig } from "./types.js";

function b64url(input: Buffer) {
  return input.toString("base64url");
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

async function exchangeCodeForToken(params: {
  baseUrl: string;
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(`${params.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await response.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !json.access_token) {
    const message = json.error_description ?? json.error ?? `OAuth token exchange failed (${response.status})`;
    throw new Error(message);
  }

  return json;
}

export async function loginWithBrowser(config: GlassConfig): Promise<Partial<GlassConfig>> {
  const state = b64url(randomBytes(16));
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const port = 8917;
  const clientId = "glass-cli";
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(`${config.baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log(`Open this URL to authenticate:\n${authUrl.toString()}`);

  const authCode = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", redirectUri);
      if (reqUrl.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const returnedState = reqUrl.searchParams.get("state");
      const code = reqUrl.searchParams.get("code");
      const oauthError = reqUrl.searchParams.get("error");

      if (oauthError) {
        res.statusCode = 400;
        res.end(`Authentication failed: ${oauthError}`);
        reject(new Error(`OAuth authorization failed: ${oauthError}`));
        server.close();
        return;
      }

      if (returnedState !== state || !code) {
        res.statusCode = 400;
        res.end("Authentication failed");
        reject(new Error("Invalid OAuth callback state or missing code"));
        server.close();
        return;
      }

      res.statusCode = 200;
      res.end("Authenticated. Return to terminal.");
      resolve(code);
      server.close();
    });

    server.listen(port, "127.0.0.1");
    setTimeout(() => {
      reject(new Error("Timed out waiting for OAuth callback"));
      server.close();
    }, 5 * 60_000);
  });

  const token = await exchangeCodeForToken({
    baseUrl: config.baseUrl,
    code: authCode,
    clientId,
    redirectUri,
    codeVerifier,
  });

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
  };
}
