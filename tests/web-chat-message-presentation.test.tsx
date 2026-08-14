import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentThinkingBubble,
  WebMessageReceipt,
  latestOwnWebMessageReceipt,
} from "@/components/agent-thread/thread-content";
import { ThreadMessageBubble } from "@/components/agent-thread/message-bubble";
import type { ThreadMessage } from "@/components/agent-thread/types";
import type { Id } from "@/convex/_generated/dataModel";

const threadId = "thread-1" as Id<"threads">;
const orgId = "org-1" as Id<"organizations">;
const viewerId = "user-1" as Id<"users">;

function message(
  id: string,
  overrides: Partial<ThreadMessage> = {},
): ThreadMessage {
  return {
    _id: id as Id<"threadMessages">,
    _creationTime: 1,
    threadId,
    orgId,
    channel: "chat",
    role: "user",
    userId: viewerId,
    content: "Can you check this policy?",
    ...overrides,
  };
}

describe("web chat message receipts", () => {
  it("renders a completed agent reply directly on the thread canvas", () => {
    const html = renderToStaticMarkup(
      <ThreadMessageBubble role="agent" channel="chat">
        I checked it.
      </ThreadMessageBubble>,
    );

    expect(html).toContain("text-foreground");
    expect(html).not.toContain("rounded-lg");
    expect(html).not.toContain("bg-foreground/[0.03]");
    expect(html).toContain("I checked it.");
  });

  it("renders a compact accessible thinking bubble without activity copy", () => {
    const html = renderToStaticMarkup(<AgentThinkingBubble />);

    expect(html).toContain('aria-label="Glass is thinking"');
    expect(html.match(/animate-pulse/g)).toHaveLength(3);
    expect(html).not.toContain("Searching policies");
  });

  it("renders explicit delivered and read receipt states", () => {
    const delivered = renderToStaticMarkup(
      <WebMessageReceipt status="delivered" />,
    );
    const read = renderToStaticMarkup(<WebMessageReceipt status="read" />);

    expect(delivered).toContain('aria-label="Delivered to Glass"');
    expect(delivered).toContain("Delivered");
    expect(read).toContain('aria-label="Read by Glass"');
    expect(read).toContain("Read");
  });

  it("keeps receipts hidden until an optimistic message reaches the backend", () => {
    const user = message("thread-1:local:mutation-1");
    const processing = message("thread-1:local:mutation-1:agent", {
      role: "agent",
      status: "processing",
      content: "",
      replyToMessageId: user._id,
    });

    expect(latestOwnWebMessageReceipt([user, processing], viewerId)).toBeNull();
  });

  it("moves from delivered to read only when the linked run starts", () => {
    const user = message("message-1");
    const processing = message("message-2", {
      role: "agent",
      status: "processing",
      content: "",
      replyToMessageId: user._id,
    });

    expect(latestOwnWebMessageReceipt([user, processing], viewerId)?.status).toBe(
      "delivered",
    );
    expect(
      latestOwnWebMessageReceipt(
        [user, { ...processing, agentRunStartedAt: 10 }],
        viewerId,
      )?.status,
    ).toBe("read");
  });

  it("shows only the latest viewer-authored web message receipt", () => {
    const first = message("message-1");
    const incoming = message("message-2", {
      userId: "user-2" as Id<"users">,
      content: "A teammate reply",
    });
    const latest = message("message-3", { _creationTime: 3 });
    const reply = message("message-4", {
      _creationTime: 4,
      role: "agent",
      status: undefined,
      content: "I checked it.",
      replyToMessageId: latest._id,
    });

    expect(
      latestOwnWebMessageReceipt([first, incoming, latest, reply], viewerId),
    ).toEqual({ messageId: latest._id, status: "read" });
  });
});
