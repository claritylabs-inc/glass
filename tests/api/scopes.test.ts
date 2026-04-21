import { describe, it, expect } from "vitest";
import { parseScopesFromToken } from "../../convex/lib/apiAuth";

describe("parseScopesFromToken", () => {
  it("null → ['read']", () => expect(parseScopesFromToken(null)).toEqual(["read"]));
  it("[] → ['read']", () => expect(parseScopesFromToken([])).toEqual(["read"]));
  it("['read','write'] → ['read','write']", () => expect(parseScopesFromToken(["read", "write"])).toEqual(["read", "write"]));
  it("['write'] → ['write']", () => expect(parseScopesFromToken(["write"])).toEqual(["write"]));
});
