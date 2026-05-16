/// <reference types="vite/client" />
// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { isDoclingEnabled } from "./featureFlags";

function ctxWithOrg(org: any) {
  return { runQuery: vi.fn().mockResolvedValue(org) } as any;
}

describe("isDoclingEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("env unset disables by default", async () => {
    vi.stubEnv("DOCLING_ENABLED", "");
    await expect(isDoclingEnabled(ctxWithOrg({}), "org" as any)).resolves.toBe(false);
  });

  test("env true enables when org has no override", async () => {
    vi.stubEnv("DOCLING_ENABLED", "true");
    await expect(isDoclingEnabled(ctxWithOrg({}), "org" as any)).resolves.toBe(true);
  });

  test("org true override wins", async () => {
    vi.stubEnv("DOCLING_ENABLED", "false");
    await expect(isDoclingEnabled(ctxWithOrg({ featureFlags: { docling: true } }), "org" as any)).resolves.toBe(true);
  });

  test("org false override wins", async () => {
    vi.stubEnv("DOCLING_ENABLED", "true");
    await expect(isDoclingEnabled(ctxWithOrg({ featureFlags: { docling: false } }), "org" as any)).resolves.toBe(false);
  });

  test("missing org returns false", async () => {
    vi.stubEnv("DOCLING_ENABLED", "true");
    await expect(isDoclingEnabled(ctxWithOrg(null), "org" as any)).resolves.toBe(false);
  });
});
