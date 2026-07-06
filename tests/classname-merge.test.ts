import { describe, expect, it } from "vitest";

import { cn } from "../lib/utils";

describe("cn", () => {
  it("preserves Glass text size tokens when merging text colors", () => {
    expect(cn("text-tag text-foreground/70")).toBe(
      "text-tag text-foreground/70",
    );
    expect(cn("text-label text-muted-foreground/45")).toBe(
      "text-label text-muted-foreground/45",
    );
  });

  it("still merges competing Glass text size tokens and competing text colors", () => {
    expect(cn("text-tag text-label text-foreground/70 text-muted-foreground")).toBe(
      "text-label text-muted-foreground",
    );
  });
});
