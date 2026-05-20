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

  it("can create outbound group chats through the worker and shared agent tool", () => {
    const worker = read("imessage-worker/src/index.ts");
    const action = read("convex/actions/createOutboundImessageGroup.ts");
    const tools = read("convex/lib/chatTools.ts");
    const chat = read("convex/actions/processThreadChat.ts");

    expect(worker).toContain("payload.participants");
    expect(worker).toContain("chats.create(participants");
    expect(worker).toContain("deterministicTerminalGroupGuid");
    expect(action).toContain("createOutboundImessageGroupInternal");
    expect(action).toContain("internal.imessageChats.syncChat");
    expect(action).toContain("internal.threads.findOrCreateByImessageChat");
    expect(tools).toContain("createImessageGroupChat");
    expect(tools).toContain("confirmed");
    expect(chat).toContain("create_imessage_group_chat");
    expect(chat).toContain("Ask the user to confirm before creating");
  });

  it("mirrors web chat additions back to iMessage-origin threads", () => {
    const threads = read("convex/threads.ts");
    const mirror = read("convex/actions/mirrorWebChatToImessage.ts");
    const outbound = read("convex/lib/imessageOutbound.ts");
    const chat = read("convex/actions/processThreadChat.ts");
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const worker = read("imessage-worker/src/index.ts");
    const agents = read("AGENTS.md");

    expect(threads).toContain("internal.actions.mirrorWebChatToImessage.run");
    expect(mirror).toContain('message.role !== "user" || message.channel !== "chat"');
    expect(outbound).toContain("formatWebChatUserMirrorText");
    expect(outbound).toContain("sendIdempotentOutboundImessage");
    expect(outbound).toContain("internal.imessageOutboundSends.claim");
    expect(chat).toContain("formatWebChatAgentMirrorText");
    expect(chat).toContain("storedAttachmentsToImessageOutbound");
    expect(threadContent).toContain("hasEarlierIdenticalAgentMessage");
    expect(threadContent).toContain("mirroredToImessage");
    expect(worker).toContain("claimSendIdempotencyKey");
    expect(worker).toContain("payload.attachments");
    expect(worker).toContain("sendOutboundAttachments");
    expect(worker).toContain("sendByChatGuid");
    expect(agents).toContain("mirrors the web user message and Glass reply back");
  });

  it("waits for policy-aware empty state context before rendering suggestions", () => {
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const emptyState = read("components/new-chat-empty-state.tsx");

    expect(threadContent).toContain("messages && messages.length === 0");
    expect(emptyState).toContain("isLoadingContext");
    expect(emptyState).toContain("return null");
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
