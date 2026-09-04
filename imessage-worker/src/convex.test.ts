import { describe, expect, it } from "vitest";

import { imessageConvexPaths } from "./convex.js";

describe("imessageConvexPaths", () => {
  it("isolates operator traffic on operator-only endpoints", () => {
    expect(imessageConvexPaths("operator")).toEqual({
      inbound: "/operator-imessage-inbound",
      deliveryEvents: "/operator-imessage-delivery-events",
    });
  });
});
