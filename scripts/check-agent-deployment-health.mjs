import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 10_000;
const CHECK_ATTEMPTS = Number(process.env.AGENT_HEALTH_ATTEMPTS ?? "3");
const RETRY_DELAY_MS = Number(process.env.AGENT_HEALTH_RETRY_DELAY_MS ?? "10000");
const DEPLOYMENTS = JSON.parse(readFileSync(new URL("../config/deployments.json", import.meta.url), "utf8"));
const EXTRACTION_WORKER_PACKAGE = JSON.parse(
  readFileSync(new URL("../extraction-worker/package.json", import.meta.url), "utf8"),
);
const EXPECTED_CL_SDK_VERSION = EXTRACTION_WORKER_PACKAGE.dependencies?.["@claritylabs/cl-sdk"];

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

const DEPLOYMENT_ENV =
  argValue("env") ??
  argValue("environment") ??
  process.env.GLASS_DEPLOYMENT_ENV ??
  process.env.GLASS_ENV ??
  "production";

const deployment = DEPLOYMENTS[DEPLOYMENT_ENV];
if (!deployment) {
  console.error(
    `[agent-health] Unknown deployment environment "${DEPLOYMENT_ENV}". Expected one of: ${Object.keys(DEPLOYMENTS).join(", ")}`,
  );
  process.exit(1);
}

function envOrDefault(envName, defaultValue, label) {
  const rawValue = envName ? process.env[envName] : undefined;
  const value = typeof rawValue === "string" && rawValue.trim() !== ""
    ? rawValue.trim()
    : undefined;
  const resolved = value ?? defaultValue;
  if (!resolved) {
    throw new Error(
      `${label} is not configured for ${DEPLOYMENT_ENV}; set ${envName ?? "the corresponding deployment URL"}`,
    );
  }
  return resolved;
}

const urls = {
  convexAgentHealth:
    process.env.GLASS_CONVEX_AGENT_HEALTH_URL ??
    envOrDefault(
      deployment.convexAgentHealthUrlEnv,
      deployment.convexAgentHealthUrl,
      "Convex agent health URL",
    ),
  imessageWorkerHealth:
    process.env.GLASS_IMESSAGE_WORKER_HEALTH_URL ??
    envOrDefault(
      deployment.imessageWorkerHealthUrlEnv,
      deployment.imessageWorkerHealthUrl,
      "iMessage worker health URL",
    ),
  extractionWorkerHealth:
    process.env.GLASS_EXTRACTION_WORKER_HEALTH_URL ??
    envOrDefault(
      deployment.extractionWorkerHealthUrlEnv,
      deployment.extractionWorkerHealthUrl,
      "extraction worker health URL",
    ),
};

function validateGlassEnv(payload) {
  if (!payload.glassEnv) return;
  if (payload.glassEnv !== deployment.glassEnv) {
    throw new Error(
      `glassEnv expected ${deployment.glassEnv} got ${String(payload.glassEnv)}`,
    );
  }
}

function normalizeVersionSpec(value) {
  return typeof value === "string" ? value.trim().replace(/^[~^=v]+/, "") : undefined;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is missing`);
  }
  return value.trim();
}

function assertSameVersion(label, actual, expected) {
  const normalizedActual = normalizeVersionSpec(actual);
  const normalizedExpected = normalizeVersionSpec(expected);
  if (!normalizedActual || !normalizedExpected || normalizedActual !== normalizedExpected) {
    throw new Error(`${label} expected ${String(expected)} got ${String(actual)}`);
  }
}

let convexAgentPayload;

const checks = [
  {
    name: "Convex agent configuration",
    url: urls.convexAgentHealth,
    validate(payload) {
      if (payload.ok !== true) {
        throw new Error(`reported ok=${String(payload.ok)}`);
      }
      validateGlassEnv(payload);
      const missing = Object.entries(payload.checks ?? {})
        .filter(([, value]) => value !== true)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(`missing checks: ${missing.join(", ")}`);
      }
      if (
        payload.emailDeliveryMode &&
        deployment.email?.deliveryMode &&
        payload.emailDeliveryMode !== deployment.email.deliveryMode
      ) {
        throw new Error(
          `emailDeliveryMode expected ${deployment.email.deliveryMode} got ${String(payload.emailDeliveryMode)}`,
        );
      }
      const extractionWorker = payload.extractionWorker;
      if (!extractionWorker || typeof extractionWorker !== "object") {
        throw new Error("extractionWorker compatibility config missing from Convex health");
      }
      if (deployment.workers?.extractionProtocol) {
        if (extractionWorker.expectedProtocolVersion !== deployment.workers.extractionProtocol) {
          throw new Error(
            `extractionWorker.expectedProtocolVersion expected ${deployment.workers.extractionProtocol} got ${String(extractionWorker.expectedProtocolVersion)}`,
          );
        }
      }
      if (EXPECTED_CL_SDK_VERSION) {
        assertSameVersion(
          "extractionWorker.expectedClSdkVersion",
          extractionWorker.expectedClSdkVersion,
          EXPECTED_CL_SDK_VERSION,
        );
      }
      convexAgentPayload = payload;
    },
  },
  {
    name: "iMessage worker",
    url: urls.imessageWorkerHealth,
    validate(payload) {
      const expected = {
        ok: true,
        service: "glass-imessage-worker",
        transport: deployment.imessage.transport,
        imessageEnabled: deployment.imessage.imessageEnabled,
        convexSiteConfigured: true,
        workerSecretConfigured: true,
        photonConfigured: deployment.imessage.photonConfigured,
      };
      const failures = Object.entries(expected)
        .filter(([key, value]) => payload[key] !== value)
        .map(([key, value]) => `${key} expected ${String(value)} got ${String(payload[key])}`);
      if (failures.length > 0) {
        throw new Error(failures.join("; "));
      }
      validateGlassEnv(payload);
      for (const port of deployment.imessage.requiredHttpPorts ?? []) {
        if (!Array.isArray(payload.httpPorts) || !payload.httpPorts.includes(port)) {
          throw new Error(`worker is not listening on required port ${port}`);
        }
      }
    },
  },
  {
    name: "Extraction worker",
    url: urls.extractionWorkerHealth,
    validate(payload) {
      if (payload.ok !== true) {
        throw new Error(`reported ok=${String(payload.ok)}`);
      }
      validateGlassEnv(payload);
      const expectedProtocol = deployment.workers?.extractionProtocol;
      if (expectedProtocol && payload.workerProtocolVersion !== expectedProtocol) {
        throw new Error(
          `unexpected protocol ${String(payload.workerProtocolVersion)}; expected ${expectedProtocol}`,
        );
      }
      const convexExtractionWorker = convexAgentPayload?.extractionWorker;
      if (!convexExtractionWorker || typeof convexExtractionWorker !== "object") {
        throw new Error("Convex extraction worker compatibility config unavailable");
      }
      const convexExpectedProtocol = requireString(
        convexExtractionWorker.expectedProtocolVersion,
        "Convex extractionWorker.expectedProtocolVersion",
      );
      if (payload.workerProtocolVersion !== convexExpectedProtocol) {
        throw new Error(
          `workerProtocolVersion expected ${convexExpectedProtocol} got ${String(payload.workerProtocolVersion)}`,
        );
      }
      const convexExpectedClSdkVersion = requireString(
        convexExtractionWorker.expectedClSdkVersion,
        "Convex extractionWorker.expectedClSdkVersion",
      );
      assertSameVersion(
        "worker cl-sdk version",
        payload.clSdkVersion,
        convexExpectedClSdkVersion,
      );
      if (EXPECTED_CL_SDK_VERSION) {
        assertSameVersion(
          "worker cl-sdk package spec",
          payload.clSdkVersion,
          EXPECTED_CL_SDK_VERSION,
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

console.log(`[agent-health] ${DEPLOYMENT_ENV} deployment health passed`);
