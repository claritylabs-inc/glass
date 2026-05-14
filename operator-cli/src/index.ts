#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { OperatorClient } from "./client.js";
import { deleteConfig, loadConfig, resolveProfile, saveConfig } from "./config.js";

type GlobalOptions = {
  profile?: string;
  json?: boolean;
};

const program = new Command();
program
  .name("glass-operator")
  .description("Private Glass operator CLI")
  .version("0.1.0")
  .option("--profile <profile>", "operator config profile")
  .option("--json", "print JSON output");

program
  .command("auth:login")
  .description("Store operator credentials and verify signed auth")
  .requiredOption("--convex-url <url>", "Convex deployment URL")
  .requiredOption("--token <token>", "operator provisioning token")
  .option("--token-id <id>", "operator token id")
  .action(async (options) => {
    const profile = currentProfile();
    const config = {
      convexUrl: options.convexUrl,
      token: options.token,
      tokenId: options.tokenId,
    };
    const result = await new OperatorClient(config).checkAuth();
    await saveConfig(profile, config);
    print({ profile, ...result }, outputJson());
  });

program
  .command("auth:check")
  .description("Verify stored or environment operator credentials")
  .action(async () => {
    const result = await new OperatorClient(await loadConfig(currentProfile())).checkAuth();
    print(result, outputJson());
  });

program
  .command("auth:logout")
  .description("Delete stored operator credentials for the current profile")
  .action(async () => {
    const profile = currentProfile();
    await deleteConfig(profile);
    print({ ok: true, profile }, outputJson());
  });

program
  .command("provision-broker")
  .description("Create or update a broker org, admin account, and optional draft clients")
  .option("--input <file>", "JSON payload file")
  .option("--name <name>", "broker organization name")
  .option("--slug <slug>", "broker workspace slug")
  .option("--website <url>", "broker website")
  .option("--partner-type <type>", "broker | program_admin | carrier | other")
  .option("--branding-color <hex>", "broker branding hex color")
  .option("--white-labeling-enabled <boolean>", "true or false")
  .option("--agent-display-name <name>", "broker agent display name")
  .option("--agent-handle <handle>", "broker agent email handle")
  .option("--admin-email <email>", "broker admin email")
  .option("--admin-name <name>", "broker admin name")
  .option("--admin-title <title>", "broker admin title")
  .option("--mark-onboarding-complete <boolean>", "true or false", "true")
  .option("--client <value>", "draft client as Name|email|website", collect, [])
  .action(async (options) => {
    const body = await buildProvisionPayload(options);
    const result = await new OperatorClient(await loadConfig(currentProfile())).provisionBroker(body);
    print(result, outputJson());
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

function currentProfile(): string {
  return resolveProfile((program.opts<GlobalOptions>()).profile);
}

function outputJson(): boolean {
  return Boolean((program.opts<GlobalOptions>()).json);
}

function collect(value: string, previous: string[]) {
  return [...previous, value];
}

async function buildProvisionPayload(options: Record<string, unknown>) {
  if (typeof options.input === "string") {
    const raw = await readFile(options.input, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  const name = requiredString(options.name, "--name");
  const adminEmail = requiredString(options.adminEmail, "--admin-email");
  return {
    broker: compact({
      name,
      slug: optionalString(options.slug),
      website: optionalString(options.website),
      partnerType: optionalString(options.partnerType),
      brandingColor: optionalString(options.brandingColor),
      whiteLabelingEnabled: parseOptionalBoolean(options.whiteLabelingEnabled),
      agentDisplayName: optionalString(options.agentDisplayName),
      agentHandle: optionalString(options.agentHandle),
    }),
    admin: compact({
      email: adminEmail,
      name: optionalString(options.adminName),
      title: optionalString(options.adminTitle),
    }),
    clients: ((options.client as string[] | undefined) ?? []).map(parseClient),
    markOnboardingComplete: parseOptionalBoolean(options.markOnboardingComplete) ?? true,
  };
}

function parseClient(value: string) {
  const [name, primaryContactEmail, website] = value.split("|").map((part) => part.trim());
  if (!name) throw new Error(`Invalid --client value "${value}". Use "Name|email|website".`);
  return compact({ name, primaryContactEmail, website });
}

function requiredString(value: unknown, option: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required option ${option}`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`Expected boolean value, got ${String(value)}`);
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  );
}

function print(data: unknown, json: boolean) {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.dir(data, { depth: null });
}
