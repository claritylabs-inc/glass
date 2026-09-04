import { describe, expect, it } from "vitest";
import { resolveImessageConversationScope } from "../convex/lib/imessageGroupResolution";

const orgA = "org_a" as never;
const orgB = "org_b" as never;
const userA = "user_a" as never;
const userB = "user_b" as never;

describe("iMessage group resolution", () => {
  it("requires at least one linked participant", () => {
    const scope = resolveImessageConversationScope({
      senderAddress: "+15550100",
      participants: [
        { address: "+15550100", role: "anonymous" },
        { address: "+15550101", role: "anonymous" },
      ],
    });

    expect(scope.kind).toBe("no_linked_users");
    expect(scope.orgIds).toEqual([]);
  });

  it("routes one linked participant plus guests to that user's org", () => {
    const scope = resolveImessageConversationScope({
      senderAddress: "+15550101",
      participants: [
        { address: "+15550100", userId: userA, orgId: orgA, role: "linked" },
        { address: "+15550101", role: "anonymous" },
      ],
    });

    expect(scope.kind).toBe("single_org");
    expect(scope.primaryOrgId).toBe(orgA);
    expect(scope.primaryUserId).toBe(userA);
    expect(scope.anonymousParticipants).toHaveLength(1);
  });

  it("preserves multiple linked orgs and anchors actions to the sender org", () => {
    const scope = resolveImessageConversationScope({
      senderAddress: "+15550101",
      participants: [
        { address: "+15550100", userId: userA, orgId: orgA, role: "linked" },
        { address: "+15550101", userId: userB, orgId: orgB, role: "linked" },
      ],
    });

    expect(scope.kind).toBe("multi_org");
    expect(scope.orgIds).toEqual([orgA, orgB]);
    expect(scope.primaryOrgId).toBe(orgB);
    expect(scope.primaryUserId).toBe(userB);
  });
});
