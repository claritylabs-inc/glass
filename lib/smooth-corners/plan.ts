import {
  DEFAULT_SMOOTHING,
  generatePath,
  parseBoxShadow,
} from "@lisse/core";

export const MIN_SMOOTH_RADIUS = 3;
export const MIN_SMOOTH_SIZE = 8;

const MAX_BORDER_WIDTH = 6;
const MAX_SHADOW_SPREAD = 4;
const EPSILON = 0.01;

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface BorderSide {
  width: number;
  style: string;
  color: string;
  visible: boolean;
}

export interface BorderSides {
  top: BorderSide;
  right: BorderSide;
  bottom: BorderSide;
  left: BorderSide;
}

export interface BackgroundLayers {
  image: string;
  origin: string;
  clip: string;
  repeat: string;
  size: string;
}

export interface SmoothCornerPlanInput {
  width: number;
  height: number;
  radii: CornerRadii;
  elliptical: boolean;
  circle: boolean;
  border: BorderSides;
  hasBorderImage: boolean;
  background: BackgroundLayers;
  paintsNothing: boolean;
  hasOutline: boolean;
  pseudoOutside: boolean;
  childOutside: boolean;
  boxShadow: string;
  focusRingVisible: boolean;
  existingFilter: string;
  pageLeft: number;
  pageTop: number;
  devicePixelRatio: number;
  smoothing?: number;
}

export interface BorderLayer {
  image: string;
  origin: string;
  clip: string;
  repeat: string;
  size: string;
}

export type SmoothCornerPlan =
  | { action: "skip"; reason: string }
  | {
      action: "apply";
      clipPath: string;
      filter?: string;
      border?: BorderLayer;
    };

function hasVisibleBorder(border: BorderSides): boolean {
  return [border.top, border.right, border.bottom, border.left].some(
    (side) => side.visible && side.width > EPSILON,
  );
}

function uniformSolidBorder(
  border: BorderSides,
): { width: number; color: string } | null {
  const sides = [border.top, border.right, border.bottom, border.left];
  const first = sides[0];

  if (
    !first.visible ||
    first.width < 0.5 ||
    first.width > MAX_BORDER_WIDTH
  ) {
    return null;
  }

  for (const side of sides) {
    if (
      !side.visible ||
      side.style !== "solid" ||
      Math.abs(side.width - first.width) > EPSILON ||
      side.color !== first.color
    ) {
      return null;
    }
  }

  return { width: first.width, color: first.color };
}

function colorWithOpacity(color: string, opacity: number): string {
  if (!color.startsWith("#")) return color;

  const numeric = Number.parseInt(color.slice(1), 16);
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function boxShadowToFilter(
  raw: string,
  focusRingVisible: boolean,
): string | null | "skip" {
  const { shadow } = parseBoxShadow(raw);
  if (!shadow?.length) return null;

  const filters: string[] = [];
  for (const entry of shadow) {
    if (
      Math.abs(entry.spread) > MAX_SHADOW_SPREAD ||
      (focusRingVisible && entry.blur === 0 && entry.spread !== 0)
    ) {
      return "skip";
    }

    const blur = Math.max(0, entry.blur + entry.spread);
    filters.push(
      `drop-shadow(${entry.offsetX}px ${entry.offsetY}px ${blur}px ${colorWithOpacity(
        entry.color,
        entry.opacity,
      )})`,
    );
  }

  return filters.join(" ");
}

interface StrokeGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

function snapStroke(
  width: number,
  height: number,
  borderWidth: number,
  pageLeft: number,
  pageTop: number,
  devicePixelRatio: number,
): StrokeGeometry {
  const ratio = devicePixelRatio || 1;
  const strokeWidth = Math.max(1, Math.round(borderWidth * ratio)) / ratio;
  const near = (position: number) =>
    Math.max(
      0,
      Math.floor(position * ratio + 0.5) / ratio - position,
    );
  const far = (position: number) =>
    Math.max(
      0,
      position - Math.ceil(position * ratio - 0.5) / ratio,
    );

  const geometry = {
    left: near(pageLeft),
    top: near(pageTop),
    right: far(pageLeft + width),
    bottom: far(pageTop + height),
    width: strokeWidth,
  };

  if (
    width - geometry.left - geometry.right <= strokeWidth ||
    height - geometry.top - geometry.bottom <= strokeWidth
  ) {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: borderWidth,
    };
  }

  return geometry;
}

function borderLayer(
  path: string,
  width: number,
  height: number,
  x: number,
  y: number,
  strokeWidth: number,
  color: string,
  background: BackgroundLayers,
): BorderLayer {
  const safeColor = color.replaceAll("'", "&apos;");
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' ` +
    `viewBox='0 0 ${width} ${height}' preserveAspectRatio='none'>` +
    `<g transform='translate(${x} ${y})'>` +
    `<path d='${path}' fill='none' stroke='${safeColor}' stroke-width='${strokeWidth}'/>` +
    "</g></svg>";
  const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  const hasExistingImage =
    background.image !== "none" && background.image !== "";
  const withExisting = (ours: string, existing: string) =>
    hasExistingImage ? `${ours}, ${existing}` : ours;

  return {
    image: hasExistingImage ? `${image}, ${background.image}` : image,
    origin: withExisting("border-box", background.origin),
    clip: withExisting("border-box", background.clip),
    repeat: withExisting("no-repeat", background.repeat),
    size: withExisting("100% 100%", background.size),
  };
}

export function computeSmoothCornerPlan(
  input: SmoothCornerPlanInput,
): SmoothCornerPlan {
  const maximumRadius = Math.max(
    input.radii.topLeft,
    input.radii.topRight,
    input.radii.bottomRight,
    input.radii.bottomLeft,
  );

  if (input.elliptical) return { action: "skip", reason: "elliptical" };
  if (input.circle) return { action: "skip", reason: "circle" };
  if (maximumRadius < MIN_SMOOTH_RADIUS) {
    return { action: "skip", reason: "radius-too-small" };
  }
  if (input.width < MIN_SMOOTH_SIZE || input.height < MIN_SMOOTH_SIZE) {
    return { action: "skip", reason: "too-small" };
  }
  if (input.hasBorderImage) {
    return { action: "skip", reason: "border-image" };
  }
  if (input.paintsNothing && !hasVisibleBorder(input.border)) {
    return { action: "skip", reason: "paints-nothing" };
  }
  if (input.hasOutline) return { action: "skip", reason: "outline" };
  if (input.pseudoOutside) {
    return { action: "skip", reason: "pseudo-outside" };
  }
  if (input.childOutside) {
    return { action: "skip", reason: "child-outside" };
  }

  let border: { width: number; color: string } | null = null;
  if (hasVisibleBorder(input.border)) {
    border = uniformSolidBorder(input.border);
    if (!border) {
      return { action: "skip", reason: "non-uniform-border" };
    }
  }

  const smoothing = input.smoothing ?? DEFAULT_SMOOTHING;
  const corner = (radius: number) => ({ radius, smoothing });
  const path = generatePath(input.width, input.height, {
    topLeft: corner(input.radii.topLeft),
    topRight: corner(input.radii.topRight),
    bottomRight: corner(input.radii.bottomRight),
    bottomLeft: corner(input.radii.bottomLeft),
  });
  const shadowFilter = boxShadowToFilter(
    input.boxShadow,
    input.focusRingVisible,
  );

  if (shadowFilter === "skip") {
    return { action: "skip", reason: "shadow-spread" };
  }

  const plan: SmoothCornerPlan = {
    action: "apply",
    clipPath: `path("${path}")`,
  };

  if (shadowFilter) {
    plan.filter =
      input.existingFilter && input.existingFilter !== "none"
        ? `${shadowFilter} ${input.existingFilter}`
        : shadowFilter;
  }

  if (border) {
    const geometry = snapStroke(
      input.width,
      input.height,
      border.width,
      input.pageLeft,
      input.pageTop,
      input.devicePixelRatio,
    );
    const halfStroke = geometry.width / 2;
    const insetCorner = (radius: number) => ({
      radius: Math.max(0, radius - halfStroke),
      smoothing,
    });
    const innerWidth =
      input.width - geometry.left - geometry.right - geometry.width;
    const innerHeight =
      input.height - geometry.top - geometry.bottom - geometry.width;
    const innerPath = generatePath(innerWidth, innerHeight, {
      topLeft: insetCorner(input.radii.topLeft),
      topRight: insetCorner(input.radii.topRight),
      bottomRight: insetCorner(input.radii.bottomRight),
      bottomLeft: insetCorner(input.radii.bottomLeft),
    });

    plan.border = borderLayer(
      innerPath,
      input.width,
      input.height,
      geometry.left + halfStroke,
      geometry.top + halfStroke,
      geometry.width,
      border.color,
      input.background,
    );
  }

  return plan;
}
