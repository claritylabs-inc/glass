// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | null = null;

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
});

describe("DropdownMenu group labels", () => {
  it("opens a grouped address label without losing Base UI context", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button">Receivables Team</button>} />
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>receivables@example.com</DropdownMenuLabel>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(document.body.textContent).toContain("receivables@example.com");
  });
});
