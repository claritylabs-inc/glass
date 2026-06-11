import { describe, it, expect } from "vitest";
import {
  stripUncertaintyMarkers,
  remarkUncertainty,
} from "../lib/uncertainty";
import { stripMarkdown, markdownToHtml } from "../convex/lib/aiUtils";

describe("stripUncertaintyMarkers", () => {
  it("unwraps markers to their inner text", () => {
    expect(
      stripUncertaintyMarkers("The limit is [?$2M?], confirm it."),
    ).toBe("The limit is $2M, confirm it.");
  });

  it("handles multiple markers", () => {
    expect(
      stripUncertaintyMarkers("[?Acme Co?] holds policy [?ABC-123?]."),
    ).toBe("Acme Co holds policy ABC-123.");
  });

  it("leaves text without markers untouched", () => {
    expect(stripUncertaintyMarkers("Plain answer.")).toBe("Plain answer.");
  });

  it("does not match an unclosed marker", () => {
    expect(stripUncertaintyMarkers("a [? dangling")).toBe("a [? dangling");
  });
});

describe("plain-text renderers strip markers", () => {
  it("stripMarkdown removes confidence markers", () => {
    expect(stripMarkdown("Coverage is [?$1M?] per occurrence.")).toBe(
      "Coverage is $1M per occurrence.",
    );
  });

  it("markdownToHtml removes confidence markers", () => {
    expect(markdownToHtml("Limit [?$5,000?] deductible.")).toBe(
      "Limit $5,000 deductible.",
    );
  });
});

describe("remarkUncertainty", () => {
  type Node = {
    type: string;
    value?: string;
    children?: Node[];
    data?: { hName?: string; hProperties?: Record<string, unknown> };
  };

  it("rewrites a marked span into a mark node", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Limit is [?$2M?] here." }],
        },
      ],
    };
    remarkUncertainty()(tree as never);

    const paragraph = tree.children![0];
    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children![0]).toEqual({ type: "text", value: "Limit is " });
    const mark = paragraph.children![1];
    expect(mark.data?.hName).toBe("mark");
    expect(mark.data?.hProperties?.className).toBe("glass-uncertain");
    expect(mark.children![0]).toEqual({ type: "text", value: "$2M" });
    expect(paragraph.children![2]).toEqual({ type: "text", value: " here." });
  });

  it("leaves unmarked text untouched", () => {
    const tree: Node = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "All good." }] },
      ],
    };
    remarkUncertainty()(tree as never);
    expect(tree.children![0].children![0]).toEqual({
      type: "text",
      value: "All good.",
    });
  });
});
