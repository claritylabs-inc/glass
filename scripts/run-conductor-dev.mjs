import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  conductorPorts,
  ensureNode22,
  repoRoot,
} from "./lib/conductor-workspace.mjs";

ensureNode22();
process.chdir(repoRoot);

const requiredPaths = [
  ".context/extraction-worker.env",
  ".context/imessage-worker.env",
  ".convex/local/default/config.json",
  "imessage-worker/dist/index.js",
  "node_modules/.bin/concurrently",
  "node_modules/.bin/convex",
  "node_modules/.bin/next",
  "scripts/run-conductor-imessage-terminal.mjs",
  "scripts/run-conductor-web.mjs",
  "scripts/run-local-extraction-container.mjs",
];
for (const relativePath of requiredPaths) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(
      `${relativePath} is missing. Run npm run conductor:setup before starting local development.`,
    );
  }
}

const { web, extraction, imessage, convexCloud, convexSite } = conductorPorts();
const logDirectory = path.join(repoRoot, ".context", "logs");
mkdirSync(logDirectory, { recursive: true });
for (const name of ["web", "convex", "extraction"]) {
  writeFileSync(path.join(logDirectory, `${name}.log`), "");
}

const markerPath = path.join(repoRoot, ".context", "conductor-run-marker");
writeFileSync(markerPath, `${randomBytes(16).toString("hex")}\n`);

const commands = [
  "node scripts/run-conductor-web.mjs >> .context/logs/web.log 2>&1",
  `CONVEX_AGENT_MODE=anonymous ./node_modules/.bin/convex dev --local-cloud-port ${convexCloud} --local-site-port ${convexSite} >> .context/logs/convex.log 2>&1`,
  `PORT=${extraction} node scripts/run-local-extraction-container.mjs >> .context/logs/extraction.log 2>&1`,
  `PORT=${imessage} node scripts/run-conductor-imessage-terminal.mjs`,
];

console.log(`Glass web:              http://localhost:${web}`);
console.log(`Extraction worker:      http://localhost:${extraction}/health`);
console.log(`Spectrum terminal HTTP: http://localhost:${imessage}/health`);
console.log(`Convex:                  http://127.0.0.1:${convexCloud}`);
console.log(
  "Background logs:        .context/logs/{web,convex,extraction}.log",
);
console.log("The Run terminal opens the interactive Spectrum iMessage TUI.\n");

const child = spawn(
  path.join(repoRoot, "node_modules", ".bin", "concurrently"),
  [
    "--raw",
    "--kill-others",
    "--handle-input",
    "--default-input-target",
    "imessage",
    "--names",
    "web,convex,extraction,imessage",
    ...commands,
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      CONDUCTOR_RUN_MARKER: markerPath,
    },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
