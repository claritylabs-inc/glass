import { describe, it, expect } from "vitest";
import { parseScopesFromToken, assertScope } from "../../convex/lib/apiAuth";

describe("Auth middleware — scope enforcement", () => {
  it("absent scopes field treated as read-only", () => {
    const scopes = parseScopesFromToken(undefined);
    expect(scopes).toEqual(["read"]);
    expect(() => assertScope(scopes, "write")).toThrow("insufficient_scope");
  });
});
