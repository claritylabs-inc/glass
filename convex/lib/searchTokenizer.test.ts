import { describe, expect, test } from "vitest";
import {
  normalizedSearchText,
  searchTextIncludes,
  tokenizeSearchText,
  uniqueSearchTerms,
} from "./searchTokenizer";

describe("search tokenizer", () => {
  test("normalizes compatibility forms and punctuation consistently", () => {
    expect(normalizedSearchText("Ｃａｆé—Policy #１２３")).toBe(
      "café policy 123",
    );
    expect(searchTextIncludes("Northwoods, Continental", "Northwoods Continental"))
      .toBe(true);
    expect(searchTextIncludes("SPS-TPC-2026", "SPS TPC 2026")).toBe(true);
  });

  test("retains accented and non-Latin terms", () => {
    expect(tokenizeSearchText("São Paulo 保険 東京 险", { minimumLength: 3 })).toEqual([
      "são",
      "paulo",
      "保険",
      "東京",
      "险",
    ]);
  });

  test("deduplicates canonically equivalent terms", () => {
    expect(uniqueSearchTerms("CAFÉ café", { minimumLength: 2 })).toEqual([
      "café",
    ]);
  });
});
