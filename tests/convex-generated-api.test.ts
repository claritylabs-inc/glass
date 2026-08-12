import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { expect, test } from "vitest";

const convexRoot = join(process.cwd(), "convex");

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? typescriptFiles(path)
      : entry.isFile() && entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}

function isApiModule(path: string) {
  const relativePath = relative(convexRoot, path).split(sep).join("/");
  return (
    !relativePath.startsWith("_generated/") &&
    !relativePath.includes("/_generated/") &&
    !relativePath.startsWith("tests/") &&
    !basename(relativePath).endsWith(".test.ts") &&
    !basename(relativePath).endsWith(".d.ts") &&
    relativePath !== "auth.config.ts" &&
    relativePath !== "convex.config.ts" &&
    relativePath !== "schema.ts"
  );
}

test("generated Convex API bindings include every current module", () => {
  const generatedApi = readFileSync(
    join(convexRoot, "_generated/api.d.ts"),
    "utf8",
  );
  const missingModules = typescriptFiles(convexRoot)
    .filter(isApiModule)
    .map((path) =>
      relative(convexRoot, path).split(sep).join("/").replace(/\.ts$/, ""),
    )
    .filter(
      (modulePath) =>
        !generatedApi.includes(`  "${modulePath}": typeof `) &&
        !generatedApi.includes(`  ${modulePath}: typeof `),
    )
    .sort();

  expect(missingModules).toEqual([]);
});
