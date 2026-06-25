import { describe, expect, it } from "vitest";

import {
  classifyLiteParseTextElement,
  type LiteParseTextClassificationRow,
} from "../extraction-worker/src/liteparseTextClassification";

function row(text: string, y: number, width = 503, x = 54.1, height = 12): LiteParseTextClassificationRow {
  return { text, bbox: { x, y, width, height } };
}

describe("LiteParse text classification", () => {
  it("keeps wrapped all-caps declaration notices as paragraphs", () => {
    const rows = [
      row("DECLARATIONS", 51.42, 119, 246.55, 17),
      row("TECHNOLOGY PROFESSIONAL AND CYBER LIABILITY INSURANCE POLICY", 75.94, 440, 85.75, 13),
      row("THIS IS A CLAIMS MADE AND REPORTED POLICY WITH DEFENSE COSTS INCLUDED WITHIN", 113.29),
      row("THE LIMITS OF LIABILITY. EXCEPT TO THE EXTENT OTHERWISE PROVIDED, THIS POLICY", 127.09),
      row("ONLY AFFORDS COVERAGE FOR CLAIMS FIRST MADE AGAINST THE INSURED AND", 140.89),
      row("REPORTED IN WRITING TO THE INSURER DURING THE POLICY PERIOD OR ANY APPLICABLE", 154.7),
      row("EXTENDED REPORTING PERIOD. PLEASE READ THE ENTIRE POLICY CAREFULLY.", 168.49, 443),
    ];

    expect(classifyLiteParseTextElement(rows[0], rows)).toBe("title");
    expect(classifyLiteParseTextElement(rows[1], rows)).toBe("title");
    for (const noticeLine of rows.slice(2)) {
      expect(classifyLiteParseTextElement(noticeLine, rows)).toBe("paragraph");
    }
  });

  it("keeps real section headings as titles", () => {
    const rows = [
      row("SECTION I - INSURING AGREEMENTS", 90, 250, 181),
      row("The insurer will pay loss on behalf of the insured.", 112, 320, 54),
    ];

    expect(classifyLiteParseTextElement(rows[0], rows)).toBe("title");
    expect(classifyLiteParseTextElement(rows[1], rows)).toBe("paragraph");
  });
});
