import { describe, expect, test } from "vitest";
import {
  computeSmoothCornerPlan,
  type SmoothCornerPlanInput,
} from "./plan";

function input(
  overrides: Partial<SmoothCornerPlanInput> = {},
): SmoothCornerPlanInput {
  const borderSide = {
    width: 0,
    style: "none",
    color: "rgba(0, 0, 0, 0)",
    visible: false,
  };

  return {
    width: 240,
    height: 120,
    radii: {
      topLeft: 16,
      topRight: 16,
      bottomRight: 16,
      bottomLeft: 16,
    },
    elliptical: false,
    circle: false,
    border: {
      top: borderSide,
      right: borderSide,
      bottom: borderSide,
      left: borderSide,
    },
    hasBorderImage: false,
    background: {
      image: "none",
      origin: "padding-box",
      clip: "border-box",
      repeat: "repeat",
      size: "auto",
    },
    paintsNothing: false,
    hasOutline: false,
    pseudoOutside: false,
    childOutside: false,
    boxShadow: "none",
    existingFilter: "none",
    pageLeft: 0,
    pageTop: 0,
    devicePixelRatio: 2,
    ...overrides,
  };
}

describe("computeSmoothCornerPlan", () => {
  test("generates a Lisse path for a painted rounded rectangle", () => {
    const plan = computeSmoothCornerPlan(input());

    expect(plan.action).toBe("apply");
    if (plan.action === "apply") {
      expect(plan.clipPath).toMatch(/^path\("M /);
      expect(plan.clipPath).toContain(" c ");
    }
  });

  test("preserves true circles instead of turning avatars into squircles", () => {
    expect(
      computeSmoothCornerPlan(
        input({
          width: 32,
          height: 32,
          circle: true,
          radii: {
            topLeft: 16,
            topRight: 16,
            bottomRight: 16,
            bottomLeft: 16,
          },
        }),
      ),
    ).toEqual({ action: "skip", reason: "circle" });
  });

  test("smooths pill-shaped rectangles", () => {
    const plan = computeSmoothCornerPlan(
      input({
        width: 120,
        height: 32,
        radii: {
          topLeft: 9999,
          topRight: 9999,
          bottomRight: 9999,
          bottomLeft: 9999,
        },
      }),
    );

    expect(plan.action).toBe("apply");
  });

  test("releases clipping while a focus outline is visible", () => {
    expect(
      computeSmoothCornerPlan(input({ hasOutline: true })),
    ).toEqual({ action: "skip", reason: "outline" });
  });

  test("releases clipping for spread-only focus rings", () => {
    expect(
      computeSmoothCornerPlan(
        input({
          boxShadow: "rgb(42, 151, 255) 0px 0px 0px 2px",
        }),
      ),
    ).toEqual({ action: "skip", reason: "shadow-spread" });
  });

  test("redraws a uniform border over the squircle path", () => {
    const borderSide = {
      width: 1,
      style: "solid",
      color: "rgb(0, 0, 0)",
      visible: true,
    };
    const plan = computeSmoothCornerPlan(
      input({
        border: {
          top: borderSide,
          right: borderSide,
          bottom: borderSide,
          left: borderSide,
        },
        background: {
          image: "linear-gradient(red, blue)",
          origin: "padding-box",
          clip: "border-box",
          repeat: "no-repeat",
          size: "cover",
        },
      }),
    );

    expect(plan.action).toBe("apply");
    if (plan.action === "apply") {
      expect(plan.border?.image).toContain("data:image/svg+xml");
      expect(plan.border?.image).toContain("linear-gradient(red, blue)");
      expect(plan.border?.origin).toBe("border-box, padding-box");
    }
  });

  test("does not degrade non-uniform borders", () => {
    const visible = {
      width: 1,
      style: "solid",
      color: "rgb(0, 0, 0)",
      visible: true,
    };
    expect(
      computeSmoothCornerPlan(
        input({
          border: {
            top: visible,
            right: visible,
            bottom: visible,
            left: { ...visible, width: 2 },
          },
        }),
      ),
    ).toEqual({ action: "skip", reason: "non-uniform-border" });
  });
});
