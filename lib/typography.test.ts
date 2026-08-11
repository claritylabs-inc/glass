import { describe, expect, it } from "vitest";

import {
  editableMirrorTypographyStyle,
  mapboxTypographyAdapter,
  redactionLevels,
  redactionTypeStyle,
  scaledSvgWordmarkTypography,
  typeStyle,
  typographyRoles,
} from "./typography";

describe("typed typography", () => {
  it("resolves every registered role", () => {
    for (const role of Object.keys(typographyRoles) as (keyof typeof typographyRoles)[]) {
      expect(typeStyle(role)).toBe(typographyRoles[role]);
      expect(typeStyle(role)).not.toBe("");
    }
  });

  it("resolves every Redaction level through brand roles", () => {
    for (const level of redactionLevels) {
      expect(redactionTypeStyle("brand.display", level)).toContain("font-");
      expect(redactionTypeStyle("brand.wordmark", level)).toContain("font-");
    }
  });

  it("keeps inline and external adapters fixed", () => {
    expect(Object.isFrozen(editableMirrorTypographyStyle)).toBe(true);
    expect(Object.isFrozen(mapboxTypographyAdapter)).toBe(true);
    expect(Object.isFrozen(mapboxTypographyAdapter.variables)).toBe(true);
    expect(Object.isFrozen(scaledSvgWordmarkTypography(16))).toBe(true);
    expect(scaledSvgWordmarkTypography(16).fontSize).toBe(7);
  });

  it("rejects unknown roles and levels at compile time", () => {
    // @ts-expect-error Typography roles are a closed registry.
    typeStyle("heading.unknown");
    // @ts-expect-error Redaction levels are a closed union.
    redactionTypeStyle("brand.display", "75");
    // @ts-expect-error Redaction levels can only be selected for brand roles.
    redactionTypeStyle("heading.display", "clean");
  });
});
