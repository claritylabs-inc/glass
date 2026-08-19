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
        botUserId: "U-GLASS",
      });
    }
    if (request.url === "/api/chat.postMessage") {
      return respond(response, { ok: true, ts: "1800000000.100" });
    }
    if (request.url === "/api/chat.update") {
      return respond(response, { ok: true, ts: "1800000000.100" });
    }
    if (request.url === "/api/assistant.threads.setStatus") {
      return respond(response, { ok: true });
    }
    if (
      request.url === "/api/reactions.add" ||
      request.url === "/api/reactions.remove"
    ) {
      return respond(response, { ok: true });
    }
    if (request.url === "/api/chat.startStream") {
      return respond(response, { ok: true, ts: "1800000000.300" });
    }
    if (request.url === "/api/chat.appendStream") {
      return respond(response, { ok: true });
    }
    if (request.url === "/api/chat.stopStream") {
      return respond(response, { ok: true, ts: "1800000000.300" });
    }
    if (request.url === "/api/chat.postEphemeral") {
      return respond(response, { ok: true, message_ts: "1800000000.400" });
    }
    if (request.url === "/api/views.open") {
      return respond(response, { ok: true, view: { id: "V-FEEDBACK" } });
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
        file_id: "F-POLICY",
      });
    }
    if (request.url === "/api/files.completeUploadExternal") {
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
    if (request.url === "/api/auth.test") {
      if (
        !request.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        return respond(response, { ok: false, error: "invalid_arguments" });
      }
      return respond(response, {
        ok: true,
        team_id: String(body.team_id ?? "T-CUSTOMER"),
        user_id: "U-GLASS",
      });
    }
    if (request.url === "/api/conversations.info") {
      if (
        !request.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        return respond(response, { ok: false, error: "invalid_arguments" });
      }
      return respond(response, {
        ok: true,
        channel: {
          id: String(body.channel),
          name: "client-service",
          is_member: true,
          is_archived: false,
          is_private: true,
          is_shared: true,
          is_ext_shared: true,
          is_org_shared: false,
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
      GLASS_ENV: "production",
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
      text: "**Policy:** [Open](https://example.test/policy)",
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
      text: "*Policy:* <https://example.test/policy|Open>",
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
      botUserId: "U-GLASS",
    });
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/users.info"),
      {
        path: "/api/users.info",
        authorization: "Bearer xoxb-customer",
        body: { user: "U-CUSTOMER" },
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
      text: "",
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

  test("uses form encoding for Slack reconciliation reads", async () => {
    const response = await workerRequest("/reconcile", {
      teamId: "T-CUSTOMER",
      channelIds: ["C-CUSTOMER"],
    });
    assert.deepEqual(await response.json(), {
      teamId: "T-CUSTOMER",
      botUserId: "U-GLASS",
      channels: [
        {
          id: "C-CUSTOMER",
          ok: true,
          name: "client-service",
          isArchived: false,
          isMember: true,
          isPrivate: true,
          isShared: true,
          isExtShared: true,
          isOrgShared: false,
        },
      ],
    });
    assert.deepEqual(
      apiCalls.filter((call) => call.path === "/api/auth.test").at(-1),
      {
        path: "/api/auth.test",
        authorization: "Bearer xoxb-customer",
        body: {},
      },
    );
    assert.deepEqual(
      apiCalls
        .filter((call) => call.path === "/api/conversations.info")
        .at(-1),
      {
        path: "/api/conversations.info",
        authorization: "Bearer xoxb-customer",
        body: { channel: "C-CUSTOMER", include_num_members: "false" },
      },
    );
  });

  test("reacts, updates, streams, reports status, and opens feedback through native APIs", async () => {
    const teamId = "T-CUSTOMER";
    const channelId = "C-CUSTOMER";
    const threadTs = "1800000000.050";
    const stream = await workerRequest("/stream/start", {
      teamId,
      channelId,
      threadTs,
      recipientUserId: "U-CUSTOMER",
      recipientTeamId: teamId,
      status: "Reviewing your request",
    });
    assert.deepEqual(await stream.json(), { messageId: "1800000000.300" });
    await workerRequest("/stream/append", {
      teamId,
      channelId,
      messageTs: "1800000000.300",
      markdownText: "[[g:**Policy found**]]",
      tasks: [{ id: "lookup", title: "Found the policy", status: "complete" }],
    });
    await workerRequest("/stream/stop", {
      teamId,
      channelId,
      messageTs: "1800000000.300",
      text: "[[g:**Policy found**]]",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Policy" } }],
    });
    await workerRequest("/message/update", {
      teamId,
      channelId,
      messageTs: "1800000000.100",
      text: "Updated",
      blocks: [],
    });
    await workerRequest("/thread/status", {
      teamId,
      channelId,
      threadTs,
      status: "is checking coverages…",
    });
    await workerRequest("/reaction/add", {
      teamId,
      channelId,
      messageTs: threadTs,
      name: "eyes",
    });
    await workerRequest("/reaction/remove", {
      teamId,
      channelId,
      messageTs: threadTs,
      name: "eyes",
    });
    await workerRequest("/ephemeral", {
      teamId,
      channelId,
      userId: "U-CUSTOMER",
      threadTs,
      text: "Thanks",
    });
    const view = await workerRequest("/view/open", {
      teamId,
      triggerId: "trigger-1",
      privateMetadata: "interaction-1",
    });
    assert.deepEqual(await view.json(), { viewId: "V-FEEDBACK" });

    const paths = [
      "/api/chat.startStream",
      "/api/chat.appendStream",
      "/api/chat.stopStream",
      "/api/chat.update",
      "/api/assistant.threads.setStatus",
      "/api/reactions.add",
      "/api/reactions.remove",
      "/api/chat.postEphemeral",
      "/api/views.open",
    ];
    assert(paths.every((path) => apiCalls.some((call) => call.path === path)));
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/chat.appendStream")?.body,
      {
        channel: channelId,
        ts: "1800000000.300",
        markdown_text: "**Policy found**",
        chunks: [
          {
            type: "task_update",
            id: "lookup",
            title: "Found the policy",
            status: "complete",
          },
        ],
      },
    );
    assert.equal(
      apiCalls.find((call) => call.path === "/api/chat.stopStream")?.body
        .markdown_text,
      "**Policy found**",
    );
    assert.deepEqual(
      apiCalls.find((call) => call.path === "/api/reactions.add")?.body,
      { channel: channelId, timestamp: threadTs, name: "eyes" },
    );
    assert.equal(
      apiCalls.find((call) => call.path === "/api/views.open")?.body.trigger_id,
      "trigger-1",
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
      channelName: "glass-client",
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
          exclude_archived: "true",
          limit: "200",
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
      apiCalls.filter((call) => call.path === "/api/conversations.join").length,
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
