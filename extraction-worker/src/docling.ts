import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { access, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import dayjs from "dayjs";

export type DoclingConversionMetadata = {
  parserBackend: "docling";
  parserVersion?: string;
  parsedAt: number;
  parsingMs?: number;
};

export type DoclingConversionResult = {
  document: Record<string, unknown>;
  metadata: DoclingConversionMetadata;
};

type ConvertOptions = {
  timeoutMs?: number;
  maxPages?: number;
  maxFileSize?: number;
};

const DEFAULT_TIMEOUT_MS = readBoundedIntEnv("DOCLING_CONVERT_TIMEOUT_MS", 120_000, 1_000, 15 * 60_000);
const MAX_STDIO_BYTES = 10 * 1024 * 1024;

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function firstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveConverterScript(): Promise<string> {
  if (process.env.DOCLING_CONVERTER_SCRIPT) {
    return process.env.DOCLING_CONVERTER_SCRIPT;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const script = await firstExistingPath([
    path.join(currentDir, "docling_convert.py"),
    path.join(currentDir, "../src/docling_convert.py"),
  ]);
  if (!script) {
    throw new Error("Docling converter script not found");
  }
  return script;
}

export async function convertPdfWithDocling(
  pdfBytes: Uint8Array,
  options: ConvertOptions = {},
): Promise<DoclingConversionResult> {
  const script = await resolveConverterScript();
  const workDir = path.join(tmpdir(), `glass-docling-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const pdfPath = path.join(workDir, "document.pdf");
  await writeFile(pdfPath, pdfBytes);

  const args = [script, pdfPath];
  if (options.maxPages !== undefined) {
    args.push("--max-pages", String(options.maxPages));
  }
  if (options.maxFileSize !== undefined) {
    args.push("--max-file-size", String(options.maxFileSize));
  }

  try {
    const result = await runPython(args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const parsed = JSON.parse(result.stdout) as {
      document?: unknown;
      metadata?: Partial<DoclingConversionMetadata>;
    };
    if (!parsed.document || typeof parsed.document !== "object") {
      throw new Error("Docling converter returned no document");
    }
    return {
      document: parsed.document as Record<string, unknown>,
      metadata: {
        parserBackend: "docling",
        parserVersion: parsed.metadata?.parserVersion,
        parsedAt: dayjs().valueOf(),
        parsingMs: parsed.metadata?.parsingMs,
      },
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runPython(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON_BIN ?? "python3";
    const child = spawn(python, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Docling conversion timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_STDIO_BYTES && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error("Docling converter stdout exceeded maximum size"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_STDIO_BYTES) {
        stderr = stderr.slice(-MAX_STDIO_BYTES);
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Docling converter exited with ${code}: ${stderr.trim() || "no stderr"}`));
      }
    });
  });
}
