import { describe, expect, it } from "vitest";

import {
  shouldEmitStructuredLiteParseTable,
  type LiteParseTableConfidenceRow,
} from "../extraction-worker/src/liteparseTableConfidence";

function row(
  cells: Array<[string, number]>,
  isHeader = false,
): LiteParseTableConfidenceRow {
  return {
    isHeader,
    text: cells.map(([text]) => text).join(" "),
    cells: cells.map(([text, x]) => ({ text, x, width: Math.max(24, text.length * 5) })),
  };
}

describe("LiteParse table confidence", () => {
  it("keeps clean header-aligned tables structured", () => {
    const rows = [
      row([["Option", 24], ["Length", 296], ["Additional Premium", 460]], true),
      row([["ERP Option 1", 24], ["12 Months", 296], ["100%", 460]]),
      row([["ERP Option 2", 24], ["24 Months", 296], ["175%", 460]]),
      row([["ERP Option 3", 24], ["36 Months", 296], ["225%", 460]]),
      row([["ERP Option 4", 24], ["72 Months", 296], ["350%", 460]]),
    ];

    expect(shouldEmitStructuredLiteParseTable(rows)).toBe(true);
  });

  it("rejects wrapped table runs whose continuation lines do not start on the first column", () => {
    const rows = [
      row([
        ["Coverage Part", 24],
        ["Limit of Liability", 282],
        ["Deductible", 406],
        ["Retroactive Date", 529],
      ], true),
      row([
        ["A. Technology Professional Liability", 24],
        ["$2,000,000 Each Claim", 282],
        ["$10,000", 406],
        ["01/01/2024", 529],
      ]),
      row([["$2,000,000 Policy", 282], ["Each Claim", 406]]),
      row([["Aggregate", 282]]),
      row([
        ["B. Network Security and Privacy Liability", 24],
        ["$1,000,000 Each Claim", 282],
        ["$5,000 Each", 406],
        ["05/01/2025", 529],
      ]),
      row([["Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit)", 24], ["Claim", 282]]),
      row([
        ["C. Regulatory Proceedings Sub-Limit", 24],
        ["$100,000 Each Proceeding", 282],
        ["$5,000 Each", 406],
        ["05/01/2025", 529],
      ]),
    ];

    expect(shouldEmitStructuredLiteParseTable(rows)).toBe(false);
  });

  it("rejects headerless key-value blocks so source display can keep raw LiteParse lines", () => {
    const rows = [
      row([["Annual Premium (all Coverage Parts)", 24], ["$14,475", 258]]),
      row([["Surplus Lines Tax & Stamping Fee (CA)", 24], ["$478.99", 258]]),
      row([["Inspection Fee", 24], ["$250.00", 258]]),
      row([["Total Due", 24], ["$15,203.99", 258]]),
    ];

    expect(shouldEmitStructuredLiteParseTable(rows)).toBe(false);
  });
});
