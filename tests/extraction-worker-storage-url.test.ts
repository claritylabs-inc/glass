import { describe, expect, test } from "vitest";
import { resolveConvexStorageUrl } from "../extraction-worker/src/convexStorageUrl";

const LOCAL_OPTIONS = {
  glassEnv: "local",
  convexUrl: "http://192.168.64.1:55053",
};

describe("extraction worker Convex storage URLs", () => {
  test("routes local Convex download URLs through the container bridge", () => {
    expect(resolveConvexStorageUrl(
      "http://127.0.0.1:55053/api/storage/abc?token=signed#page=1",
      LOCAL_OPTIONS,
    )).toBe("http://192.168.64.1:55053/api/storage/abc?token=signed#page=1");
  });

  test("routes localhost upload URLs through the same bridge", () => {
    expect(resolveConvexStorageUrl(
      "http://localhost:55053/api/storage/upload?token=signed",
      LOCAL_OPTIONS,
    )).toBe("http://192.168.64.1:55053/api/storage/upload?token=signed");
  });

  test("does not rewrite another loopback service", () => {
    const url = "http://127.0.0.1:55054/api/storage/abc";
    expect(resolveConvexStorageUrl(url, LOCAL_OPTIONS)).toBe(url);
  });

  test("does not rewrite public or non-local storage URLs", () => {
    const publicUrl = "https://example.convex.cloud/api/storage/abc?token=signed";
    const localUrl = "http://127.0.0.1:55053/api/storage/abc?token=signed";

    expect(resolveConvexStorageUrl(publicUrl, LOCAL_OPTIONS)).toBe(publicUrl);
    expect(resolveConvexStorageUrl(localUrl, {
      ...LOCAL_OPTIONS,
      glassEnv: "production",
    })).toBe(localUrl);
  });

  test("leaves malformed values unchanged", () => {
    expect(resolveConvexStorageUrl("not a URL", LOCAL_OPTIONS)).toBe("not a URL");
  });
});
