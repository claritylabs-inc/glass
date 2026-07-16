import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, it, expect } from "vitest";
import {
  hasConfidenceMarkers,
  stripConfidenceMarkers,
  summarizeConfidence,
  remarkConfidence,
  normalizeConfidenceMarkers,
} from "../lib/confidence";
import { stripMarkdown, markdownToHtml } from "../convex/lib/aiUtils";

describe("stripConfidenceMarkers", () => {
  it("unwraps each level to its inner phrase", () => {
    expect(
      stripConfidenceMarkers(
        "[[g:The limit is $2M]] but [[u:landlords want more]].",
      ),
    ).toBe("The limit is $2M but landlords want more.");
  });

  it("leaves text without markers untouched", () => {
    expect(stripConfidenceMarkers("Plain answer.")).toBe("Plain answer.");
  });

  it("ignores an unclosed marker", () => {
    expect(stripConfidenceMarkers("a [[g: dangling")).toBe("a [[g: dangling");
  });

  it("repairs and unwraps the common malformed opener", () => {
    expect(normalizeConfidenceMarkers("[[g]:generated certificate]]")).toBe(
      "[[g:generated certificate]]",
    );
    expect(stripConfidenceMarkers("[[g]:generated certificate]]")).toBe(
      "generated certificate",
    );
  });
});

describe("hasConfidenceMarkers", () => {
  it("detects any supported confidence marker", () => {
    expect(hasConfidenceMarkers("[[i:likely covered]]")).toBe(true);
    expect(hasConfidenceMarkers("[[i]:likely covered]]")).toBe(true);
  });

  it("ignores unmarked text and unsupported marker codes", () => {
    expect(hasConfidenceMarkers("likely covered")).toBe(false);
    expect(hasConfidenceMarkers("[[x:likely covered]]")).toBe(false);
  });
});

describe("plain-text renderers strip markers", () => {
  it("stripMarkdown removes confidence markers", () => {
    expect(stripMarkdown("Coverage is [[g:$1M]] per occurrence.")).toBe(
      "Coverage is $1M per occurrence.",
    );
  });

  it("markdownToHtml removes confidence markers", () => {
    expect(markdownToHtml("Limit [[u:$5,000]] deductible.")).toBe(
      "Limit $5,000 deductible.",
    );
  });

  it("plain-text renderers repair malformed openers before stripping", () => {
    expect(stripMarkdown("[[g]:Generated **Company** certificate.]]")).toBe(
      "Generated Company certificate.",
    );
    expect(markdownToHtml("[[g]:Generated **Company** certificate.]]")).toBe(
      "Generated <strong>Company</strong> certificate.",
    );
  });
});

describe("summarizeConfidence", () => {
  it("returns null when there are no markers", () => {
    expect(summarizeConfidence("No annotations here.")).toBeNull();
  });

  it("counts levels and length-weights the score", () => {
    const summary = summarizeConfidence("[[g:aaaa]] [[u:bbbb]]");
    expect(summary).not.toBeNull();
    expect(summary!.counts).toEqual({
      grounded: 1,
      inferred: 0,
      unverified: 1,
    });
    // Equal-length grounded (weight 1) + unverified (weight 0) → 0.5
    expect(summary!.score).toBeCloseTo(0.5);
  });

  it("scores an all-grounded answer at 1", () => {
    expect(summarizeConfidence("[[g:fully backed]]")!.score).toBe(1);
  });

  it("includes malformed openers in the summary", () => {
    expect(summarizeConfidence("[[g]:fully backed]]")!.counts.grounded).toBe(1);
  });
});

describe("remarkConfidence", () => {
  type Node = {
    type: string;
    value?: string;
    children?: Node[];
    data?: { hName?: string; hProperties?: Record<string, unknown> };
  };

  it("renders inline markdown inside the confidence mark", () => {
    const html = renderToStaticMarkup(
      createElement(
        Markdown,
        { remarkPlugins: [remarkConfidence] },
        "[[g]:generated **Company**]]",
      ),
    );

    expect(html).toContain(
      '<mark class="glass-confidence" data-level="grounded">generated <strong>Company</strong></mark>',
    );
  });

  it("rewrites a marked span into a mark node carrying its level", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Limit is [[u:$2M]] here." }],
        },
      ],
    };
    remarkConfidence()(tree as never);

    const paragraph = tree.children![0];
    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children![0]).toEqual({ type: "text", value: "Limit is " });
    const mark = paragraph.children![1];
    expect(mark.data?.hName).toBe("mark");
    expect(mark.data?.hProperties?.["data-level"]).toBe("unverified");
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
    remarkConfidence()(tree as never);
    expect(tree.children![0].children![0]).toEqual({
      type: "text",
      value: "All good.",
    });
  });

  it("preserves inline markdown nodes inside a marked span", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "[[g:generated " },
            {
              type: "strong",
              children: [{ type: "text", value: "Company" }],
            },
            { type: "text", value: "]] certificate." },
          ],
        },
      ],
    };
    remarkConfidence()(tree as never);

    const paragraph = tree.children![0];
    expect(paragraph.children).toHaveLength(2);
    const mark = paragraph.children![0];
    expect(mark.data?.hProperties?.["data-level"]).toBe("grounded");
    expect(mark.children).toEqual([
      { type: "text", value: "generated " },
      {
        type: "strong",
        children: [{ type: "text", value: "Company" }],
      },
    ]);
    expect(paragraph.children![1]).toEqual({
      type: "text",
      value: " certificate.",
    });
  });

  it("repairs malformed openers around inline markdown nodes", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "[[u]:generated " },
            {
              type: "emphasis",
              children: [{ type: "text", value: "Company" }],
            },
            { type: "text", value: "]]" },
          ],
        },
      ],
    };
    remarkConfidence()(tree as never);

    const mark = tree.children![0].children![0];
    expect(mark.data?.hProperties?.["data-level"]).toBe("unverified");
    expect(mark.children![1].type).toBe("emphasis");
  });
});
