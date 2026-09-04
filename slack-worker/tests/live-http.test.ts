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

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (
    request.headers["content-type"]?.startsWith(
      "application/x-www-form-urlencoded",
    )
  ) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return JSON.parse(body);
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
    if (request.url === "/source.pdf") {
      response.writeHead(200, { "Content-Type": "application/pdf" });
      return response.end("policy");
    }
    if (request.url === "/upload") {
      response.writeHead(200);
      return response.end();
    }
    const body = await readBody(request);
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
        botUserId: "U-SPOT",
      });
    }
    if (request.url === "/api/chat.postMessage") {
      return respond(response, { ok: true, ts: "1800000000.100" });
    }
    if (request.url === "/api/chat.update") {
      return respond(response, { ok: true, ts: "1800000000.100" });
    }
    if (request.url === "/api/chat.appendStream") {
      return respond(response, { ok: true });
    }
    if (request.url === "/api/chat.stopStream") {
      return respond(response, { ok: true, ts: "1800000000.100" });
    }
    if (request.url === "/api/files.getUploadURLExternal") {
      if (
        !request.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        return respond(response, { ok: false, error: "invalid_arguments" });
      }
      return respond(response, {
        ok: true,
        upload_url: `${providerOrigin}/upload`,
        file_id:
          body.filename === "delayed-share.pdf" ? "F-DELAYED" : "F-POLICY",
      });
    }
    if (request.url === "/api/files.completeUploadExternal") {
      const files = body.files as Array<{ id?: string }> | undefined;
      if (files?.[0]?.id === "F-DELAYED") {
        return respond(response, { ok: true, files: [{ id: "F-DELAYED" }] });
      }
      return respond(response, {
        ok: true,
        files: [
          {
            id: "F-POLICY",
            shares: {
              private: { "C-CUSTOMER": [{ ts: "1800000000.200" }] },
            },
          },
        ],
      });
    }
    if (request.url === "/api/files.info") {
      if (
        !request.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        return respond(response, { ok: false, error: "file_not_found" });
      }
      if (body.file === "F-DELAYED") {
        return respond(response, { ok: false, error: "file_not_found" });
      }
      return respond(response, {
        ok: true,
        file: {
          url_private_download: `${providerOrigin}/source.pdf`,
          shares: {
            private: { "C-CUSTOMER": [{ ts: "1800000000.200" }] },
          },
        },
      });
    }
    if (request.url === "/api/users.info") {
      if (
        !request.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        return respond(response, { ok: false, error: "user_not_found" });
      }
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
    if (request.url === "/api/conversations.info") {
      return respond(response, {
        ok: true,
        channel: {
          id: body.channel,
          name: "client-service",
          is_member: true,
        },
      });
    }
    if (request.url === "/api/conversations.replies") {
      return respond(response, {
        ok: true,
        messages: [
          {
            type: "message",
            user: "U-OPERATOR",
            text: "Original building quote requirements",
            ts: "1800000000.000",
            files: [{ id: "F-APPRAISAL", name: "appraisal.pdf" }],
          },
          {
            type: "message",
            user: "U-SPOT",
            text: "Please provide the client name.",
            ts: "1800000000.050",
          },
          {
            type: "message",
            user: "U-OPERATOR",
            text: "Use Sigillo Supply",
            ts: "1800000000.100",
          },
        ],
        has_more: false,
        response_metadata: { next_cursor: "" },
      });
    }
    if (request.url === "/api/conversations.create") {
      return respond(response, {
        ok: true,
        channel: { id: "C-HOST", name: "spot-client" },
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
      SPOT_ENV: "production",
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
    assert.equal(health.reconciliationEnabled, true);
    assert.equal(health.clarityTeamConfigured, true);

    const send = await workerRequest("/send", {
      clientMessageId: "native-send-1",
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      mrkdwnText:
        "*Policy:* <https://example.test/policy|Open>\nStatus: :bound:",
    });
    assert.deepEqual(await send.json(), {
      messageId: "1800000000.100",
      attachmentFailures: [],
    });
    const chatCall = apiCalls.find(
      (call) => call.path === "/api/chat.postMessage",
    );
    assert(chatCall);
    const { client_msg_id: clientMessageId, ...chatBody } = chatCall.body;
    assert.deepEqual(chatBody, {
      channel: "C-CUSTOMER",
      text: "*Policy:* <https://example.test/policy|Open>\nStatus: :bound:",
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false,
    });
    assert.match(
      String(clientMessageId),
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
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
      botUserId: "U-SPOT",
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/users.info"),
      {
        path: "/api/users.info",
        authorization: "Bearer xoxb-customer",
        body: { user: "U-CUSTOMER" },
      },
    );
    const channel = await workerRequest("/channel", {
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
    });
    assert.deepEqual(await channel.json(), {
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      name: "client-service",
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/conversations.info"),
      {
        path: "/api/conversations.info",
        authorization: "Bearer xoxb-customer",
        body: { channel: "C-CUSTOMER", include_num_members: "false" },
      },
    );

    const threadContext = await workerRequest("/thread-context", {
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      threadTs: "1800000000.000",
      latestMessageTs: "1800000000.100",
    });
    assert.deepEqual(await threadContext.json(), {
      messages: [
        {
          messageTs: "1800000000.000",
          senderUserId: "U-OPERATOR",
          content:
            "Original building quote requirements\n[Attached appraisal.pdf]",
        },
        {
          messageTs: "1800000000.100",
          senderUserId: "U-OPERATOR",
          content: "Use Sigillo Supply",
        },
      ],
      truncated: false,
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/conversations.replies"),
      {
        path: "/api/conversations.replies",
        authorization: "Bearer xoxb-customer",
        body: {
          channel: "C-CUSTOMER",
          ts: "1800000000.000",
          latest: "1800000000.100",
          inclusive: "true",
          limit: "100",
        },
      },
    );
  });

  test("uses form encoding for Slack file metadata and upload URL calls", async () => {
    const attachment = await workerRequest("/attachment", {
      teamId: "T-CUSTOMER",
      fileId: "F-POLICY",
    });
    assert.equal(await attachment.text(), "policy");

    const send = await workerRequest("/send", {
      clientMessageId: "native-file-1",
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      mrkdwnText: "",
      attachments: [
        {
          url: `${providerOrigin}/source.pdf`,
          filename: "policy.pdf",
          contentType: "application/pdf",
        },
      ],
    });
    assert.deepEqual(await send.json(), {
      messageId: "1800000000.200",
      attachmentFailures: [],
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/files.info")?.body,
      { file: "F-POLICY" },
    );
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/files.getUploadURLExternal")
        ?.body,
      { filename: "policy.pdf", length: "6" },
    );
  });

  test("does not retry a completed file share while its timestamp propagates", async () => {
    const completeCallsBefore = apiCalls.filter(
      (call) => call.path === "/api/files.completeUploadExternal",
    ).length;
    const request = {
      clientMessageId: "native-delayed-file-1",
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
      mrkdwnText: "",
      attachments: [
        {
          url: `${providerOrigin}/source.pdf`,
          filename: "delayed-share.pdf",
          contentType: "application/pdf",
        },
      ],
    };

    assert.deepEqual(await (await workerRequest("/send", request)).json(), {
      attachmentFailures: [],
    });
    assert.deepEqual(await (await workerRequest("/send", request)).json(), {
      attachmentFailures: [],
    });
    assert.equal(
      apiCalls.filter(
        (call) => call.path === "/api/files.completeUploadExternal",
      ).length,
      completeCallsBefore + 1,
    );
  });

  test("uses the separate Clarity installation for Connect provisioning", async () => {
    const response = await workerRequest("/connect-channel", {
      clientSlug: "client",
      inviteEmail: "admin@client.test",
      operatorUserIds: ["U-ALREADY", "U-NEW", "U-NEW"],
    });
    assert.deepEqual(await response.json(), {
      channelId: "C-HOST",
      channelName: "spot-client",
      inviteId: "I-1",
      reusedChannel: false,
      operatorInvites: { requested: 2, succeeded: true },
      supportInvite: { succeeded: true, pending: true },
    });
    const calls = apiCalls.filter(
      (call) =>
        call.path.startsWith("/api/conversations.") &&
        call.authorization === "Bearer xoxb-clarity",
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
      existingChannelName: "spot-client",
    });
    assert.deepEqual(await retry.json(), {
      channelId: "C-HOST",
      channelName: "spot-client",
      inviteId: "I-1",
      reusedChannel: true,
      operatorInvites: { requested: 1, succeeded: true },
      supportInvite: { succeeded: true, pending: true },
    });
    assert.equal(
      apiCalls.filter((call) => call.path === "/api/conversations.create")
        .length,
      1,
    );
    assert.equal(
      apiCalls.filter((call) => call.path === "/api/conversations.invite")
        .length,
      1,
    );
  });

  test("changes membership only for public customer channels", async () => {
    const joined = await workerRequest("/channels/join", {
      teamId: "T-CUSTOMER",
      channelId: "C-NOT-JOINED",
    });
    assert.equal((await joined.json()).channel.isMember, true);
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/conversations.join"),
      {
        path: "/api/conversations.join",
        authorization: "Bearer xoxb-customer",
        body: { channel: "C-NOT-JOINED" },
      },
    );
    const joinCallsBefore = apiCalls.filter(
      (call) => call.path === "/api/conversations.join",
    ).length;
    for (const channelId of ["G-PRIVATE", "C-SHARED"]) {
      const response = await workerRequest("/channels/join", {
        teamId: "T-CUSTOMER",
        channelId,
      });
      assert.equal(response.status, 500);
    }
    assert.equal(
      apiCalls.filter((call) => call.path === "/api/conversations.join").length,
      joinCallsBefore,
    );
    const left = await workerRequest("/channels/leave", {
      teamId: "T-CUSTOMER",
      channelId: "C-CUSTOMER",
    });
    assert.equal((await left.json()).channel.isMember, false);
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/conversations.leave"),
      {
        path: "/api/conversations.leave",
        authorization: "Bearer xoxb-customer",
        body: { channel: "C-CUSTOMER" },
      },
    );
    const leaveCallsBefore = apiCalls.filter(
      (call) => call.path === "/api/conversations.leave",
    ).length;
    for (const channelId of ["G-PRIVATE", "C-SHARED"]) {
      const response = await workerRequest("/channels/leave", {
        teamId: "T-CUSTOMER",
        channelId,
      });
      assert.equal(response.status, 500);
    }
    assert.equal(
      apiCalls.filter((call) => call.path === "/api/conversations.leave")
        .length,
      leaveCallsBefore,
    );
  });
});
