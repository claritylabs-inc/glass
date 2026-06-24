import { execFileSync } from "node:child_process";
import os from "node:os";
import process from "node:process";

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryRun(command, args) {
  try {
    return { ok: true, output: run(command, args) };
  } catch (error) {
    return {
      ok: false,
      output: String(error.stderr || error.message || error),
    };
  }
}

const failures = [];

if (process.platform !== "darwin") {
  failures.push(`Expected macOS, got ${process.platform}.`);
}

if (os.arch() !== "arm64") {
  failures.push(`Expected Apple silicon arm64, got ${os.arch()}.`);
}

const swVers = tryRun("sw_vers", ["-productVersion"]);
if (swVers.ok) {
  const major = Number.parseInt(swVers.output.split(".")[0] || "0", 10);
  if (major < 26) {
    failures.push(`Apple container is supported on macOS 26+; found ${swVers.output}.`);
  }
} else {
  failures.push(`Could not read macOS version: ${swVers.output}`);
}

const containerPath = tryRun("zsh", ["-lc", "command -v container"]);
if (!containerPath.ok || !containerPath.output) {
  failures.push(
    "Apple container CLI is not on PATH. Install the signed pkg from https://github.com/apple/container/releases/latest.",
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const version = tryRun("container", ["--version"]);
const systemStatus = tryRun("container", ["system", "status"]);

console.log(`container path: ${containerPath.output}`);
console.log(`container version: ${version.ok ? version.output : "unavailable"}`);

if (systemStatus.ok) {
  console.log("container system status: OK");
} else {
  console.error("container system status: unavailable");
  console.error("Run `npm run container:system:start` to start or initialize Apple container.");
  console.error(systemStatus.output);
  process.exit(1);
}
