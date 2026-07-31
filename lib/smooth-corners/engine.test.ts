// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from "vitest";
import { createSmoothCornersEngine } from "./engine";

let destroyEngine: (() => void) | undefined;

async function flushFrames(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

afterEach(() => {
  destroyEngine?.();
  destroyEngine = undefined;
  document.body.replaceChildren();
});

describe("createSmoothCornersEngine", () => {
  test("applies continuous corners without changing DOM structure", async () => {
    document.body.innerHTML = `
      <div id="card" style="width: 240px; height: 120px; border-radius: 16px; background: white">
        Card
      </div>
    `;
    const originalChildren = document.body.childElementCount;
    const engine = createSmoothCornersEngine();
    destroyEngine = () => engine.destroy();

    await flushFrames();

    const card = document.querySelector<HTMLElement>("#card")!;
    expect(card.style.clipPath).toMatch(/^path\("M /);
    expect(document.body.childElementCount).toBe(originalChildren);
  });

  test("preserves exact circles and restores managed styles on cleanup", async () => {
    document.body.innerHTML = `
      <div id="card" style="width: 120px; height: 60px; border-radius: 16px; background: white"></div>
      <div id="avatar" style="width: 32px; height: 32px; border-radius: 9999px; background: black"></div>
    `;
    const engine = createSmoothCornersEngine();
    destroyEngine = () => engine.destroy();

    await flushFrames();

    const card = document.querySelector<HTMLElement>("#card")!;
    const avatar = document.querySelector<HTMLElement>("#avatar")!;
    expect(card.style.clipPath).not.toBe("");
    expect(avatar.style.clipPath).toBe("");

    engine.destroy();
    destroyEngine = undefined;
    expect(card.style.clipPath).toBe("");
  });

  test("releases clipping when a focus outline becomes visible", async () => {
    document.body.innerHTML = `
      <div id="button" tabindex="0" style="width: 120px; height: 40px; border-radius: 12px; background: black">
        Continue
      </div>
    `;
    const engine = createSmoothCornersEngine();
    destroyEngine = () => engine.destroy();
    const button = document.querySelector<HTMLElement>("#button")!;

    await flushFrames();
    expect(button.style.clipPath).not.toBe("");

    button.style.outline = "2px solid blue";
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flushFrames();

    expect(button.style.clipPath).toBe("");
  });
});
