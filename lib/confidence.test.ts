import { describe, expect, it } from "vitest";
import {
  hasConfidenceMarkers,
  parseConfidenceMarkers,
  protectConfidenceMarkersForStreaming,
  remarkConfidence,
  remarkRestoreStreamingConfidenceMarkers,
  stripConfidenceMarkers,
} from "./confidence";

describe("confidence marker compatibility", () => {
  it("parses legacy malformed openers and exposes typed segments", () => {
    expect(parseConfidenceMarkers("Before [[g]:confirmed]] after")).toEqual([
      { type: "text", value: "Before " },
      {
        type: "confidence",
        code: "g",
        level: "grounded",
        value: "confirmed",
      },
      { type: "text", value: " after" },
    ]);
  });

  it("strips markers without closing on double brackets in Markdown", () => {
    const source =
      "[[g:Use `tail]]` and see [array [1, 2]](https://glass.insure)]]";

    expect(stripConfidenceMarkers(source)).toBe(
      "Use `tail]]` and see [array [1, 2]](https://glass.insure)",
    );
  });

  it("strips nested confidence markers while preserving their content", () => {
    expect(stripConfidenceMarkers("[[g:Confirmed [[i:likely]] result]]")).toBe(
      "Confirmed likely result",
    );
  });

  it("leaves unclosed markers literal instead of dropping syntax or text", () => {
    const source = "The model emitted [[u:an unfinished annotation";

    expect(hasConfidenceMarkers(source)).toBe(false);
    expect(stripConfidenceMarkers(source)).toBe(source);
  });

  it("protects complex markers while Markdown streaming parses them", () => {
    const source = "[[g:Use `[[1, 2]]` safely]]";
    const protectedText = protectConfidenceMarkersForStreaming(source);
    const tree = { type: "root", children: [{ type: "text", value: protectedText }] };

    remarkRestoreStreamingConfidenceMarkers()(tree);

    expect(tree.children[0].value).toBe(source);
  });

  it("keeps adjacent inline Markdown nodes inside web confidence spans", () => {
    const tree = {
      type: "root",
      children: [
        { type: "text", value: "[[g:generated " },
        { type: "strong", children: [{ type: "text", value: "Company" }] },
        { type: "text", value: "]] today" },
      ],
    };

    remarkConfidence()(tree);

    expect(tree.children).toMatchObject([
      {
        type: "confidence",
        children: [
          { type: "text", value: "generated " },
          { type: "strong", children: [{ type: "text", value: "Company" }] },
        ],
      },
      { type: "text", value: " today" },
    ]);
  });
});
