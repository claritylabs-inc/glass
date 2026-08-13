import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import {
  conductorPorts,
  conductorLocalRuntimeOverrides,
  ensureNode24,
  repoRoot,
  waitForLocalConvex,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

const { web } = conductorPorts();
await waitForLocalConvex();
const convex = path.join(repoRoot, "node_modules", ".bin", "convex");
for (const [name, value] of Object.entries(conductorLocalRuntimeOverrides())) {
  const result = spawnSync(convex, ["env", "set", name, value], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not refresh ${name} for this Conductor workspace: ${result.stderr.trim()}`,
    );
  }
}
console.log("Refreshed this workspace's local app and worker URLs.");

const child = spawn(
  path.join(repoRoot, "node_modules", ".bin", "next"),
  ["dev", "-p", String(web)],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_URL: `http://localhost:${web}`,
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
