// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AutoSaveStatus,
  AutoSaveStatusProvider,
  SLOW_SAVE_DELAY_MS,
  combineAutoSaveStatuses,
} from "@/components/ui/auto-save-status";
import type { AutoSaveStatus as AutoSaveStatusValue } from "@/lib/sync/use-local-first-auto-save";

let mountedRoot: Root | null = null;

async function renderStatuses(statuses: AutoSaveStatusValue[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;

  async function render(nextStatuses: AutoSaveStatusValue[]) {
    await act(async () => {
      root.render(
        <AutoSaveStatusProvider>
          {nextStatuses.map((status, index) => (
            <AutoSaveStatus key={index} status={status} />
          ))}
        </AutoSaveStatusProvider>,
      );
    });
  }

  await render(statuses);

  return {
    container,
    render,
    async unmount() {
      await act(async () => root.unmount());
      if (mountedRoot === root) mountedRoot = null;
      container.remove();
    },
  };
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("AutoSaveStatusProvider", () => {
  it("keeps expected saved state out of the interface", async () => {
    const harness = await renderStatuses(["saved"]);

    expect(harness.container.querySelector("[data-status]")).toBeNull();
    expect(harness.container.textContent).toBe("");

    await harness.unmount();
  });

  it("shows saving only when it remains pending for three seconds", async () => {
    vi.useFakeTimers();
    const harness = await renderStatuses(["saving"]);

    expect(harness.container.querySelector("[data-status]")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_SAVE_DELAY_MS - 1);
    });
    expect(harness.container.querySelector("[data-status]")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      harness.container.querySelector('[data-status="saving"]')?.textContent,
    ).toContain("Still saving");

    await harness.unmount();
  });

  it("does not flash feedback when a normal save completes", async () => {
    vi.useFakeTimers();
    const harness = await renderStatuses(["saving"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_SAVE_DELAY_MS - 1);
    });
    await harness.render(["saved"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_SAVE_DELAY_MS);
    });

    expect(harness.container.querySelector("[data-status]")).toBeNull();

    await harness.unmount();
  });

  it("shows unsafe changes immediately and prioritizes them over saving", async () => {
    const harness = await renderStatuses(["saving", "unsaved"]);

    const warning = harness.container.querySelector(
      '[data-status="unsaved"]',
    );
    expect(warning?.textContent).toContain("Unsaved changes");
    expect(warning?.textContent).toContain("before leaving");

    await harness.render(["saving", "error"]);
    const error = harness.container.querySelector('[data-status="error"]');
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent).toContain("Changes not saved");

    await harness.unmount();
  });
});

describe("combineAutoSaveStatuses", () => {
  it("puts actionable unsafe states ahead of slow progress", () => {
    expect(combineAutoSaveStatuses("saving", "unsaved")).toBe("unsaved");
    expect(combineAutoSaveStatuses("error", "unsaved", "saving")).toBe(
      "error",
    );
    expect(combineAutoSaveStatuses("saved", "saved")).toBe("saved");
  });
});
