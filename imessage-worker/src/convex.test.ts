import { describe, expect, it } from "vitest";

import { imessageConvexPaths } from "./convex.js";

describe("imessageConvexPaths", () => {
  it("keeps customer traffic on the existing endpoints", () => {
    expect(imessageConvexPaths("customer")).toEqual({
      inbound: "/imessage-inbound",
      deliveryEvents: "/imessage-delivery-events",
    });
  });

  it("isolates operator traffic on operator-only endpoints", () => {
    expect(imessageConvexPaths("operator")).toEqual({
      inbound: "/operator-imessage-inbound",
      deliveryEvents: "/operator-imessage-delivery-events",
    });
  });
});
