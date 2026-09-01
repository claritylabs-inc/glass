import { describe, expect, test } from "vitest";

import { fileMatchesAccept } from "./helpers";

describe("fileMatchesAccept", () => {
  test("accepts files by extension, exact media type, or media wildcard", () => {
    expect(
      fileMatchesAccept(
        { name: "renewals.CSV", type: "text/csv" },
        ".pdf,.csv",
      ),
    ).toBe(true);
    expect(
      fileMatchesAccept(
        { name: "evidence.bin", type: "application/pdf" },
        "application/pdf",
      ),
    ).toBe(true);
    expect(
      fileMatchesAccept(
        { name: "photo.heic", type: "image/heic" },
        "image/*",
      ),
    ).toBe(true);
  });

  test("rejects files that match neither their extension nor media type", () => {
    expect(
      fileMatchesAccept(
        { name: "payload.exe", type: "application/octet-stream" },
        ".pdf,image/*",
      ),
    ).toBe(false);
  });
});
