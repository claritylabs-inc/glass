import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { GlassConfig } from "./types.js";

const configDir = join(homedir(), ".glass");
const configPath = join(configDir, "config.json");

export async function loadConfig(): Promise<GlassConfig> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as GlassConfig;
  } catch {
    return { baseUrl: process.env.GLASS_BASE_URL ?? "http://localhost:8080" };
  }
}

export async function saveConfig(config: GlassConfig): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
}
