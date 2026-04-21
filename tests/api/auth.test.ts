import { describe, it, expect } from "vitest";
import { parseScopesFromToken, assertScope } from "../../convex/lib/apiAuth";
import { buildApiAuthError } from "../../convex/lib/apiError";

describe("Auth middleware — scope enforcement", () => {
  it("read-scope token fails write-required operation", () => {
    expect(() => assertScope(["read"], "write")).toThrow("insufficient_scope");
  });

  it("write-scope token passes write-required operation", () => {
    expect(() => assertScope(["read", "write"], "write")).not.toThrow();
  });

  it("absent scopes field treated as read-only", () => {
    const scopes = parseScopesFromToken(undefined);
    expect(scopes).toEqual(["read"]);
    expect(() => assertScope(scopes, "write")).toThrow("insufficient_scope");
  });

  it("buildApiAuthError returns 403 for insufficient_scope", () => {
    const res = buildApiAuthError("insufficient_scope", "Need write scope", "req_x");
    expect(res.status).toBe(403);
  });

  it("buildApiAuthError returns 401 for unauthorized", () => {
    const res = buildApiAuthError("unauthorized", "No token", "req_y");
    expect(res.status).toBe(401);
  });
});
