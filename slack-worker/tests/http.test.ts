import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

let child: ChildProcess;
let origin: string;

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

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Slack worker did not become healthy");
}

async function workerRequest(
  path: string,
  body: Record<string, unknown>,
  secret = "test-secret",
) {
  return await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const send = (body: Record<string, unknown>, secret?: string) =>
  workerRequest("/send", body, secret);

before(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["dist/src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SPOT_ENV: "local",
      SLACK_WORKER_MODE: "mock",
      SLACK_WORKER_SECRET: "test-secret",
      PORT: String(port),
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
});

describe("Slack worker HTTP adapter", () => {
  test("reports mock health and rejects unauthenticated sends", async () => {
    const health = await fetch(`${origin}/health`).then((response) =>
      response.json(),
    );
    assert.deepEqual({
      ok: health.ok,
      service: health.service,
      mode: health.mode,
      outboundEnabled: health.outboundEnabled,
      actorResolutionEnabled: health.actorResolutionEnabled,
      channelInventoryEnabled: health.channelInventoryEnabled,
    }, {
      ok: true,
      service: "spot-slack-worker",
      mode: "mock",
      outboundEnabled: true,
      actorResolutionEnabled: true,
      channelInventoryEnabled: true,
    });
    assert.equal((await send({}, "wrong-secret")).status, 401);
    assert.deepEqual(
      await send({
        clientMessageId: "mock-send",
        teamId: "T-CUSTOMER",
        channelId: "C-PRIMARY",
        mrkdwnText: "Policy details",
      }).then((response) => response.json()),
      { messageId: "mock-mock-send", attachmentFailures: [] },
    );
    const actor = await workerRequest("/actor", {
      teamId: "T-CUSTOMER",
      userId: "U-CUSTOMER",
    }).then((response) => response.json());
    assert.deepEqual(actor, {
      teamId: "T-CUSTOMER",
      userId: "U-CUSTOMER",
      displayName: "U-CUSTOMER",
      isBot: false,
      botUserId: "U-SPOT",
    });
  });

  test("reconciles authorization and channel identity without exposing credentials", async () => {
    const response = await workerRequest("/reconcile", {
      teamId: "T-CUSTOMER",
      channelIds: ["C-PRIMARY", "C-PRIMARY"],
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, {
      teamId: "T-CUSTOMER",
      botUserId: "U-SPOT",
      channels: [
        {
          id: "C-PRIMARY",
          ok: true,
          name: "c-primary",
          isArchived: false,
          isMember: true,
          isPrivate: true,
          isShared: true,
          isExtShared: true,
          isOrgShared: false,
        },
      ],
    });
    assert.equal("botToken" in payload, false);
  });

  test("keeps deterministic local channel membership state", async () => {
    const list = (body: Record<string, unknown>) =>
      workerRequest("/channels", body).then((response) => response.json());
    const initial = await list({
      teamId: "T-LOCAL",
      currentChannelId: "C-LOCAL",
      currentChannelName: "spot-local",
    });
    assert.deepEqual(
      initial.channels.map((channel: { id: string }) => channel.id),
      ["C-LOCAL", "mock-T-LOCAL-general", "mock-T-LOCAL-policies"],
    );

    const general = "mock-T-LOCAL-general";
    const joined = await workerRequest("/channels/join", {
      teamId: "T-LOCAL",
      channelId: general,
    }).then((response) => response.json());
    assert.equal(joined.channel.isMember, true);

    const left = await workerRequest("/channels/leave", {
      teamId: "T-LOCAL",
      channelId: general,
    }).then((response) => response.json());
    assert.equal(left.channel.isMember, false);
  });
});
