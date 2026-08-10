const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return defaultValue;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const repository = requireEnv("GITHUB_REPOSITORY");
const sha = requireEnv("GITHUB_SHA");
const token = requireEnv("GITHUB_TOKEN");
const apiUrl = (process.env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(
  /\/$/,
  "",
);
const requiredContexts = requireEnv("RAILWAY_STATUS_CONTEXTS")
  .split("\n")
  .map((context) => context.trim())
  .filter(Boolean);
const timeoutMs = positiveIntegerEnv("RAILWAY_STATUS_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
const pollIntervalMs = positiveIntegerEnv(
  "RAILWAY_STATUS_POLL_INTERVAL_MS",
  DEFAULT_POLL_INTERVAL_MS,
);

if (new Set(requiredContexts).size !== requiredContexts.length) {
  throw new Error("RAILWAY_STATUS_CONTEXTS contains duplicates");
}

const terminalFailureStates = new Set(["error", "failure"]);
const startedAt = performance.now();
let lastSummary = "";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStatuses() {
  const url = new URL(`${apiUrl}/repos/${repository}/commits/${sha}/status`);
  url.searchParams.set("per_page", "100");
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub status API returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const payload = JSON.parse(text);
  if (!Array.isArray(payload.statuses)) {
    throw new Error("GitHub status API response did not include statuses");
  }
  return payload.statuses;
}

while (performance.now() - startedAt < timeoutMs) {
  const statuses = await readStatuses();
  const latestByContext = new Map();
  for (const status of statuses) {
    if (!latestByContext.has(status.context)) latestByContext.set(status.context, status);
  }

  const pending = [];
  for (const context of requiredContexts) {
    const status = latestByContext.get(context);
    if (!status) {
      pending.push(`${context}: missing`);
      continue;
    }
    if (terminalFailureStates.has(status.state)) {
      throw new Error(
        `${context} reported ${status.state}: ${status.description || "no description"}`,
      );
    }
    if (status.state !== "success") {
      pending.push(`${context}: ${status.state}`);
    }
  }

  if (pending.length === 0) {
    for (const context of requiredContexts) {
      const status = latestByContext.get(context);
      console.log(
        `[railway-release] OK ${context}: ${status.description || status.state}`,
      );
    }
    console.log(`[railway-release] all Railway statuses passed for ${sha}`);
    process.exit(0);
  }

  const summary = pending.join("; ");
  if (summary !== lastSummary) {
    console.log(`[railway-release] waiting for ${sha}: ${summary}`);
    lastSummary = summary;
  }
  await wait(pollIntervalMs);
}

throw new Error(
  `Timed out after ${timeoutMs}ms waiting for Railway statuses for ${sha}: ${lastSummary}`,
);
