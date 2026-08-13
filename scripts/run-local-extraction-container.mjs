import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import {
  conductorContainerName,
  conductorImageTag,
  containerGateway,
  ensureNode24,
  listenOnContainerGateway,
  repoRoot,
  waitForLocalConvex,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

const port = Number.parseInt(process.env.PORT ?? "8081", 10);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const { cloud } = await waitForLocalConvex();
const localConvexUrl = new URL(cloud);
const convexPort = Number.parseInt(localConvexUrl.port, 10);
const gateway = containerGateway({ startServiceIfNeeded: true });
const containerName = conductorContainerName("extraction", port);

function containerCommand(args, options = {}) {
  return spawnSync("container", args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "ignore",
    ...options,
  });
}

function removeStaleContainer() {
  containerCommand(["kill", containerName]);
  containerCommand(["delete", containerName]);
}

function detachCleanup() {
  const cleanup = spawn(
    "/bin/zsh",
    [
      "-c",
      `container kill ${containerName} >/dev/null 2>&1 || true; container delete ${containerName} >/dev/null 2>&1 || true`,
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: process.env,
      stdio: "ignore",
    },
  );
  cleanup.unref();
}

removeStaleContainer();

const proxy = net.createServer((client) => {
  const upstream = net.createConnection({
    host: "127.0.0.1",
    port: convexPort,
  });
  client.pipe(upstream);
  upstream.pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
});

const containerConvexUrl = `http://${gateway}:${convexPort}`;
let stopping = false;
let proxyReady = false;
let rejectStartup;
const startupFailure = new Promise((_, reject) => {
  rejectStartup = reject;
});
const child = spawn(
  "container",
  [
    "run",
    "--name",
    containerName,
    "--arch",
    "amd64",
    "--rm",
    "--env-file",
    ".context/extraction-worker.env",
    "-e",
    `CONVEX_URL=${containerConvexUrl}`,
    "-e",
    `PORT=${port}`,
    "-p",
    `127.0.0.1:${port}:${port}`,
    conductorImageTag("extraction-worker"),
  ],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  },
);

function stop() {
  if (stopping) return;
  stopping = true;
  proxy.close();
  detachCleanup();
  process.exit(0);
}

process.once("SIGHUP", stop);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

child.on("error", (error) => {
  if (!proxyReady) {
    rejectStartup(error);
    return;
  }
  console.error(error);
  proxy.close();
  detachCleanup();
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (!proxyReady) {
    rejectStartup(
      new Error(
        `Apple extraction container exited during startup (${signal ?? code ?? "unknown"})`,
      ),
    );
    return;
  }
  proxy.close();
  if (stopping) return;
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

try {
  await Promise.race([
    listenOnContainerGateway(proxy, {
      gateway,
      port: convexPort,
    }),
    startupFailure,
  ]);
  proxyReady = true;
} catch (error) {
  proxy.close();
  child.kill("SIGTERM");
  detachCleanup();
  throw error;
}
