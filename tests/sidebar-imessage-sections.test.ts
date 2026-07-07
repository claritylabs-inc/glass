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

describe("sidebar iMessage sections", () => {
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

  it("limits normal agent threads and iMessage conversations independently", () => {
    const threads = Array.from({ length: 10 }, (_, index) =>
      thread(`chat-${index}`, { originChannel: "chat" }),
    ).concat(
      Array.from({ length: 10 }, (_, index) =>
        thread(`imessage-${index}`, {
          originChannel: "imessage",
          title: `iMessage - Contact ${index}`,
        }),
      ),
    );

    const { agentConversations, imessageConversations } =
      splitThreadConversations(threads, { agentLimit: 8, imessageLimit: 8 });

    expect(agentConversations).toHaveLength(8);
    expect(imessageConversations).toHaveLength(8);
    expect(agentConversations.every((item) => item.kind !== "imessage")).toBe(true);
    expect(imessageConversations.every((item) => item.kind === "imessage")).toBe(true);
    expect(imessageConversations[0]?.label).toBe("Contact 0");
  });

  it("renders iMessage as its own sidebar section in main and client sidebars", () => {
    const mainSidebar = read("components/app-sidebar/main-sidebar-content.tsx");
    const clientSidebar = read("components/app-sidebar/client-detail-sidebar-content.tsx");
    const threadContent = read("components/agent-thread/thread-content.tsx");

    expect(mainSidebar).toContain("agentConversations");
    expect(mainSidebar).toContain("imessageConversations");
    expect(mainSidebar).toContain("iMessage");
    expect(clientSidebar).toContain("imessageConversations");
    expect(clientSidebar).toContain("iMessage");
    expect(threadContent).toContain("getThreadDisplayLabel(thread)");
  });
});
