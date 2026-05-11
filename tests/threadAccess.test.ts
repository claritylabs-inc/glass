import { describe, it, expect } from "vitest";
import { evaluateThreadAccess } from "../convex/lib/threadAccess";
import type { Id } from "../convex/_generated/dataModel";

describe("evaluateThreadAccess", () => {
  const broker = "org_broker" as Id<"organizations">;
  const client = "org_client" as Id<"organizations">;
  const other = "org_other" as Id<"organizations">;

  it("allows thread owner", () => {
    expect(evaluateThreadAccess({ userOrgId: client, thread: { orgId: client }, clientOrg: { _id: client, brokerOrgId: broker } })).toBe("allow");
  });
  it("allows broker of the client org", () => {
    expect(evaluateThreadAccess({ userOrgId: broker, thread: { orgId: client }, clientOrg: { _id: client, brokerOrgId: broker } })).toBe("allow");
  });
  it("denies unrelated org", () => {
    expect(evaluateThreadAccess({ userOrgId: other, thread: { orgId: client }, clientOrg: { _id: client, brokerOrgId: broker } })).toBe("deny");
  });
  it("denies when thread's org has no broker and user is not owner", () => {
    expect(evaluateThreadAccess({ userOrgId: other, thread: { orgId: client }, clientOrg: { _id: client } })).toBe("deny");
  });
});
