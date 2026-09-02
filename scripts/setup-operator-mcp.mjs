#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  operatorMcpClientSetups,
  operatorMcpEndpoint,
} from "../lib/operator-mcp-setup.ts";
import { localConvexUrls } from "./lib/conductor-workspace.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const USAGE = `Usage: npm run operator:mcp -- [options]

Registers the Spot operator MCP server with your local coding agents.

Options:
  --client <claude|codex|all>  Which agent to configure (default: all)
  --env <production|local>     Which deployment to point at (default: production)
  --url <endpoint>             Explicit MCP endpoint; overrides --env
  --scope <local|user|project> Claude Code configuration scope (default: user)
  --print                      Print the commands without running them
  --help                       Show this message
`;

const CLIENT_IDS = { claude: "claude-code", codex: "codex" };

function parseArgs(argv) {
  const options = {
    client: "all",
    env: "production",
    url: undefined,
    scope: "user",
    print: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--client":
        options.client = value();
        break;
      case "--env":
        options.env = value();
        break;
      case "--url":
        options.url = value();
        break;
      case "--scope":
        options.scope = value();
        break;
      case "--print":
        options.print = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }
  if (options.client !== "all" && !(options.client in CLIENT_IDS)) {
    throw new Error("--client must be claude, codex, or all");
  }
  if (!["local", "user", "project"].includes(options.scope)) {
    throw new Error("--scope must be local, user, or project");
  }
  return options;
}

function productionSiteUrl() {
  const deployments = JSON.parse(
    readFileSync(path.join(repoRoot, "config", "deployments.json"), "utf8"),
  );
  const healthUrl = deployments.production?.convexAgentHealthUrl;
  if (!healthUrl) {
    throw new Error(
      "config/deployments.json is missing the production Convex agent health URL",
    );
  }
  return new URL(healthUrl).origin;
}

function resolveEndpoint({ url, env }) {
  if (url) return operatorMcpEndpoint(url);
  if (env === "production") return operatorMcpEndpoint(productionSiteUrl());
  if (env === "local") {
    try {
      return operatorMcpEndpoint(localConvexUrls().site);
    } catch {
      throw new Error(
        "No worktree-local Convex deployment found. Run npm run conductor:setup first, or pass --url.",
      );
    }
  }
  throw new Error(
    `Unknown --env ${env}. Use production, local, or pass --url for another deployment.`,
  );
}

/** Returns false when the client itself is not installed. */
function run(command) {
  process.stdout.write(`\n$ ${command.join(" ")}\n`);
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.error?.code === "ENOENT") return false;
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with status ${result.status}`);
  }
  return true;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const endpoint = resolveEndpoint(options);
  const setups = operatorMcpClientSetups({
    endpoint,
    claudeScope: options.scope,
  }).filter(
    (setup) =>
      options.client === "all" || setup.id === CLIENT_IDS[options.client],
  );

  process.stdout.write(`Operator MCP endpoint: ${endpoint}\n`);

  for (const setup of setups) {
    if (options.print) {
      process.stdout.write(`\n# ${setup.label}\n${setup.snippet}\n`);
    } else if (run(setup.command)) {
      process.stdout.write(`\n${setup.label}: ${setup.followUp}\n`);
    } else {
      process.stdout.write(
        `\n${setup.label}: ${setup.command[0]} is not installed. Run this once it is:\n${setup.snippet}\n`,
      );
    }
  }

  if (!options.print) {
    process.stdout.write(
      "\nConductor Claude Code and Codex sessions reuse this same configuration.\n",
    );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
