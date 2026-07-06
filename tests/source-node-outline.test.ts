import { describe, expect, it } from "vitest";

import { shapeDirectContentOutlineChildren } from "../convex/sourceNodes";

type TestOutlineNode = Parameters<typeof shapeDirectContentOutlineChildren>[0];

function node(
  kind: string,
  nodeId: string,
  order: number,
  title = kind,
): TestOutlineNode {
  return {
    kind,
    nodeId,
    title,
    description: title,
    textExcerpt: undefined,
    order,
  };
}

describe("source node outline shaping", () => {
  it("allows page groups to expose direct content when pages have no semantic headings", () => {
    const declarations = node("page_group", "declarations", 0, "Declarations");
    const page = node("page", "page-5", 1, "Page 5");
    const notice = node("text", "notice-line", 2, "THIS IS A CLAIMS MADE NOTICE");
    const table = node("table", "coverage-table", 3, "Coverage table");

    const children = shapeDirectContentOutlineChildren(
      declarations,
      [page],
      new Map([["page-5", [notice, table]]]),
    );

    expect(children?.map((child) => child.nodeId)).toEqual([
      "notice-line",
      "coverage-table",
    ]);
  });

  it("keeps page structure when real semantic children exist", () => {
    const declarations = node("page_group", "declarations", 0, "Declarations");
    const page = node("page", "page-5", 1, "Page 5");
    const section = node("section", "section-1", 2, "Item 1. Named Insured");
    const notice = node("text", "notice-line", 3, "Named insured content");

    const children = shapeDirectContentOutlineChildren(
      declarations,
      [page],
      new Map([["page-5", [section, notice]]]),
    );

    expect(children).toBeUndefined();
  });

  it("flattens generic policy-title wrappers inside declarations", () => {
    const declarations = node("page_group", "declarations", 0, "Declarations");
    const page = node("page", "page-5", 1, "Declarations");
    const wrapper = node(
      "section",
      "policy-title",
      2,
      "TECHNOLOGY PROFESSIONAL AND CYBER LIABILITY INSURANCE POLICY",
    );
    const notice = node("text", "claims-made-notice", 3, "THIS IS A CLAIMS MADE NOTICE");
    const table = node("table", "declarations-table", 4, "Table 2");

    const children = shapeDirectContentOutlineChildren(
      declarations,
      [page, wrapper],
      new Map([["policy-title", [notice, table]]]),
    );

    expect(children?.map((child) => child.nodeId)).toEqual([
      "claims-made-notice",
      "declarations-table",
    ]);
  });

  it("preserves the notices and jacket page filtering path", () => {
    const notices = node("page_group", "notices", 0, "Notices and Jacket");
    const page = node("page", "page-1", 1, "Page 1");
    const signature = node("text", "signature-line", 2, "Corporate secretary");

    const children = shapeDirectContentOutlineChildren(
      notices,
      [page],
      new Map([["page-1", [signature]]]),
    );

    expect(children).toBeUndefined();
  });
});
