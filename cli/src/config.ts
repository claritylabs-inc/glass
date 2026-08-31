import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SpotConfig } from "./types.js";

const configDir = join(homedir(), ".spot");
const configPath = join(configDir, "config.json");
const legacyConfigPath = join(homedir(), ".glass", "config.json");
const defaultBaseUrl = "https://app.spot.insure";
const legacyClientId = "glass-cli";

function normalizeConfig(config: SpotConfig): SpotConfig {
  const configuredBaseUrl =
    process.env.SPOT_BASE_URL ?? process.env.GLASS_BASE_URL ?? config.baseUrl;
  const baseUrl = [
    "https://glass.claritylabs.inc",
    "https://app.glass.insure",
    "https://spot.claritylabs.inc",
  ].includes(configuredBaseUrl)
    ? defaultBaseUrl
    : configuredBaseUrl;
  return { ...config, baseUrl };
}

export async function loadConfig(): Promise<SpotConfig> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return normalizeConfig(JSON.parse(raw) as SpotConfig);
  } catch {
    try {
      const raw = await readFile(legacyConfigPath, "utf-8");
      const migrated = normalizeConfig({
        ...(JSON.parse(raw) as SpotConfig),
        clientId: legacyClientId,
      });
      await saveConfig(migrated);
      return migrated;
    } catch {
      return {
        baseUrl:
          process.env.SPOT_BASE_URL ??
          process.env.GLASS_BASE_URL ??
          defaultBaseUrl,
      };
    }
  }
}

export async function saveConfig(config: SpotConfig): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
}
