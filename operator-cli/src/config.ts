import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type OperatorConfig = {
  convexUrl?: string;
  token?: string;
  tokenId?: string;
};

const configRoot = join(homedir(), ".glass", "operator");

export function resolveProfile(profile?: string): string {
  return profile || process.env.GLASS_OPERATOR_PROFILE || "default";
}

function configPath(profile: string) {
  return join(configRoot, `${profile}.json`);
}

export async function loadConfig(profile: string): Promise<OperatorConfig> {
  let stored: OperatorConfig = {};
  try {
    stored = JSON.parse(await readFile(configPath(profile), "utf8")) as OperatorConfig;
  } catch {
    stored = {};
  }

  return {
    convexUrl: process.env.GLASS_CONVEX_URL ?? process.env.CONVEX_URL ?? stored.convexUrl,
    token: process.env.GLASS_OPERATOR_TOKEN ?? process.env.OPERATOR_PROVISIONING_SECRET ?? stored.token,
    tokenId: process.env.GLASS_OPERATOR_TOKEN_ID ?? process.env.OPERATOR_PROVISIONING_TOKEN_ID ?? stored.tokenId,
  };
}

export async function saveConfig(profile: string, config: OperatorConfig): Promise<void> {
  await mkdir(configRoot, { recursive: true });
  await writeFile(configPath(profile), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath(profile), 0o600);
}

export async function deleteConfig(profile: string): Promise<void> {
  await rm(configPath(profile), { force: true });
}

export function requireConfig(config: OperatorConfig): Required<Pick<OperatorConfig, "convexUrl" | "token">> & OperatorConfig {
  if (!config.convexUrl) throw new Error("Missing Convex URL. Run auth:login or set GLASS_CONVEX_URL.");
  if (!config.token) throw new Error("Missing operator token. Run auth:login or set GLASS_OPERATOR_TOKEN.");
  return config as Required<Pick<OperatorConfig, "convexUrl" | "token">> & OperatorConfig;
}
