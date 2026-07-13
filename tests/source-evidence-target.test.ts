import { describe, expect, it } from "vitest";
import { sourceEvidenceTarget } from "../app/policies/[id]/source-provenance";

describe("source evidence targets", () => {
  it("prefers exact boxes and keeps their source page", () => {
    expect(sourceEvidenceTarget(["span-1"], [{
      spanId: "span-1",
      pageStart: 4,
      bbox: [{ page: 4, x: 10, y: 20, width: 30, height: 40 }],
    }])).toEqual({
      page: 4,
      highlightBoxes: [{ page: 4, x: 10, y: 20, width: 30, height: 40 }],
    });
  });

  it("falls back to a page and returns nothing without any location", () => {
    expect(sourceEvidenceTarget([], undefined, 7)).toEqual({
      page: 7,
      highlightBoxes: [],
    });
    expect(sourceEvidenceTarget([], undefined)).toBeNull();
  });
});
