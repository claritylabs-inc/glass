import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  ensureNode24,
  parseEnvText,
  repoRoot,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

const localDeploymentDirectory = path.join(repoRoot, ".convex", "local", "default");
if (!existsSync(localDeploymentDirectory)) {
  console.log("No worktree-local Convex database remains to clear.");
  process.exit(0);
}

const envPath = path.join(repoRoot, ".env.local");
const deployment = existsSync(envPath)
  ? parseEnvText(readFileSync(envPath, "utf8")).get("CONVEX_DEPLOYMENT")?.trim()
  : undefined;
if (!deployment || !/^(anonymous|local):/.test(deployment)) {
  throw new Error(
    "Refusing to clear Convex state because this worktree is not selecting a native local deployment.",
  );
}

if (process.env.CONDUCTOR_ARCHIVE_DRY_RUN === "1") {
  console.log(`Would clear ${path.relative(repoRoot, localDeploymentDirectory)}`);
  process.exit(0);
}

rmSync(localDeploymentDirectory, { recursive: true, force: true });
console.log("Cleared the worktree-local Convex database and auth state.");
