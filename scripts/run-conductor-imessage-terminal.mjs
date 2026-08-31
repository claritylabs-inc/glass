import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  conductorPorts,
  ensureNode24,
  parseEnvFile,
  repoRoot,
  waitForLocalConvex,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

for (const relativePath of [
  ".context/imessage-worker.env",
  ".convex/local/default/config.json",
  "imessage-worker/dist/index.js",
]) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(
      `${relativePath} is missing. Run npm run conductor:setup before starting Spectrum.`,
    );
  }
}

const { imessage } = conductorPorts();
const { site } = await waitForLocalConvex();
const workerEnv = Object.fromEntries(
  parseEnvFile(path.join(repoRoot, ".context", "imessage-worker.env")),
);
const terminalEnvironment = {
  ...process.env,
  ...workerEnv,
  CONVEX_SITE_URL: site,
  SPOT_ENV: "local",
  IMESSAGE_ENABLED: "false",
  SPECTRUM_PROVIDER: "terminal",
  PORT: String(imessage),
  WORKER_HTTP_PORT: String(imessage),
  NO_COLOR: "1",
};
delete terminalEnvironment.FORCE_COLOR;

const scriptArguments =
  process.platform === "darwin"
    ? ["-q", "/dev/null", process.execPath, "imessage-worker/dist/index.js"]
    : [
        "-q",
        "-c",
        `"${process.execPath}" imessage-worker/dist/index.js`,
        "/dev/null",
      ];
const child = spawn(
  "script",
  scriptArguments,
  {
    cwd: repoRoot,
    env: terminalEnvironment,
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
