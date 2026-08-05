// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from "vitest";
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
  vi.restoreAllMocks();
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

  test("releases clipping for a focus-within ring", async () => {
    document.body.innerHTML = `
      <div id="field" style="width: 160px; height: 48px; border-radius: 12px; background: white; box-shadow: rgb(42, 151, 255) 0 0 0 2px">
        <input id="input" />
      </div>
    `;
    const engine = createSmoothCornersEngine();
    destroyEngine = () => engine.destroy();
    const field = document.querySelector<HTMLElement>("#field")!;
    const input = document.querySelector<HTMLInputElement>("#input")!;

    await flushFrames();
    expect(field.style.clipPath).not.toBe("");

    input.focus();
    await flushFrames();

    expect(field.style.clipPath).toBe("");
  });

  test("reapplies managed styles after the root theme changes", async () => {
    document.body.innerHTML = `
      <div class="themed-card" style="width: 120px; height: 60px; border-radius: 16px; background: white"></div>
    `;
    const card = document.querySelector<HTMLElement>(".themed-card")!;
    const readStyles = globalThis.getComputedStyle;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
      (element, pseudoElement) => {
        const styles = readStyles(element, pseudoElement);
        if (element !== card || !document.documentElement.classList.contains("dark")) {
          return styles;
        }
        return new Proxy(styles, {
          get(target, property) {
            if (
              property === "borderTopLeftRadius" ||
              property === "borderTopRightRadius" ||
              property === "borderBottomRightRadius" ||
              property === "borderBottomLeftRadius"
            ) {
              return "24px";
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    );
    const engine = createSmoothCornersEngine();
    destroyEngine = () => engine.destroy();

    await flushFrames();
    const lightClipPath = card.style.clipPath;

    document.documentElement.classList.add("dark");
    await flushFrames();

    expect(card.style.clipPath).not.toBe(lightClipPath);
    document.documentElement.classList.remove("dark");
  });

  test("unmanages and restores dynamically opted-out subtrees", async () => {
    document.body.innerHTML = `
      <div id="card" style="width: 160px; height: 80px; border-radius: 16px; background: white">
        <div id="child" style="width: 80px; height: 40px; border-radius: 8px; background: black"></div>
      </div>
    `;
    const engine = createSmoothCornersEngine();
    destroyEngine = () => engine.destroy();
    const card = document.querySelector<HTMLElement>("#card")!;
    const child = document.querySelector<HTMLElement>("#child")!;

    await flushFrames();
    expect(card.style.clipPath).not.toBe("");
    expect(child.style.clipPath).not.toBe("");

    card.dataset.smoothCorners = "off";
    await flushFrames();
    expect(card.style.clipPath).toBe("");
    expect(child.style.clipPath).toBe("");

    delete card.dataset.smoothCorners;
    await flushFrames();
    expect(card.style.clipPath).not.toBe("");
    expect(child.style.clipPath).not.toBe("");
  });

  test("rechecks rounded ancestors when nested escaping children change", async () => {
    document.body.innerHTML = `
      <div id="card" style="width: 100px; height: 100px; overflow: visible; border-radius: 16px; background: white">
        <div id="wrapper"></div>
      </div>
    `;
    const card = document.querySelector<HTMLElement>("#card")!;
    const wrapper = document.querySelector<HTMLElement>("#wrapper")!;
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 100 }),
    );
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 50, height: 50 }),
    );
    const readStyles = globalThis.getComputedStyle;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
      (element, pseudoElement) => {
        const styles = readStyles(element, pseudoElement);
        if (element !== card) return styles;
        return new Proxy(styles, {
          get(target, property) {
            if (property === "overflowX" || property === "overflowY") {
              return "visible";
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    );
    const engine = createSmoothCornersEngine();
    destroyEngine = () => engine.destroy();

    await flushFrames();
    expect(card.style.clipPath).not.toBe("");

    const popover = document.createElement("div");
    popover.style.position = "absolute";
    vi.spyOn(popover, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 80, y: 80, width: 40, height: 40 }),
    );
    wrapper.append(popover);
    await flushFrames();
    expect(card.style.clipPath).toBe("");

    popover.remove();
    await flushFrames();
    expect(card.style.clipPath).not.toBe("");
  });
});
