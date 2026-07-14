// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StreamingProseMarkdown } from "../components/prose-markdown";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("chat rendering performance", () => {
  it("renders incomplete streaming markdown with Glass overrides", () => {
    const incompleteHtml = renderToStaticMarkup(
      <StreamingProseMarkdown gfm>
        {"**Streaming reply"}
      </StreamingProseMarkdown>,
    );
    const overrideHtml = renderToStaticMarkup(
      <StreamingProseMarkdown
        gfm
        breaks
        flagConfidence
        components={{
          a: ({ href, children }) => (
            <a data-policy-link={href?.startsWith("/policies/") || undefined}>
              {children}
            </a>
          ),
        }}
      >
        {
          "[[u:Needs **review**]]\n\nLine one\nLine two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Policy](/policies/123)"
        }
      </StreamingProseMarkdown>,
    );

    expect(incompleteHtml).toContain('data-streamdown="strong"');
    expect(incompleteHtml).toContain("Streaming reply");
    expect(overrideHtml).toContain("Unverified:");
    expect(overrideHtml).toContain("Needs ");
    expect(overrideHtml).toContain("review");
    expect(overrideHtml).toContain("<br/>");
    expect(overrideHtml).toContain("overflow-x-auto");
    expect(overrideHtml).toContain("<table");
    expect(overrideHtml).toContain('data-policy-link="true"');
  });

  it("keeps the processing path isolated from settled message rendering", () => {
    const threadContent = read("components/agent-thread/thread-content.tsx");

    expect(threadContent).toContain("useStableMessages(rawMessages)");
    expect(threadContent).toContain("memo(function UnifiedMessageBubble");
    expect(threadContent).toContain('message.status === "processing"');
    expect(threadContent).toContain("<StreamingProseMarkdown");
    expect(threadContent).toContain("<ProseMarkdown");
    expect(threadContent).toContain("useStickToBottom");
    expect(threadContent).toContain("ref={scrollRef}");
    expect(threadContent).toContain("ref={contentRef}");
    expect(threadContent).not.toContain("el.scrollHeight - el.scrollTop");
  });

  it("persists only settled query results off the render path", () => {
    const cachedQuery = read("lib/sync/use-cached-query.ts");

    expect(cachedQuery).toContain("containsProcessingRecord(serverValue)");
    expect(cachedQuery.indexOf("useEffect(() => {")).toBeLessThan(
      cachedQuery.indexOf("const serverValueHash = stableHash(serverValue)"),
    );
    expect(cachedQuery).not.toContain("serverValue === undefined ? undefined : stableHash(serverValue)");
  });

  it("removes unused chat dependencies while retaining adopted primitives", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty("@ai-sdk/react");
    expect(packageJson.dependencies).not.toHaveProperty("@streamdown/cjk");
    expect(packageJson.dependencies).not.toHaveProperty("@streamdown/code");
    expect(packageJson.dependencies).not.toHaveProperty("@streamdown/math");
    expect(packageJson.dependencies).not.toHaveProperty("@streamdown/mermaid");
    expect(packageJson.dependencies).toHaveProperty("streamdown");
    expect(packageJson.dependencies).toHaveProperty("use-stick-to-bottom");
  });
});
