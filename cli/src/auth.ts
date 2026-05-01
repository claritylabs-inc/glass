import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import { GlassConfig } from "./types.js";

function b64url(input: Buffer) {
  return input.toString("base64url");
}

export async function loginWithBrowser(config: GlassConfig): Promise<Partial<GlassConfig>> {
  const state = b64url(randomBytes(16));
  const port = 8917;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authUrl = new URL(`${config.baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("client_id", "glass-cli");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  console.log(`Open this URL to authenticate:\n${authUrl.toString()}`);

  const tokenResult = await new Promise<{ accessToken: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", redirectUri);
      if (reqUrl.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const returnedState = reqUrl.searchParams.get("state");
      const accessToken = reqUrl.searchParams.get("access_token");
      if (returnedState !== state || !accessToken) {
        res.statusCode = 400;
        res.end("Authentication failed");
        reject(new Error("Invalid OAuth callback state or token"));
        server.close();
        return;
      }
      res.statusCode = 200;
      res.end("Authenticated. Return to terminal.");
      resolve({ accessToken });
      server.close();
    });

    server.listen(port, "127.0.0.1");
    setTimeout(() => {
      reject(new Error("Timed out waiting for OAuth callback"));
      server.close();
    }, 5 * 60_000);
  });

  return { accessToken: tokenResult.accessToken };
}
