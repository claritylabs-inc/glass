import {
  DEFAULT_SMOOTHING,
  getLayoutSize,
  observeResize,
  parseColor,
} from "@lisse/core";
import {
  computeSmoothCornerPlan,
  MIN_SMOOTH_RADIUS,
  type BackgroundLayers,
  type BorderSide,
  type CornerRadii,
  type SmoothCornerPlan,
} from "./plan";

const MAX_MANAGED_ELEMENTS = 1500;
const FRAME_BUDGET_MS = 6;
const READ_CHUNK_SIZE = 32;
const ESCAPING_CHILD_SCAN_LIMIT = 200;
const REPLACED_ELEMENTS = new Set([
  "IMG",
  "VIDEO",
  "CANVAS",
  "IFRAME",
  "EMBED",
  "OBJECT",
]);

interface OriginalStyles {
  clipPath: string;
  filter: string;
  borderColor: string;
  backgroundImage: string;
  backgroundOrigin: string;
  backgroundClip: string;
  backgroundRepeat: string;
  backgroundSize: string;
}

interface ManagedElement {
  original: OriginalStyles;
  lastStyleAttribute: string;
  stopObservingResize: () => void;
}

interface ParsedRadius {
  horizontal: number;
  vertical: number;
}

function parseRadius(
  raw: string,
  width: number,
  height: number,
): ParsedRadius | null {
  const values = raw.trim().split(/\s+/);
  const resolve = (value: string, basis: number) =>
    value.endsWith("%")
      ? (Number.parseFloat(value) / 100) * basis
      : Number.parseFloat(value);
  const horizontal = resolve(values[0], width);
  const vertical = resolve(values[1] ?? values[0], height);

  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return null;
  return { horizontal, vertical };
}

function readRadii(
  styles: CSSStyleDeclaration,
  width: number,
  height: number,
): { radii: CornerRadii; elliptical: boolean } | null {
  const parsed = [
    parseRadius(styles.borderTopLeftRadius, width, height),
    parseRadius(styles.borderTopRightRadius, width, height),
    parseRadius(styles.borderBottomRightRadius, width, height),
    parseRadius(styles.borderBottomLeftRadius, width, height),
  ];

  if (parsed.some((radius) => radius === null)) return null;
  const [topLeft, topRight, bottomRight, bottomLeft] = parsed as [
    ParsedRadius,
    ParsedRadius,
    ParsedRadius,
    ParsedRadius,
  ];

  return {
    radii: {
      topLeft: topLeft.horizontal,
      topRight: topRight.horizontal,
      bottomRight: bottomRight.horizontal,
      bottomLeft: bottomLeft.horizontal,
    },
    elliptical: parsed.some(
      (radius) =>
        Math.abs(radius!.horizontal - radius!.vertical) > 0.01,
    ),
  };
}

function isTransparent(raw: string): boolean {
  if (raw === "transparent") return true;
  const parsed = parseColor(raw);
  return parsed?.opacity === 0;
}

function readBorderSide(
  styles: CSSStyleDeclaration,
  side: "top" | "right" | "bottom" | "left",
): BorderSide {
  const name = side[0].toUpperCase() + side.slice(1);
  const width = Number.parseFloat(
    styles[`border${name}Width` as keyof CSSStyleDeclaration] as string,
  );
  const style = styles[
    `border${name}Style` as keyof CSSStyleDeclaration
  ] as string;
  const color = styles[
    `border${name}Color` as keyof CSSStyleDeclaration
  ] as string;

  return {
    width: Number.isFinite(width) ? width : 0,
    style,
    color,
    visible:
      style !== "none" &&
      style !== "hidden" &&
      width > 0 &&
      !isTransparent(color),
  };
}

function hasVisibleOutline(styles: CSSStyleDeclaration): boolean {
  const width = Number.parseFloat(styles.outlineWidth);
  return (
    styles.outlineStyle !== "none" &&
    Number.isFinite(width) &&
    width > 0 &&
    !isTransparent(styles.outlineColor)
  );
}

function pseudoEscapes(
  element: HTMLElement,
  width: number,
  height: number,
): boolean {
  for (const pseudo of ["::before", "::after"]) {
    const styles = getComputedStyle(element, pseudo);
    if (styles.content === "none" || styles.position !== "absolute") continue;

    const top = Number.parseFloat(styles.top);
    const right = Number.parseFloat(styles.right);
    const bottom = Number.parseFloat(styles.bottom);
    const left = Number.parseFloat(styles.left);
    const pseudoWidth = Number.parseFloat(styles.width);
    const pseudoHeight = Number.parseFloat(styles.height);

    if ([top, right, bottom, left].some((value) => value < -0.01)) {
      return true;
    }

    const resolvedTop = Number.isFinite(top)
      ? top
      : Number.isFinite(bottom) && Number.isFinite(pseudoHeight)
        ? height - bottom - pseudoHeight
        : Number.NaN;
    const resolvedLeft = Number.isFinite(left)
      ? left
      : Number.isFinite(right) && Number.isFinite(pseudoWidth)
        ? width - right - pseudoWidth
        : Number.NaN;

    if (
      Number.isFinite(resolvedTop) &&
      Number.isFinite(pseudoHeight) &&
      (resolvedTop < -0.01 || resolvedTop + pseudoHeight > height + 0.01)
    ) {
      return true;
    }
    if (
      Number.isFinite(resolvedLeft) &&
      Number.isFinite(pseudoWidth) &&
      (resolvedLeft < -0.01 || resolvedLeft + pseudoWidth > width + 0.01)
    ) {
      return true;
    }
  }

  return false;
}

function childrenEscape(
  element: HTMLElement,
  styles: CSSStyleDeclaration,
): boolean {
  if (styles.overflowX !== "visible" && styles.overflowY !== "visible") {
    return false;
  }
  if (!element.childElementCount) return false;

  const bounds = element.getBoundingClientRect();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode() as HTMLElement | null;
  let scanned = 0;

  while (current && scanned < ESCAPING_CHILD_SCAN_LIMIT) {
    const childBounds = current.getBoundingClientRect();
    if (
      childBounds.width > 0 &&
      childBounds.height > 0 &&
      (childBounds.left < bounds.left - 0.6 ||
        childBounds.top < bounds.top - 0.6 ||
        childBounds.right > bounds.right + 0.6 ||
        childBounds.bottom > bounds.bottom + 0.6)
    ) {
      const childStyles = getComputedStyle(current);
      if (
        childStyles.visibility !== "hidden" &&
        childStyles.opacity !== "0" &&
        childStyles.position !== "fixed"
      ) {
        return true;
      }
    }

    scanned += 1;
    current = walker.nextNode() as HTMLElement | null;
  }

  return false;
}

function originalStyles(element: HTMLElement): OriginalStyles {
  return {
    clipPath: element.style.clipPath,
    filter: element.style.filter,
    borderColor: element.style.borderColor,
    backgroundImage: element.style.backgroundImage,
    backgroundOrigin: element.style.backgroundOrigin,
    backgroundClip: element.style.backgroundClip,
    backgroundRepeat: element.style.backgroundRepeat,
    backgroundSize: element.style.backgroundSize,
  };
}

function restoreStyles(element: HTMLElement, original: OriginalStyles): void {
  element.style.clipPath = original.clipPath;
  element.style.filter = original.filter;
  element.style.borderColor = original.borderColor;
  element.style.backgroundImage = original.backgroundImage;
  element.style.backgroundOrigin = original.backgroundOrigin;
  element.style.backgroundClip = original.backgroundClip;
  element.style.backgroundRepeat = original.backgroundRepeat;
  element.style.backgroundSize = original.backgroundSize;
}

function syncChangedInlineStyles(
  element: HTMLElement,
  entry: ManagedElement,
): void {
  const previous = document.createElement("div");
  previous.setAttribute("style", entry.lastStyleAttribute);

  if (element.style.clipPath !== previous.style.clipPath) {
    entry.original.clipPath = element.style.clipPath;
  }
  if (element.style.filter !== previous.style.filter) {
    entry.original.filter = element.style.filter;
  }
  if (element.style.borderColor !== previous.style.borderColor) {
    entry.original.borderColor = element.style.borderColor;
  }
  if (element.style.backgroundImage !== previous.style.backgroundImage) {
    entry.original.backgroundImage = element.style.backgroundImage;
  }
  if (element.style.backgroundOrigin !== previous.style.backgroundOrigin) {
    entry.original.backgroundOrigin = element.style.backgroundOrigin;
  }
  if (element.style.backgroundClip !== previous.style.backgroundClip) {
    entry.original.backgroundClip = element.style.backgroundClip;
  }
  if (element.style.backgroundRepeat !== previous.style.backgroundRepeat) {
    entry.original.backgroundRepeat = element.style.backgroundRepeat;
  }
  if (element.style.backgroundSize !== previous.style.backgroundSize) {
    entry.original.backgroundSize = element.style.backgroundSize;
  }
}

function shouldSkipElement(element: Element): boolean {
  return (
    element.tagName === "HTML" ||
    element.tagName === "BODY" ||
    element.namespaceURI === "http://www.w3.org/2000/svg" ||
    Boolean(element.closest('[data-smooth-corners="off"]'))
  );
}

function isTrueCircle(
  width: number,
  height: number,
  radii: CornerRadii,
): boolean {
  if (Math.abs(width - height) > 0.5) return false;
  const half = Math.min(width, height) / 2;
  return Object.values(radii).every((radius) => radius >= half - 0.5);
}

function captureBackground(styles: CSSStyleDeclaration): BackgroundLayers {
  return {
    image: styles.backgroundImage,
    origin: styles.backgroundOrigin,
    clip: styles.backgroundClip,
    repeat: styles.backgroundRepeat,
    size: styles.backgroundSize,
  };
}

export function createSmoothCornersEngine(options?: { smoothing?: number }) {
  const smoothing = options?.smoothing ?? DEFAULT_SMOOTHING;
  const managed = new Map<HTMLElement, ManagedElement>();
  const queue = new Set<HTMLElement>();
  let animationFrame: number | null = null;
  let destroyed = false;

  const mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const element = record.target as HTMLElement;

        if (element === document.documentElement) {
          for (const current of managed.keys()) enqueue(current);
          continue;
        }

        if (record.attributeName === "data-smooth-corners") {
          if (shouldSkipElement(element)) {
            unmanageSubtree(element);
          } else {
            scanSubtree(element);
          }
          enqueueAncestors(element);
          continue;
        }

        if (shouldSkipElement(element)) continue;

        if (record.attributeName === "style") {
          const entry = managed.get(element);
          if (
            entry &&
            (element.getAttribute("style") ?? "") === entry.lastStyleAttribute
          ) {
            continue;
          }
          if (entry) syncChangedInlineStyles(element, entry);
        }

        enqueue(element);
        enqueueAncestors(element);
        continue;
      }

      const parent = record.target;
      if (parent instanceof HTMLElement) {
        if (!shouldSkipElement(parent)) enqueue(parent);
        enqueueAncestors(parent);
      }
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) scanSubtree(node);
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        unmanageSubtree(node);
      }
    }
  });

  function enqueue(element: HTMLElement): void {
    if (destroyed) return;
    queue.add(element);
    if (animationFrame === null) {
      animationFrame = requestAnimationFrame(flush);
    }
  }

  function enqueueAncestors(element: Element): void {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 12; depth += 1) {
      enqueue(current);
      current = current.parentElement;
    }
  }

  function unmanage(element: HTMLElement): void {
    const entry = managed.get(element);
    if (!entry) return;
    restoreStyles(element, entry.original);
    entry.stopObservingResize();
    managed.delete(element);
  }

  function unmanageSubtree(root: HTMLElement): void {
    unmanage(root);
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      unmanage(element);
    }
  }

  function planFor(element: HTMLElement): SmoothCornerPlan | null {
    const existing = managed.get(element);
    if (existing) restoreStyles(element, existing.original);
    if (!element.isConnected || shouldSkipElement(element)) return null;

    const styles = getComputedStyle(element);
    if (
      styles.display === "inline" &&
      !REPLACED_ELEMENTS.has(element.tagName)
    ) {
      return null;
    }
    if (
      element.tagName === "FIELDSET" &&
      element.querySelector(":scope > legend")
    ) {
      return null;
    }

    const cornerShape = styles.getPropertyValue("corner-shape");
    if (
      cornerShape &&
      cornerShape
        .trim()
        .split(/\s+/)
        .some(
          (shape) => shape !== "round" && shape !== "superellipse(1)",
        )
    ) {
      return null;
    }

    const { width, height } = getLayoutSize(element);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

    const parsed = readRadii(styles, width, height);
    if (!parsed) return null;
    if (Math.max(...Object.values(parsed.radii)) < MIN_SMOOTH_RADIUS) {
      return null;
    }

    const border = {
      top: readBorderSide(styles, "top"),
      right: readBorderSide(styles, "right"),
      bottom: readBorderSide(styles, "bottom"),
      left: readBorderSide(styles, "left"),
    };
    const bounds = element.getBoundingClientRect();
    const background = captureBackground(styles);
    const paintsNothing =
      isTransparent(styles.backgroundColor) &&
      (background.image === "none" || background.image === "") &&
      styles.boxShadow === "none" &&
      styles.overflowX === "visible" &&
      styles.overflowY === "visible";

    return computeSmoothCornerPlan({
      width,
      height,
      radii: parsed.radii,
      elliptical: parsed.elliptical,
      circle: isTrueCircle(width, height, parsed.radii),
      border,
      hasBorderImage:
        styles.borderImageSource !== "none" &&
        styles.borderImageSource !== "",
      background,
      paintsNothing,
      hasOutline: hasVisibleOutline(styles),
      pseudoOutside: pseudoEscapes(element, width, height),
      childOutside: childrenEscape(element, styles),
      boxShadow: styles.boxShadow,
      focusRingVisible: element.contains(document.activeElement),
      existingFilter: styles.filter,
      pageLeft: bounds.left + window.scrollX,
      pageTop: bounds.top + window.scrollY,
      devicePixelRatio: window.devicePixelRatio || 1,
      smoothing,
    });
  }

  function applyPlan(
    element: HTMLElement,
    plan: SmoothCornerPlan | null,
  ): void {
    if (!plan || plan.action === "skip") {
      unmanage(element);
      return;
    }

    const entry = managed.get(element);
    const original = entry?.original ?? originalStyles(element);

    element.style.clipPath = plan.clipPath;
    element.style.filter = plan.filter ?? original.filter;
    if (plan.border) {
      element.style.borderColor = "transparent";
      element.style.backgroundImage = plan.border.image;
      element.style.backgroundOrigin = plan.border.origin;
      element.style.backgroundClip = plan.border.clip;
      element.style.backgroundRepeat = plan.border.repeat;
      element.style.backgroundSize = plan.border.size;
    } else {
      element.style.borderColor = original.borderColor;
      element.style.backgroundImage = original.backgroundImage;
      element.style.backgroundOrigin = original.backgroundOrigin;
      element.style.backgroundClip = original.backgroundClip;
      element.style.backgroundRepeat = original.backgroundRepeat;
      element.style.backgroundSize = original.backgroundSize;
    }

    if (entry) {
      entry.lastStyleAttribute = element.getAttribute("style") ?? "";
      return;
    }

    managed.set(element, {
      original,
      lastStyleAttribute: element.getAttribute("style") ?? "",
      stopObservingResize: observeResize(element, () => enqueue(element)),
    });
  }

  function flush(): void {
    animationFrame = null;
    const deadline = performance.now() + FRAME_BUDGET_MS;
    const operations: Array<{
      element: HTMLElement;
      plan: SmoothCornerPlan | null;
    }> = [];
    let readCount = 0;

    for (const element of queue) {
      queue.delete(element);
      operations.push({ element, plan: planFor(element) });
      readCount += 1;
      if (
        readCount % READ_CHUNK_SIZE === 0 &&
        performance.now() >= deadline
      ) {
        break;
      }
    }

    for (const operation of operations) {
      applyPlan(operation.element, operation.plan);
    }
    if (queue.size) animationFrame = requestAnimationFrame(flush);
  }

  function scanSubtree(root: HTMLElement): void {
    if (shouldSkipElement(root)) return;
    if (managed.size + queue.size >= MAX_MANAGED_ELEMENTS) return;
    enqueue(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode() as HTMLElement | null;
    while (
      current &&
      managed.size + queue.size < MAX_MANAGED_ELEMENTS
    ) {
      if (!shouldSkipElement(current)) enqueue(current);
      current = walker.nextNode() as HTMLElement | null;
    }
  }

  function enqueueEventPath(event: Event): void {
    for (const target of event.composedPath().slice(0, 10)) {
      if (target instanceof HTMLElement && !shouldSkipElement(target)) {
        enqueue(target);
      }
    }
  }

  function handleWindowResize(): void {
    for (const element of managed.keys()) enqueue(element);
  }

  mutationObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class", "style", "data-smooth-corners"],
  });
  document.addEventListener("transitionend", enqueueEventPath, true);
  document.addEventListener("animationend", enqueueEventPath, true);
  document.addEventListener("focusin", enqueueEventPath, true);
  document.addEventListener("focusout", enqueueEventPath, true);
  document.addEventListener("pointerover", enqueueEventPath, true);
  document.addEventListener("pointerout", enqueueEventPath, true);
  window.addEventListener("resize", handleWindowResize);

  for (const element of document.querySelectorAll<HTMLElement>("body *")) {
    if (managed.size + queue.size >= MAX_MANAGED_ELEMENTS) break;
    if (!shouldSkipElement(element)) enqueue(element);
  }

  return {
    destroy() {
      destroyed = true;
      mutationObserver.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      document.removeEventListener("transitionend", enqueueEventPath, true);
      document.removeEventListener("animationend", enqueueEventPath, true);
      document.removeEventListener("focusin", enqueueEventPath, true);
      document.removeEventListener("focusout", enqueueEventPath, true);
      document.removeEventListener("pointerover", enqueueEventPath, true);
      document.removeEventListener("pointerout", enqueueEventPath, true);
      window.removeEventListener("resize", handleWindowResize);
      for (const element of [...managed.keys()]) unmanage(element);
      queue.clear();
    },
  };
}
