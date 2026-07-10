import { spawn } from "node:child_process";
import path from "node:path";
import {
  conductorPorts,
  ensureNode22,
  parseEnvFile,
  repoRoot,
  waitForLocalConvex,
} from "./lib/conductor-workspace.mjs";

ensureNode22();
process.chdir(repoRoot);

const { imessage } = conductorPorts();
const { site } = await waitForLocalConvex();
const workerEnv = Object.fromEntries(
  parseEnvFile(path.join(repoRoot, ".context", "imessage-worker.env")),
);

const child = spawn(
  "script",
  ["-q", "/dev/null", process.execPath, "imessage-worker/dist/index.js"],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...workerEnv,
      CONVEX_SITE_URL: site,
      GLASS_ENV: "local",
      IMESSAGE_ENABLED: "false",
      SPECTRUM_PROVIDER: "terminal",
      PORT: String(imessage),
      WORKER_HTTP_PORT: String(imessage),
    },
    stdio: "inherit",
  },
);

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
