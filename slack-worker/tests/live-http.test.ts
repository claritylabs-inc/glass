import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

let worker: ChildProcess;
let provider: http.Server;
let workerOrigin: string;
let providerOrigin: string;
const apiCalls: Array<{
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
}> = [];

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function readJson(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function respond(response: http.ServerResponse, body: unknown) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${workerOrigin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Live Slack worker did not become healthy");
}

async function workerRequest(path: string, body: Record<string, unknown>) {
  return await fetch(`${workerOrigin}${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  const providerPort = await freePort();
  providerOrigin = `http://127.0.0.1:${providerPort}`;
  provider = http.createServer(async (request, response) => {
    const body = await readJson(request);
    apiCalls.push({
      path: request.url ?? "",
      authorization: request.headers.authorization,
      body,
    });
    if (request.url === "/slack-worker/installation") {
      const teamId = String(body.teamId);
      return respond(response, {
        teamId,
        botToken:
          teamId === "T-CLARITY" ? "xoxb-clarity" : "xoxb-customer",
        botUserId: "U-GLASS",
      });
    }
    if (request.url === "/api/chat.postMessage") {
      return respond(response, { ok: true, ts: "1800000000.100" });
    }
    if (request.url === "/api/users.info") {
      return respond(response, {
        ok: true,
        user: {
          id: "U-CUSTOMER",
          team_id: "T-CUSTOMER",
          real_name: "Customer Admin",
        },
      });
    }
    if (request.url === "/api/conversations.create") {
      return respond(response, {
        ok: true,
        channel: { id: "C-HOST", name: "glass-client" },
      });
    }
    if (request.url === "/api/conversations.inviteShared") {
      return respond(response, { ok: true, invite_id: "I-1" });
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    provider.listen(providerPort, "127.0.0.1", resolve),
  );

  const workerPort = await freePort();
  workerOrigin = `http://127.0.0.1:${workerPort}`;
  worker = spawn(process.execPath, ["dist/src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GLASS_ENV: "staging",
      SLACK_WORKER_MODE: "slack",
      SLACK_WORKER_SECRET: "test-secret",
      CONVEX_SITE_URL: providerOrigin,
      SLACK_API_BASE_URL: `${providerOrigin}/api`,
      SLACK_CLARITY_TEAM_ID: "T-CLARITY",
      PORT: String(workerPort),
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  if (worker?.exitCode === null) {
    worker.kill("SIGTERM");
    await new Promise<void>((resolve) => worker.once("exit", () => resolve()));
  }
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

describe("native Slack worker HTTP adapter", () => {
  test("uses the Convex token broker and Slack Web API directly", async () => {
    const health = await fetch(`${workerOrigin}/health`).then((response) =>
      response.json(),
    );
    assert.equal(health.mode, "slack");
    assert.equal(health.tokenBrokerConfigured, true);
    assert.equal(health.clarityTeamConfigured, true);

    const send = await workerRequest("/send", {
      clientMessageId: "native-send-1",
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      text: "**Policy:** [Open](https://example.test/policy)",
    });
    assert.deepEqual(await send.json(), {
      messageId: "1800000000.100",
      attachmentFailures: [],
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/chat.postMessage"),
      {
        path: "/api/chat.postMessage",
        authorization: "Bearer xoxb-customer",
        body: {
          channel: "C-CUSTOMER",
          text: "*Policy:* <https://example.test/policy|Open>",
          mrkdwn: true,
        },
      },
    );

    const actor = await workerRequest("/actor", {
      teamId: "T-CUSTOMER",
      userId: "U-CUSTOMER",
    });
    assert.deepEqual(await actor.json(), {
      teamId: "T-CUSTOMER",
      userId: "U-CUSTOMER",
      displayName: "Customer Admin",
      isBot: false,
      botUserId: "U-GLASS",
    });
  });

  test("uses the separate Clarity installation for Connect provisioning", async () => {
    const response = await workerRequest("/connect-channel", {
      clientSlug: "client",
      inviteEmail: "admin@client.test",
    });
    assert.deepEqual(await response.json(), {
      channelId: "C-HOST",
      channelName: "glass-client",
      inviteId: "I-1",
    });
    const calls = apiCalls.filter((call) =>
      call.path.startsWith("/api/conversations."),
    );
    assert.equal(calls.length, 2);
    assert(calls.every((call) => call.authorization === "Bearer xoxb-clarity"));
  });
});
