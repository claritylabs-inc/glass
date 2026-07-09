import { describe, it, expect } from "vitest";
import { evaluateThreadAccess } from "../convex/lib/threadAccess";
import type { Id } from "../convex/_generated/dataModel";

describe("evaluateThreadAccess", () => {
  const broker = "org_broker" as Id<"organizations">;
  const client = "org_client" as Id<"organizations">;
  const other = "org_other" as Id<"organizations">;
  const owner = "user_owner" as Id<"users">;
  const teammate = "user_teammate" as Id<"users">;
  const thread = { orgId: client, createdBy: owner };
  const clientOrg = { _id: client, brokerOrgId: broker };

  it("allows thread owner", () => {
    expect(
      evaluateThreadAccess({
        userId: owner,
        userOrgId: client,
        thread,
        clientOrg,
      }),
    ).toBe("allow");
  });
  it("allows broker of the client org", () => {
    expect(
      evaluateThreadAccess({
        userId: teammate,
        userOrgId: broker,
        thread,
        clientOrg,
      }),
    ).toBe("allow");
  });
  it("denies unrelated org", () => {
    expect(
      evaluateThreadAccess({
        userId: teammate,
        userOrgId: other,
        thread,
        clientOrg,
      }),
    ).toBe("deny");
  });
  it("denies when thread's org has no broker and user is not owner", () => {
    expect(
      evaluateThreadAccess({
        userId: teammate,
        userOrgId: other,
        thread,
        clientOrg: { _id: client },
      }),
    ).toBe("deny");
  });
  it("allows only the creator to read a user-private thread", () => {
    const privateThread = { ...thread, visibility: "user_private" as const };
    expect(
      evaluateThreadAccess({
        userId: owner,
        userOrgId: client,
        thread: privateThread,
        clientOrg,
      }),
    ).toBe("allow");
    expect(
      evaluateThreadAccess({
        userId: teammate,
        userOrgId: client,
        thread: privateThread,
        clientOrg,
      }),
    ).toBe("deny");
    expect(
      evaluateThreadAccess({
        userId: teammate,
        userOrgId: broker,
        thread: privateThread,
        clientOrg,
      }),
    ).toBe("deny");
  });
  it("keeps client-internal threads hidden from brokers", () => {
    expect(
      evaluateThreadAccess({
        userId: teammate,
        userOrgId: broker,
        thread: { ...thread, visibility: "client_internal" },
        clientOrg,
      }),
    ).toBe("deny");
  });
});
