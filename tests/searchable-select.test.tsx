// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SearchableSelect } from "@/components/ui/searchable-select";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("SearchableSelect", () => {
  test("clears its query when dependent options change", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <SearchableSelect
          options={[{ value: "alpha", label: "Alpha" }]}
          value=""
          onChange={vi.fn()}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Search..."]',
    );
    expect(input).not.toBeNull();

    await act(async () => {
      if (!input) return;
      input.value = "alp";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(input?.value).toBe("alp");

    await act(async () => {
      root?.render(
        <SearchableSelect
          options={[{ value: "beta", label: "Beta" }]}
          value=""
          onChange={vi.fn()}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(
      document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search..."]',
      )?.value,
    ).toBe("");
  });
});
