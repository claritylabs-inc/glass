import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getThreadDisplayLabel,
  isImessageThread,
  splitThreadConversations,
  type ThreadDisplayLike,
} from "../lib/thread-display";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function thread(
  id: string,
  partial: Partial<ThreadDisplayLike>,
): ThreadDisplayLike {
  return {
    _id: id,
    _creationTime: 1000,
    title: `Thread ${id}`,
    lastMessageAt: 1000,
    ...partial,
  };
}

describe("sidebar source conversations", () => {
  it("detects iMessage threads from explicit channel, phone, or legacy title", () => {
    expect(isImessageThread(thread("channel", { originChannel: "imessage" }))).toBe(true);
    expect(isImessageThread(thread("phone", { threadPhone: "+15551234567" }))).toBe(true);
    expect(isImessageThread(thread("title", { title: "iMessage - Terry Wang" }))).toBe(true);
    expect(isImessageThread(thread("group", { title: "iMessage group - Terry, Alice" }))).toBe(true);
    expect(isImessageThread(thread("chat", { originChannel: "chat" }))).toBe(false);
  });

  it("removes channel prefixes from iMessage display labels only", () => {
    expect(getThreadDisplayLabel(thread("direct", { title: "iMessage - Terry Wang" }))).toBe("Terry Wang");
    expect(getThreadDisplayLabel(thread("group", { title: "iMessage group - Terry, Alice" }))).toBe("Terry, Alice");
    expect(getThreadDisplayLabel(thread("phone", { title: "iMessage - ", threadPhone: "+15551234567" }))).toBe("+15551234567");
    expect(getThreadDisplayLabel(thread("chat", { title: "Renewal follow-up" }))).toBe("Renewal follow-up");
  });

  it("pins Slack and iMessage conversations while limiting each source independently", () => {
    const threads = Array.from({ length: 10 }, (_, index) =>
      thread(`chat-${index}`, { originChannel: "chat" }),
    ).concat(
      Array.from({ length: 10 }, (_, index) =>
        thread(`imessage-${index}`, {
          originChannel: "imessage",
          title: `iMessage - Contact ${index}`,
        }),
      ),
      Array.from({ length: 10 }, (_, index) =>
        thread(`slack-${index}`, {
          originChannel: "slack",
          title: index % 2 === 0 ? `DM · Contact ${index}` : `#glass-cove · Contact ${index}`,
          slackConversationKind:
            index % 2 === 0 ? "direct_message" : "channel",
          visibility: index % 2 === 0 ? "user_private" : undefined,
        }),
      ),
    );

    const { agentConversations, pinnedConversations } =
      splitThreadConversations(threads, {
        agentLimit: 8,
        imessageLimit: 8,
        slackLimit: 8,
      });

    expect(agentConversations).toHaveLength(8);
    expect(pinnedConversations).toHaveLength(16);
    expect(agentConversations.every((item) => item.kind === "chat")).toBe(true);
    expect(pinnedConversations.filter((item) => item.kind === "imessage")).toHaveLength(8);
    expect(pinnedConversations.filter((item) => item.kind === "slack")).toHaveLength(8);
    expect(pinnedConversations[0]?.label).toBe("Contact 0");
    expect(
      pinnedConversations.find((item) => item.id === "slack-0"),
    ).toMatchObject({
      kind: "slack",
      slackConversationKind: "direct_message",
      isPrivate: true,
    });
  });

  it("renders Slack and iMessage threads as pinned rows above agent threads", () => {
    const mainSidebar = read("components/app-sidebar/main-sidebar-content.tsx");
    const clientSidebar = read("components/app-sidebar/client-detail-sidebar-content.tsx");
    const threadContent = read("components/agent-thread/thread-content.tsx");

    expect(mainSidebar).toContain("agentConversations");
    expect(mainSidebar).toContain("pinnedConversations");
    expect(mainSidebar).toContain('shortcutLabel="pinned thread"');
    expect(mainSidebar).toContain("<Pin");
    expect(mainSidebar).toContain("<SiSlack");
    expect(mainSidebar).toContain('href="/agent/threads"');
    expect(mainSidebar).toContain("Private Slack thread");
    expect(mainSidebar.indexOf("pinnedConversations.map")).toBeLessThan(
      mainSidebar.indexOf("agentConversations.map"),
    );
    expect(clientSidebar).toContain("pinnedConversations");
    expect(clientSidebar).toContain("<Pin");
    expect(clientSidebar).toContain("<SiSlack");
    expect(clientSidebar.indexOf("pinnedConversations.map")).toBeLessThan(
      clientSidebar.indexOf("agentConversations.map"),
    );
    expect(threadContent).toContain("getThreadDisplayLabel(thread)");
    expect(threadContent).toContain("Only you can see this thread in Glass");
    expect(threadContent).toContain("Not delivered to Slack");
  });
});
