import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readPackageJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

const appPackage = readPackageJson("package.json");
const workerPackage = readPackageJson("extraction-worker/package.json");

const appVersion = appPackage.dependencies?.["@claritylabs/cl-sdk"];
const workerVersion = workerPackage.dependencies?.["@claritylabs/cl-sdk"];

if (!appVersion || !workerVersion) {
  console.error("@claritylabs/cl-sdk must be listed in both root and extraction-worker dependencies.");
  process.exit(1);
}

if (appVersion !== workerVersion) {
  console.error(
    `@claritylabs/cl-sdk version mismatch: root has ${appVersion}, extraction-worker has ${workerVersion}.`,
  );
  process.exit(1);
}

console.log(`@claritylabs/cl-sdk versions aligned at ${appVersion}.`);
