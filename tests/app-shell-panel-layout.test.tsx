// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { AppShellPanelLayout } from "@/components/app-shell-panel-layout";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];

async function renderLayout({
  entityPanel,
  pdfPanel,
  rightPanel,
}: {
  entityPanel?: ReactNode;
  pdfPanel?: ReactNode;
  rightPanel?: ReactNode;
}) {
  const container = document.createElement("div");
  container.style.height = "800px";
  container.style.width = "1200px";
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(
      <AppShellPanelLayout
        main={<div>Main</div>}
        entityPanel={entityPanel}
        rightPanel={rightPanel}
        pdfPanel={pdfPanel}
      />,
    );
    await Promise.resolve();
  });

  return container;
}

function panelIds(container: ParentNode) {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-panel]"),
  ).map((panel) => panel.dataset.testid);
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

describe("AppShellPanelLayout", () => {
  it.each([
    {
      expectedIds: ["app-shell-main", "app-shell-right"],
      panels: { rightPanel: <div>Details</div> },
    },
    {
      expectedIds: ["app-shell-main", "app-shell-entity", "app-shell-right"],
      panels: {
        entityPanel: <div>Policy</div>,
        rightPanel: <div>Details</div>,
      },
    },
    {
      expectedIds: [
        "app-shell-main",
        "app-shell-entity",
        "app-shell-right",
        "app-shell-pdf",
      ],
      panels: {
        entityPanel: <div>Policy</div>,
        rightPanel: <div>Details</div>,
        pdfPanel: <div>PDF</div>,
      },
    },
  ])(
    "renders one, two, or three ordered auxiliary panels",
    async ({ expectedIds, panels }) => {
      const container = await renderLayout(panels);

      expect(panelIds(container)).toEqual(expectedIds);
      expect(container.querySelectorAll("[data-separator]")).toHaveLength(
        expectedIds.length - 1,
      );
    },
  );

  it("exposes the keyboard-accessible separator contract", async () => {
    const container = await renderLayout({
      rightPanel: <div>Details</div>,
    });
    const separator = container.querySelector<HTMLElement>(
      '[data-testid="app-shell-separator-right"]',
    );

    expect(separator).not.toBeNull();
    expect(separator?.getAttribute("role")).toBe("separator");
    expect(separator?.getAttribute("aria-label")).toBe("Resize detail panel");
    expect(separator?.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator?.tabIndex).toBe(0);
    expect(
      Array.from(
        container.querySelector<HTMLElement>("[data-group]")?.children ?? [],
      ).map((element) => element.getAttribute("data-testid")),
    ).toEqual([
      "app-shell-main",
      "app-shell-separator-right",
      "app-shell-right",
    ]);
  });
});
