import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  conductorImageTag,
  conductorPorts,
  ensureNode22,
  localConvexUrls,
  parseEnvFile,
  repoRoot,
  workspaceSlug,
} from "./lib/conductor-workspace.mjs";

ensureNode22();
process.chdir(repoRoot);

const contextDirectory = path.join(repoRoot, ".context");
const rootEnvPath = path.join(repoRoot, ".env.local");
const imessageEnvPath = path.join(repoRoot, "imessage-worker", ".env.local");
const localConfigPath = path.join(
  repoRoot,
  ".convex",
  "local",
  "default",
  "config.json",
);
const convexSelectionKeys = new Set([
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SITE_URL",
  "CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "NEXT_PUBLIC_CONVEX_URL",
]);

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
  return result.status ?? 1;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.allowFailure) return undefined;
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function requiredValue(values, key, source) {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`${key} is missing from ${source}`);
  return value;
}

function writePrivateFile(filePath, contents) {
  writeFileSync(filePath, contents, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function writeRuntimeEnv(fileName, entries) {
  const filePath = path.join(contextDirectory, fileName);
  const contents = Object.entries(entries)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => {
      if (/\r|\n/.test(value))
        throw new Error(`${key} cannot contain a newline`);
      return `${key}=${value}`;
    })
    .join("\n");
  writePrivateFile(filePath, `${contents}\n`);
  console.log(`Prepared ${path.relative(repoRoot, filePath)}`);
}

function stripCloudConvexSelection() {
  const lines = readFileSync(rootEnvPath, "utf8").split(/\r?\n/);
  const filtered = lines.filter((rawLine) => {
    const line = rawLine.trim().replace(/^export\s+/, "");
    const separator = line.indexOf("=");
    if (separator < 1) return true;
    return !convexSelectionKeys.has(line.slice(0, separator).trim());
  });
  writeFileSync(rootEnvPath, `${filtered.join("\n").replace(/\n+$/, "")}\n`);
}

function deploymentNameFromSelector(selector) {
  const separator = selector.indexOf(":");
  return separator >= 0 ? selector.slice(separator + 1) : selector;
}

function setConvexEnvFromFile(convex, filePath) {
  run(convex, ["env", "set", "--from-file", filePath, "--force"]);
}

function optionalConvexEnv(convex, name) {
  return capture(convex, ["env", "get", name], { allowFailure: true });
}

function ensureContainerService() {
  if (
    run("node", ["scripts/check-container-cli.mjs"], { allowFailure: true }) ===
    0
  ) {
    return;
  }
  run("/bin/zsh", ["-c", "yes | container system start"]);
  run("node", ["scripts/check-container-cli.mjs"]);
}

function buildWorkerImages() {
  const workers = [
    ["extraction-worker", "extraction-worker"],
    ["imessage-worker", "imessage-worker"],
    ["mailbox-scan-worker", "mailbox-scan-worker"],
  ];
  for (const [imageName, directory] of workers) {
    run("container", [
      "build",
      "--platform",
      "linux/amd64",
      "--tag",
      conductorImageTag(imageName),
      "--file",
      `${directory}/Dockerfile`,
      directory,
    ]);
  }
}

if (!existsSync(rootEnvPath)) {
  throw new Error(
    ".env.local is missing. Add it to the repository root so Conductor Files to copy can seed new workspaces.",
  );
}
if (!existsSync(imessageEnvPath)) {
  throw new Error(
    "imessage-worker/.env.local is missing. Copy imessage-worker/.env.template and set IMESSAGE_TERMINAL_FROM_PHONE.",
  );
}

const initialRootEnv = parseEnvFile(rootEnvPath);
const imessageEnv = parseEnvFile(imessageEnvPath);
const terminalPhone = requiredValue(
  imessageEnv,
  "IMESSAGE_TERMINAL_FROM_PHONE",
  "imessage-worker/.env.local",
);
if (!/^\+[1-9]\d{7,14}$/.test(terminalPhone)) {
  throw new Error("IMESSAGE_TERMINAL_FROM_PHONE must be an E.164 phone number");
}
const configuredTerminalClientPhone = imessageEnv
  .get("IMESSAGE_TERMINAL_CLIENT_PHONE")
  ?.trim();
const terminalClientPhone =
  !configuredTerminalClientPhone || configuredTerminalClientPhone === "+15555550102"
    ? "+12025550102"
    : configuredTerminalClientPhone;
const configuredTerminalPublicPhone = imessageEnv
  .get("IMESSAGE_TERMINAL_PUBLIC_PHONE")
  ?.trim();
const terminalPublicPhone =
  !configuredTerminalPublicPhone || configuredTerminalPublicPhone === "+15555550999"
    ? "+12025550199"
    : configuredTerminalPublicPhone;
for (const [name, value] of [
  ["IMESSAGE_TERMINAL_CLIENT_PHONE", terminalClientPhone],
  ["IMESSAGE_TERMINAL_PUBLIC_PHONE", terminalPublicPhone],
]) {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new Error(`${name} must be an E.164 phone number`);
  }
}
if (new Set([terminalPhone, terminalClientPhone, terminalPublicPhone]).size !== 3) {
  throw new Error("Spectrum terminal test phone numbers must be unique");
}

run("npm", ["ci"]);
run("npm", ["--prefix", "extraction-worker", "ci"]);
run("npm", ["--prefix", "imessage-worker", "ci"]);

mkdirSync(contextDirectory, { recursive: true });
const convex = path.join(repoRoot, "node_modules", ".bin", "convex");
const createdLocalDeployment = !existsSync(localConfigPath);
let cloudEnvironment;

if (createdLocalDeployment) {
  const sourceSelector =
    process.env.CONDUCTOR_CONVEX_SOURCE_DEPLOYMENT?.trim() ||
    initialRootEnv.get("CONVEX_DEPLOYMENT")?.trim();
  if (!sourceSelector || /^(anonymous|local):/.test(sourceSelector)) {
    throw new Error(
      "A fresh worktree needs a cloud dev CONVEX_DEPLOYMENT in the copied .env.local (or CONDUCTOR_CONVEX_SOURCE_DEPLOYMENT) so setup can clone its environment variables.",
    );
  }
  const sourceDeployment = deploymentNameFromSelector(sourceSelector);
  console.log(
    `Cloning Convex environment variables from ${sourceDeployment}...`,
  );
  cloudEnvironment = capture(convex, [
    "env",
    "list",
    "--deployment",
    sourceDeployment,
  ]);
  stripCloudConvexSelection();
}

const { web, extraction, imessage, convexCloud, convexSite } = conductorPorts();
run(
  convex,
  [
    "dev",
    "--once",
    "--local-cloud-port",
    String(convexCloud),
    "--local-site-port",
    String(convexSite),
  ],
  {
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  },
);

const localUrls = localConvexUrls();
if (cloudEnvironment) {
  const importPath = path.join(contextDirectory, "convex-cloud-import.env");
  try {
    writePrivateFile(importPath, `${cloudEnvironment}\n`);
    setConvexEnvFromFile(convex, importPath);
  } finally {
    rmSync(importPath, { force: true });
  }
}

const extractionPackage = JSON.parse(
  readFileSync(
    path.join(repoRoot, "extraction-worker", "package.json"),
    "utf8",
  ),
);
const expectedSdkVersion =
  extractionPackage.dependencies["@claritylabs/cl-sdk"];
const extractionSecret = createdLocalDeployment
  ? randomBytes(32).toString("hex")
  : optionalConvexEnv(convex, "EXTRACTION_WORKER_SECRET") ||
    randomBytes(32).toString("hex");
const imessageSecret = createdLocalDeployment
  ? randomBytes(32).toString("hex")
  : optionalConvexEnv(convex, "IMESSAGE_WORKER_SECRET") ||
    randomBytes(32).toString("hex");
const localAppUrl = `http://localhost:${web}`;
const overridesPath = path.join(contextDirectory, "convex-local-overrides.env");

try {
  writeRuntimeEnv("convex-local-overrides.env", {
    GLASS_ENV: "local",
    MAPBOX_ACCESS_TOKEN:
      initialRootEnv.get("MAPBOX_ACCESS_TOKEN")?.trim() ||
      initialRootEnv.get("NEXT_PUBLIC_MAPBOX_TOKEN")?.trim(),
    ALLOW_DEV_CLEAR: "true",
    EMAIL_DELIVERY_MODE: "capture",
    IMESSAGE_ENABLED: "false",
    IMESSAGE_TERMINAL_ENABLED: "true",
    IMESSAGE_TERMINAL_BROKER_PHONE: terminalPhone,
    IMESSAGE_TERMINAL_CLIENT_PHONE: terminalClientPhone,
    IMESSAGE_TERMINAL_PUBLIC_PHONE: terminalPublicPhone,
    IMESSAGE_WORKER_URL: `http://127.0.0.1:${imessage}`,
    IMESSAGE_WORKER_SECRET: imessageSecret,
    EXTRACTION_WORKER_MODE: "external",
    EXTRACTION_WORKER_URL: `http://127.0.0.1:${extraction}`,
    EXTRACTION_WORKER_SECRET: extractionSecret,
    EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION: "source-tree-v1",
    EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION: expectedSdkVersion,
    APP_SITE_URL: localAppUrl,
    AUTH_LINK_SITE_URL: localAppUrl,
    CLIENT_PORTAL_URL: localAppUrl,
    SITE_URL: localAppUrl,
  });
  setConvexEnvFromFile(convex, overridesPath);
} finally {
  rmSync(overridesPath, { force: true });
}

if (createdLocalDeployment) {
  run(convex, [
    "run",
    "seed:seed",
    JSON.stringify({
      brokerPhone: terminalPhone,
      clientPhone: terminalClientPhone,
    }),
  ]);
}

writeRuntimeEnv("extraction-worker.env", {
  CONVEX_URL: localUrls.cloud,
  GLASS_ENV: "local",
  EXTRACTION_WORKER_SECRET: extractionSecret,
  EXTRACTION_WORKER_ID: `conductor-${workspaceSlug()}`,
  EXTRACTION_JOB_CONCURRENCY: "1",
  EXTRACTION_PREVIEW_CONCURRENCY: "1",
  FIREWORKS_API_KEY: optionalConvexEnv(convex, "FIREWORKS_API_KEY"),
  OPENAI_API_KEY: optionalConvexEnv(convex, "OPENAI_API_KEY"),
  ANTHROPIC_API_KEY: optionalConvexEnv(convex, "ANTHROPIC_API_KEY"),
  DEEPSEEK_API_KEY: optionalConvexEnv(convex, "DEEPSEEK_API_KEY"),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalConvexEnv(
    convex,
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ),
  MISTRAL_API_KEY: optionalConvexEnv(convex, "MISTRAL_API_KEY"),
  COHERE_API_KEY: optionalConvexEnv(convex, "COHERE_API_KEY"),
  XAI_API_KEY: optionalConvexEnv(convex, "XAI_API_KEY"),
});
writeRuntimeEnv("imessage-worker.env", {
  GLASS_ENV: "local",
  IMESSAGE_ENABLED: "false",
  SPECTRUM_PROVIDER: "terminal",
  CONVEX_SITE_URL: localUrls.site,
  IMESSAGE_WORKER_SECRET: imessageSecret,
  IMESSAGE_TERMINAL_FROM_PHONE: terminalPhone,
  IMESSAGE_TERMINAL_BROKER_PHONE: terminalPhone,
  IMESSAGE_TERMINAL_CLIENT_PHONE: terminalClientPhone,
  IMESSAGE_TERMINAL_PUBLIC_PHONE: terminalPublicPhone,
  IMESSAGE_TERMINAL_SPACE_ID:
    imessageEnv.get("IMESSAGE_TERMINAL_SPACE_ID")?.trim() || "chat-1",
});

run("npm", ["run", "check:agent-workers"]);

if (process.env.CONDUCTOR_IS_LOCAL !== "0") {
  ensureContainerService();
  buildWorkerImages();
}

console.log(
  "\nConductor workspace ready with its own local Convex database. Run the default Local dev template to start Glass, Convex, extraction, and the Spectrum terminal.",
);
