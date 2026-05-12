import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildFallbackImessageChatGuid } from "../convex/actions/handleInboundImessage";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("iMessage group chat surfaces", () => {
  it("persists group chats and participants separately from auth users", () => {
    const schema = read("convex/schema.ts");
    const agents = read("AGENTS.md");

    expect(schema).toContain("imessageChats: defineTable");
    expect(schema).toContain("imessageParticipants: defineTable");
    expect(schema).toContain('imessageChatGuid: v.optional(v.string())');
    expect(schema).toContain('role: v.union(v.literal("linked"), v.literal("anonymous"))');
    expect(agents).toContain("do not create auth `users` rows for unlinked group participants");
  });

  it("routes groups by Photon chat GUID and leaves unlinked groups", () => {
    const worker = read("imessage-worker/src/index.ts");
    const inbound = read("convex/actions/handleInboundImessage.ts");
    const http = read("convex/http.ts");

    expect(worker).toContain("activeSpacesByChatGuid");
    expect(worker).toContain("chats?.get(chatGuid)");
    expect(worker).toContain("participantsUnavailable");
    expect(worker).toContain("groups?.leave(result.chatGuid)");
    expect(http).toContain("participants?: Array");
    expect(inbound).toContain("resolveImessageConversationScope");
    expect(inbound).toContain("I couldn't confirm who is in this group chat yet");
    expect(inbound).toContain("scope.kind === \"no_linked_users\"");
    expect(inbound).toContain("leaveGroup: isGroup");
    expect(inbound).toContain("findOrCreateByImessageChat");
  });

  it("keeps group fallback threads separate from direct iMessage DMs", () => {
    const direct = buildFallbackImessageChatGuid({
      fromPhone: "+15551234567",
      isGroup: false,
    });
    const group = buildFallbackImessageChatGuid({
      fromPhone: "+15551234567",
      isGroup: true,
      participants: [
        { address: "+15557654321" },
        { address: "+15551234567" },
      ],
    });
    const sameGroupDifferentOrder = buildFallbackImessageChatGuid({
      fromPhone: "+15551234567",
      isGroup: true,
      participants: [
        { address: "+15551234567" },
        { address: "+15557654321" },
      ],
    });

    expect(direct).toBe("+15551234567");
    expect(group).toMatch(/^group:/);
    expect(group).not.toBe(direct);
    expect(sameGroupDifferentOrder).toBe(group);
  });

  it("does not reuse direct threads for group chat routing", () => {
    const threads = read("convex/threads.ts");

    expect(threads).toContain("existingThreads.find");
    expect(threads).toContain("(thread.imessageIsGroup ?? false) === args.isGroup");
  });

  it("fails closed for mixed-org write actions", () => {
    const inbound = read("convex/actions/handleInboundImessage.ts");

    expect(inbound).toContain("currentSenderIsLinked");
    expect(inbound).toContain("Only a linked Glass user in this group can create a policy change request.");
    expect(inbound).toContain("Only a linked Glass user in this group can save durable notes.");
    expect(inbound).toContain("Only a linked Glass user in this group can generate a certificate.");
    expect(inbound).toContain("Please have a linked user from that policy's organization");
  });
});
