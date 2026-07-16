import { spawn } from "node:child_process";
import path from "node:path";
import {
  conductorPorts,
  ensureNode24,
  repoRoot,
  waitForLocalConvex,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

const { web } = conductorPorts();
await waitForLocalConvex();

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
