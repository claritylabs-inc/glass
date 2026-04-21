import { describe, it, expect } from "vitest";

// Extracted pure logic from rateLimits.ts for unit testing
const BURST_LIMIT = 600;
const SUSTAINED_PER_SEC = 20;

function wouldBeRateLimited(
  count: number,
  msSinceLast: number,
): { limited: boolean; reason?: string } {
  if (msSinceLast < 1000 / SUSTAINED_PER_SEC) {
    return { limited: true, reason: "sustained" };
  }
  if (count >= BURST_LIMIT) {
    return { limited: true, reason: "burst" };
  }
  return { limited: false };
}

describe("rate limit logic", () => {
  it("allows request when count < 600 and spacing >= 50ms", () => {
    expect(wouldBeRateLimited(599, 51)).toEqual({ limited: false });
  });

  it("blocks burst at 600 requests", () => {
    expect(wouldBeRateLimited(600, 100)).toMatchObject({ limited: true, reason: "burst" });
  });

  it("blocks sustained at < 50ms spacing", () => {
    expect(wouldBeRateLimited(1, 10)).toMatchObject({ limited: true, reason: "sustained" });
  });

  it("allows at exactly 50ms spacing", () => {
    expect(wouldBeRateLimited(1, 50)).toEqual({ limited: false });
  });
});
