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

async function send(body: Record<string, unknown>, secret = "test-secret") {
  return await fetch(`${origin}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["dist/src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GLASS_ENV: "local",
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
    assert.deepEqual(health, {
      ok: true,
      service: "glass-slack-worker",
      glassEnv: "local",
      mode: "mock",
      workerSecretConfigured: true,
      tokenBrokerConfigured: true,
      clarityTeamConfigured: true,
      outboundEnabled: true,
      attachmentRetrievalEnabled: false,
      actorResolutionEnabled: true,
      connectProvisioningEnabled: true,
    });
    assert.equal((await send({}, "wrong-secret")).status, 401);

    const actor = await fetch(`${origin}/actor`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ teamId: "T-CUSTOMER", userId: "U-CUSTOMER" }),
    }).then((response) => response.json());
    assert.deepEqual(actor, {
      teamId: "T-CUSTOMER",
      userId: "U-CUSTOMER",
      displayName: "U-CUSTOMER",
      isBot: false,
      botUserId: "U-GLASS",
    });
  });

  test("deduplicates successful file sends and releases failed file claims", async () => {
    const base = {
      teamId: "T-CUSTOMER",
      channelId: "C-PRIMARY",
      threadTs: "1800000000.000",
      text: "",
      attachments: [
        {
          url: "https://files.example.test/policy.pdf",
          filename: "policy.pdf",
          contentType: "application/pdf",
        },
      ],
    };
    const first = await send({ ...base, clientMessageId: "file-success" }).then(
      (response) => response.json(),
    );
    const duplicate = await send({
      ...base,
      clientMessageId: "file-success",
    }).then((response) => response.json());
    assert.deepEqual(duplicate, first);

    const failing = {
      ...base,
      clientMessageId: "file-retry",
      attachments: [
        {
          ...base.attachments[0],
          url: "https://files.example.test/fail-once",
        },
      ],
    };
    const failed = (await send(failing).then((response) =>
      response.json(),
    )) as {
      attachmentFailures: unknown[];
    };
    assert.equal(failed.attachmentFailures.length, 1);
    const retried = (await send(failing).then((response) =>
      response.json(),
    )) as {
      messageId?: string;
      attachmentFailures: unknown[];
    };
    assert.equal(retried.messageId, "mock-file-retry");
    assert.equal(retried.attachmentFailures.length, 0);
  });

  test("lists deterministic local channels without Slack", async () => {
    const result = await fetch(`${origin}/channels`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        teamId: "T-LOCAL",
        currentChannelId: "C-LOCAL",
        currentChannelName: "glass-local",
      }),
    }).then((response) => response.json());
    assert.deepEqual(result, {
      channels: [
        { id: "C-LOCAL", name: "glass-local" },
        { id: "mock-T-LOCAL-general", name: "general" },
        { id: "mock-T-LOCAL-policies", name: "policy-updates" },
      ],
    });
  });
});
