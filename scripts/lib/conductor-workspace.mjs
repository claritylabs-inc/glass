import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDirectory, "../..");

export function ensureNode22() {
  if (process.versions.node.split(".")[0] === "22") {
    const nodeBin = path.dirname(process.execPath);
    if (!process.env.PATH?.split(path.delimiter).includes(nodeBin)) {
      process.env.PATH = `${nodeBin}${path.delimiter}${process.env.PATH ?? ""}`;
    }
    return;
  }

  if (process.env.GLASS_NODE_22_BOOTSTRAPPED === "1") {
    throw new Error(`Glass requires Node 22.x; found ${process.version}`);
  }

  const brewPrefix = spawnSync("brew", ["--prefix", "node@22"], {
    encoding: "utf8",
  });
  const prefix = brewPrefix.status === 0 ? brewPrefix.stdout.trim() : "";
  let nodePath = prefix ? path.join(prefix, "bin", "node") : "";

  if (!nodePath || !existsSync(nodePath)) {
    console.log(
      "Installing the repository-standard Node 22 toolchain with Homebrew...",
    );
    const install = spawnSync("brew", ["install", "--yes", "node@22"], {
      stdio: "inherit",
    });
    if (install.error) throw install.error;
    if (install.status !== 0) {
      throw new Error("Unable to install Homebrew node@22");
    }
    const installedPrefix = spawnSync("brew", ["--prefix", "node@22"], {
      encoding: "utf8",
    });
    if (installedPrefix.status !== 0) {
      throw new Error(
        "Homebrew installed node@22 but its prefix is unavailable",
      );
    }
    nodePath = path.join(installedPrefix.stdout.trim(), "bin", "node");
  }

  const nodeBin = path.dirname(nodePath);
  const result = spawnSync(nodePath, process.argv.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GLASS_NODE_22_BOOTSTRAPPED: "1",
      PATH: `${nodeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

export function parseEnvText(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const inlineComment = value.search(/\s+#/);
      if (inlineComment >= 0) value = value.slice(0, inlineComment).trimEnd();
    }
    values.set(key, value);
  }
  return values;
}

export function parseEnvFile(filePath) {
  return parseEnvText(readFileSync(filePath, "utf8"));
}

export function conductorPorts() {
  const basePort = Number.parseInt(process.env.CONDUCTOR_PORT ?? "8080", 10);
  if (!Number.isInteger(basePort) || basePort <= 0 || basePort > 65531) {
    throw new Error("CONDUCTOR_PORT must be an integer between 1 and 65531");
  }
  return {
    web: basePort,
    extraction: basePort + 1,
    imessage: basePort + 2,
    convexCloud: basePort + 3,
    convexSite: basePort + 4,
  };
}

export function workspaceSlug() {
  return (
    (process.env.CONDUCTOR_WORKSPACE_NAME?.trim() || path.basename(repoRoot))
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace"
  );
}

export function conductorImageTag(workerName) {
  return `glass-${workerName}:conductor-${workspaceSlug()}`;
}

export function localConvexUrls() {
  const config = JSON.parse(
    readFileSync(
      path.join(repoRoot, ".convex", "local", "default", "config.json"),
      "utf8",
    ),
  );
  const env = parseEnvFile(path.join(repoRoot, ".env.local"));
  const deployment = env.get("CONVEX_DEPLOYMENT")?.trim();
  const cloud = env.get("NEXT_PUBLIC_CONVEX_URL")?.trim();
  const site = env.get("NEXT_PUBLIC_CONVEX_SITE_URL")?.trim();
  if (!deployment || !/^(anonymous|local):/.test(deployment)) {
    throw new Error(
      "This worktree is not configured for a native local Convex deployment. Run npm run conductor:setup.",
    );
  }
  if (
    !cloud?.startsWith("http://127.0.0.1:") ||
    !site?.startsWith("http://127.0.0.1:")
  ) {
    throw new Error(
      "The selected local Convex deployment has invalid loopback URLs",
    );
  }
  if (
    cloud !== `http://127.0.0.1:${config.ports?.cloud}` ||
    site !== `http://127.0.0.1:${config.ports?.site}`
  ) {
    throw new Error(
      "Convex has not written its current local ports to .env.local yet",
    );
  }
  return { cloud, site, deployment };
}

export async function waitForLocalConvex({ timeoutMs = 120_000 } = {}) {
  const configPath = path.join(
    repoRoot,
    ".convex",
    "local",
    "default",
    "config.json",
  );
  const envPath = path.join(repoRoot, ".env.local");
  const markerPath = process.env.CONDUCTOR_RUN_MARKER;
  const markerMtime =
    markerPath && existsSync(markerPath)
      ? statSync(markerPath).mtimeMs
      : undefined;
  const started = performance.now();
  let lastError;

  while (performance.now() - started < timeoutMs) {
    try {
      if (!existsSync(configPath) || !existsSync(envPath)) {
        throw new Error("local Convex configuration has not been written yet");
      }
      if (
        markerMtime !== undefined &&
        statSync(configPath).mtimeMs < markerMtime
      ) {
        throw new Error(
          "the current Convex watcher has not selected its ports yet",
        );
      }
      const urls = localConvexUrls();
      const response = await fetch(`${urls.cloud}/instance_name`);
      if (!response.ok)
        throw new Error(`Convex returned HTTP ${response.status}`);
      await response.text();
      return urls;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(
    `Local Convex did not become ready within ${timeoutMs / 1000} seconds: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

export function containerGateway() {
  const result = spawnSync(
    "container",
    ["network", "list", "--format", "json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Unable to inspect the Apple container default network");
  }
  const networks = JSON.parse(result.stdout);
  const defaultNetwork = networks.find(
    (network) =>
      network.id === "default" || network.configuration?.name === "default",
  );
  const gateway = defaultNetwork?.status?.ipv4Gateway;
  if (typeof gateway !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
    throw new Error("Apple container did not report an IPv4 gateway");
  }
  return gateway;
}
