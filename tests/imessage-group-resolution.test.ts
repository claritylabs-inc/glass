import { describe, expect, it } from "vitest";
import {
  anonymousParticipantLabel,
  buildImessageGroupMemberTitle,
  normalizeImessageAddress,
  resolveImessageConversationScope,
} from "../convex/lib/imessageGroupResolution";

const orgA = "org_a" as never;
const orgB = "org_b" as never;
const userA = "user_a" as never;
const userB = "user_b" as never;

describe("iMessage group resolution", () => {
  it("normalizes phones and emails consistently", () => {
    expect(normalizeImessageAddress("(555) 123-4567")).toBe("+5551234567");
    expect(normalizeImessageAddress("ALICE@EXAMPLE.COM")).toBe("alice@example.com");
  });

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

  it("keeps same-org linked participants in a single-org scope", () => {
    const scope = resolveImessageConversationScope({
      senderAddress: "+15550101",
      participants: [
        { address: "+15550100", userId: userA, orgId: orgA, role: "linked" },
        { address: "+15550101", userId: userB, orgId: orgA, role: "linked" },
      ],
    });

    expect(scope.kind).toBe("single_org");
    expect(scope.orgIds).toEqual([orgA]);
    expect(scope.primaryUserId).toBe(userB);
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

  it("creates stable anonymous labels without pretending guests are users", () => {
    expect(anonymousParticipantLabel("+15550123456", 2)).toBe("Guest 2 (3456)");
  });

  it("builds concise group titles from participant first names", () => {
    expect(buildImessageGroupMemberTitle([
      { address: "+15550100", userName: "Terry Wang" },
      { address: "+15550101", displayName: "Alice Smith" },
      { address: "+15550102" },
    ])).toBe("Terry, Alice, Guest 3 (0102)");
  });
});
