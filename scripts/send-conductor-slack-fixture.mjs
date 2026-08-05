import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import dayjs from "dayjs";
import {
  conductorPorts,
  parseEnvFile,
  repoRoot,
} from "./lib/conductor-workspace.mjs";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const workerEnv = parseEnvFile(
  path.join(repoRoot, ".context", "slack-worker.env"),
);
const signingSecret = workerEnv.get("PHOTON_WEBHOOK_SIGNING_SECRET")?.trim();
if (!signingSecret) {
  throw new Error(
    "PHOTON_WEBHOOK_SIGNING_SECRET is missing. Run npm run conductor:setup first.",
  );
}

const now = dayjs();
const messageTs = `${now.unix()}.${String(now.millisecond()).padStart(3, "0")}`;
const threadTs = option("thread", messageTs);
const text = option("text", "<@U-GLASS> summarize my current policy");
const payload = {
  event: "messages",
  message: {
    id: `fixture-${randomUUID()}`,
    ts: messageTs,
    threadTs,
    timestamp: now.toISOString(),
    platform: "slack",
    sender: {
      id: option("user", "U-COVE-ADMIN"),
      teamId: option("team", "T-COVE-FIXTURE"),
      displayName: option("name", "Cove Admin"),
    },
    content: { type: "text", text },
  },
  space: {
    id: option("channel", "C-COVE-FIXTURE"),
    teamId: option("team", "T-COVE-FIXTURE"),
    type: "channel",
  },
};
const rawBody = JSON.stringify(payload);
const timestamp = String(now.unix());
const signature = `v0=${createHmac("sha256", signingSecret)
  .update(`v0:${timestamp}:${rawBody}`)
  .digest("hex")}`;
const { convexSite } = conductorPorts();
const response = await fetch(
  `http://127.0.0.1:${convexSite}/spectrum-slack-inbound`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Spectrum-Timestamp": timestamp,
      "X-Spectrum-Signature": signature,
      "X-Spectrum-Webhook-Id": `fixture-${randomUUID()}`,
    },
    body: rawBody,
  },
);
const body = await response.text();
if (!response.ok) {
  throw new Error(`Slack fixture failed (${response.status}): ${body}`);
}
console.log(body);
