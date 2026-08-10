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
        botToken: teamId === "T-CLARITY" ? "xoxb-clarity" : "xoxb-customer",
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
          profile: { email: "admin@customer.test" },
        },
      });
    }
    if (request.url === "/api/conversations.create") {
      return respond(response, {
        ok: true,
        channel: { id: "C-HOST", name: "glass-client" },
      });
    }
    if (request.url === "/api/conversations.members") {
      return respond(response, {
        ok: true,
        members: ["U-ALREADY"],
        response_metadata: { next_cursor: "" },
      });
    }
    if (request.url === "/api/conversations.invite") {
      return respond(response, { ok: true });
    }
    if (request.url === "/api/conversations.inviteShared") {
      return respond(response, { ok: true, invite_id: "I-1" });
    }
    if (request.url === "/api/conversations.list") {
      return respond(response, {
        ok: true,
        channels: [
          {
            id: "C-CUSTOMER",
            name: "client-service",
            is_member: true,
            is_archived: false,
            is_private: false,
            is_shared: false,
          },
          {
            id: "C-NOT-JOINED",
            name: "general",
            is_member: false,
            is_archived: false,
            is_private: false,
            is_shared: false,
          },
          {
            id: "G-PRIVATE",
            name: "private-claims",
            is_member: true,
            is_archived: false,
            is_private: true,
            is_shared: false,
          },
          {
            id: "C-SHARED",
            name: "shared-support",
            is_member: true,
            is_archived: false,
            is_private: false,
            is_shared: true,
          },
          {
            id: "G-PRIVATE-NOT-JOINED",
            name: "private-not-joined",
            is_member: false,
            is_archived: false,
            is_private: true,
            is_shared: false,
          },
        ],
        response_metadata: { next_cursor: "" },
      });
    }
    if (request.url === "/api/conversations.join") {
      return respond(response, {
        ok: true,
        channel: {
          id: "C-NOT-JOINED",
          name: "general",
          is_member: true,
          is_private: false,
          is_shared: false,
        },
      });
    }
    if (request.url === "/api/conversations.leave") {
      return respond(response, { ok: true });
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
      email: "admin@customer.test",
      isBot: false,
      botUserId: "U-GLASS",
    });
  });

  test("uses the separate Clarity installation for Connect provisioning", async () => {
    const response = await workerRequest("/connect-channel", {
      clientSlug: "client",
      inviteEmail: "admin@client.test",
      operatorUserIds: ["U-ALREADY", "U-NEW", "U-NEW"],
    });
    assert.deepEqual(await response.json(), {
      channelId: "C-HOST",
      channelName: "glass-client",
      inviteId: "I-1",
      reusedChannel: false,
      operatorInvites: { requested: 2, succeeded: true },
      supportInvite: { succeeded: true, pending: true },
    });
    const calls = apiCalls.filter((call) =>
      call.path.startsWith("/api/conversations."),
    );
    assert.equal(calls.length, 4);
    assert(calls.every((call) => call.authorization === "Bearer xoxb-clarity"));
    assert.deepEqual(
      calls.find((call) => call.path === "/api/conversations.invite")?.body,
      { channel: "C-HOST", users: "U-NEW", force: true },
    );

    const retry = await workerRequest("/connect-channel", {
      clientSlug: "client",
      inviteEmail: "admin@client.test",
      operatorUserIds: ["U-ALREADY"],
      existingChannelId: "C-HOST",
      existingChannelName: "glass-client",
    });
    assert.deepEqual(await retry.json(), {
      channelId: "C-HOST",
      channelName: "glass-client",
      inviteId: "I-1",
      reusedChannel: true,
      operatorInvites: { requested: 1, succeeded: true },
      supportInvite: { succeeded: true, pending: true },
    });
    assert.equal(
      apiCalls.filter(
        (call) => call.path === "/api/conversations.create",
      ).length,
      1,
    );
    assert.equal(
      apiCalls.filter(
        (call) => call.path === "/api/conversations.invite",
      ).length,
      1,
    );
  });

  test("lists visible public channels and joined private/shared channels", async () => {
    const response = await workerRequest("/channels", {
      teamId: "T-CUSTOMER",
    });
    assert.deepEqual(await response.json(), {
      channels: [
        {
          id: "C-CUSTOMER",
          name: "client-service",
          isMember: true,
          isPrivate: false,
          isShared: false,
        },
        {
          id: "C-NOT-JOINED",
          name: "general",
          isMember: false,
          isPrivate: false,
          isShared: false,
        },
        {
          id: "G-PRIVATE",
          name: "private-claims",
          isMember: true,
          isPrivate: true,
          isShared: false,
        },
        {
          id: "C-SHARED",
          name: "shared-support",
          isMember: true,
          isPrivate: false,
          isShared: true,
        },
      ],
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/conversations.list"),
      {
        path: "/api/conversations.list",
        authorization: "Bearer xoxb-customer",
        body: {
          types: "public_channel,private_channel",
          exclude_archived: true,
          limit: 200,
        },
      },
    );
  });

  test("joins a visible public customer channel", async () => {
    const response = await workerRequest("/channels/join", {
      teamId: "T-CUSTOMER",
      channelId: "C-NOT-JOINED",
    });
    assert.deepEqual(await response.json(), {
      channel: {
        id: "C-NOT-JOINED",
        name: "general",
        isMember: true,
        isPrivate: false,
        isShared: false,
      },
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/conversations.join"),
      {
        path: "/api/conversations.join",
        authorization: "Bearer xoxb-customer",
        body: { channel: "C-NOT-JOINED" },
      },
    );
  });

  test("does not join private or shared channels from Glass", async () => {
    const joinCallsBefore = apiCalls.filter(
      (call) => call.path === "/api/conversations.join",
    ).length;
    for (const channelId of ["G-PRIVATE", "C-SHARED"]) {
      const response = await workerRequest("/channels/join", {
        teamId: "T-CUSTOMER",
        channelId,
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "Only public workspace channels can be joined from Glass",
      });
    }
    assert.equal(
      apiCalls.filter((call) => call.path === "/api/conversations.join")
        .length,
      joinCallsBefore,
    );
  });

  test("leaves a joined public customer channel", async () => {
    const response = await workerRequest("/channels/leave", {
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
    });
    assert.deepEqual(await response.json(), {
      channel: {
        id: "C-CUSTOMER",
        name: "client-service",
        isMember: false,
        isPrivate: false,
        isShared: false,
      },
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/conversations.leave"),
      {
        path: "/api/conversations.leave",
        authorization: "Bearer xoxb-customer",
        body: { channel: "C-CUSTOMER" },
      },
    );
  });

  test("does not leave private or shared channels from Glass", async () => {
    for (const channelId of ["G-PRIVATE", "C-SHARED"]) {
      const response = await workerRequest("/channels/leave", {
        teamId: "T-CUSTOMER",
        channelId,
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "Private and Slack Connect channels are managed in Slack",
      });
    }
  });
});
