import { StringDecoder } from "node:string_decoder";
import { open, stat } from "node:fs/promises";
import { unwatchFile, watchFile } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ensureNode24,
  repoRoot,
} from "./lib/conductor-workspace.mjs";

const captureMarker = "[spot:local-email-capture]";
const codeCandidatesKey = "codeCandidates:";

function normalizeLogText(contents) {
  return contents.replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n");
}

function fieldValue(block, name) {
  const line = block
    .split("\n")
    .find((candidate) => candidate.trimStart().startsWith(`${name}:`));
  return line?.trimStart().slice(name.length + 1).trim() ?? "";
}

export function consumeLocalEmailCaptures(contents) {
  const normalized = normalizeLogText(contents);
  const captures = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const markerIndex = normalized.indexOf(captureMarker, cursor);
    if (markerIndex < 0) {
      return {
        captures,
        remainder: normalized.slice(
          Math.max(cursor, normalized.length - captureMarker.length + 1),
        ),
      };
    }

    const nextMarkerIndex = normalized.indexOf(
      captureMarker,
      markerIndex + captureMarker.length,
    );
    const codeIndex = normalized.indexOf(codeCandidatesKey, markerIndex);
    if (
      codeIndex < 0 ||
      (nextMarkerIndex >= 0 && nextMarkerIndex < codeIndex)
    ) {
      if (nextMarkerIndex >= 0) {
        cursor = nextMarkerIndex;
        continue;
      }
      return { captures, remainder: normalized.slice(markerIndex) };
    }

    const codeLineEnd = normalized.indexOf("\n", codeIndex);
    if (codeLineEnd < 0) {
      return { captures, remainder: normalized.slice(markerIndex) };
    }

    const block = normalized.slice(markerIndex, codeLineEnd);
    const codeCandidates = fieldValue(block, "codeCandidates");
    captures.push({
      kind: fieldValue(block, "kind") || "email",
      to: fieldValue(block, "to") || "(none)",
      subject: fieldValue(block, "subject") || "(no subject)",
      codes:
        codeCandidates === "(none)"
          ? []
          : [...codeCandidates.matchAll(/\b\d{6}\b/g)].map(
              (match) => match[0],
            ),
    });
    cursor = codeLineEnd + 1;
  }

  return { captures, remainder: "" };
}

export function formatLocalEmailCapture(capture) {
  const lines = [
    "",
    "[Spot local email capture]",
    `To: ${capture.to}`,
    `Subject: ${capture.subject}`,
  ];
  if (capture.codes.length > 0) {
    lines.push(`OTP: ${capture.codes.join(", ")}`);
  }
  lines.push("Full email: .context/logs/convex.log", "");
  return lines.join("\n");
}

async function watchEmailCaptures() {
  ensureNode24();
  process.chdir(repoRoot);

  const logPath = path.join(repoRoot, ".context", "logs", "convex.log");
  let decoder = new StringDecoder("utf8");
  let position = 0;
  let pending = "";
  let reading = false;
  let readAgain = false;

  const readAvailable = async () => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      do {
        readAgain = false;
        let fileStats;
        try {
          fileStats = await stat(logPath);
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }

        if (fileStats.size < position) {
          position = 0;
          pending = "";
          decoder.end();
          decoder = new StringDecoder("utf8");
        }
        if (fileStats.size === position) continue;

        const handle = await open(logPath, "r");
        try {
          while (position < fileStats.size) {
            const length = Math.min(64 * 1024, fileStats.size - position);
            const chunk = Buffer.allocUnsafe(length);
            const { bytesRead } = await handle.read(
              chunk,
              0,
              length,
              position,
            );
            if (bytesRead === 0) break;
            position += bytesRead;
            pending += decoder.write(chunk.subarray(0, bytesRead));
            const consumed = consumeLocalEmailCaptures(pending);
            pending = consumed.remainder;
            for (const capture of consumed.captures) {
              process.stdout.write(formatLocalEmailCapture(capture));
            }
          }
        } finally {
          await handle.close();
        }
      } while (readAgain);
    } finally {
      reading = false;
    }
  };

  console.log(
    "Watching local email deliveries and OTPs (full messages stay in .context/logs/convex.log)...",
  );
  watchFile(logPath, { interval: 200 }, () => {
    void readAvailable().catch((error) => {
      console.error("Unable to read local email captures:", error);
      process.exitCode = 1;
    });
  });
  await readAvailable();

  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      unwatchFile(logPath);
      process.exit();
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await watchEmailCaptures();
}
