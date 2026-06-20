const DEFAULT_TIMEOUT_MS = 10_000;
const CHECK_ATTEMPTS = Number(process.env.AGENT_HEALTH_ATTEMPTS ?? "3");
const RETRY_DELAY_MS = Number(process.env.AGENT_HEALTH_RETRY_DELAY_MS ?? "10_000");

const checks = [
  {
    name: "Convex agent configuration",
    url:
      process.env.GLASS_CONVEX_AGENT_HEALTH_URL ??
      "https://merry-platypus-82.convex.site/agent-health",
    validate(payload) {
      if (payload.ok !== true) {
        throw new Error(`reported ok=${String(payload.ok)}`);
      }
      const missing = Object.entries(payload.checks ?? {})
        .filter(([, value]) => value !== true)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(`missing checks: ${missing.join(", ")}`);
      }
    },
  },
  {
    name: "iMessage worker",
    url:
      process.env.GLASS_IMESSAGE_WORKER_HEALTH_URL ??
      "https://glass-production-4618.up.railway.app/health",
    validate(payload) {
      const expected = {
        ok: true,
        service: "glass-imessage-worker",
        transport: "imessage",
        imessageEnabled: true,
        convexSiteConfigured: true,
        workerSecretConfigured: true,
        photonConfigured: true,
      };
      const failures = Object.entries(expected)
        .filter(([key, value]) => payload[key] !== value)
        .map(([key, value]) => `${key} expected ${String(value)} got ${String(payload[key])}`);
      if (failures.length > 0) {
        throw new Error(failures.join("; "));
      }
      if (!Array.isArray(payload.httpPorts) || !payload.httpPorts.includes(3001)) {
        throw new Error("worker is not listening on Railway public target port 3001");
      }
    },
  },
  {
    name: "Extraction worker",
    url:
      process.env.GLASS_EXTRACTION_WORKER_HEALTH_URL ??
      "https://glass-extraction-worker-production.up.railway.app/health",
    validate(payload) {
      if (payload.ok !== true) {
        throw new Error(`reported ok=${String(payload.ok)}`);
      }
      if (payload.workerProtocolVersion !== "source-tree-v1") {
        throw new Error(
          `unexpected protocol ${String(payload.workerProtocolVersion)}`,
        );
      }
    },
  },
];

async function fetchJson(check) {
  const response = await fetch(check.url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCheck(check) {
  let lastError;
  const attempts = Number.isInteger(CHECK_ATTEMPTS) && CHECK_ATTEMPTS > 0
    ? CHECK_ATTEMPTS
    : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const payload = await fetchJson(check);
      check.validate(payload);
      const suffix = attempts > 1 ? ` attempt ${attempt}/${attempts}` : "";
      console.log(`[agent-health] OK ${check.name}: ${check.url}${suffix}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

const failures = [];

for (const check of checks) {
  try {
    await runCheck(check);
  } catch (error) {
    failures.push(
      `[agent-health] FAIL ${check.name}: ${check.url}\n  ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
