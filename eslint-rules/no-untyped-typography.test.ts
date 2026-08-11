// @vitest-environment node

import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import glassPlugin from "./no-untyped-typography.mjs";

const linter = new Linter({ configType: "flat" });
const config: Linter.Config[] = [
  {
    files: ["**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest" as const,
      sourceType: "module" as const,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { glass: glassPlugin },
    rules: { "glass/no-untyped-typography": "error" as const },
  },
];

function messages(code: string) {
  return linter.verify(code, config, { filename: "sample.jsx" });
}

describe("glass/no-untyped-typography", () => {
  it("accepts typed role calls", () => {
    expect(messages(`const view = <p className={typeStyle("body.default")}>Text</p>;`)).toEqual([]);
  });

  it.each([
    [`const view = <p className="text-base font-medium">Text</p>;`, 1],
    ["const styles = `px-2 ${active ? 'tracking-tight' : 'leading-5'}`;", 2],
    [`const recipe = cva("uppercase text-label", { variants: {} });`, 1],
    [`const classes = "font-mono tabular-nums";`, 1],
    [`const view = <p className="sm:text-lg [&_strong]:font-semibold">Text</p>;`, 1],
    [`const view = <p className="text-base! sm:text-sm/6">Text</p>;`, 1],
    [`const view = <p className="[&_h1]:text-base! [&_p]:leading-5!">Text</p>;`, 1],
    [`const view = <p className="text-[0.6875rem] [letter-spacing:0.08em]">Text</p>;`, 1],
    [`const view = <p className="[font:var(--private-font)]">Text</p>;`, 1],
    [`const view = <p className="font-[family-name:var(--font-private)] text-[length:var(--copy-size)]">Text</p>;`, 1],
  ])("rejects raw utility declarations", (code, expected) => {
    expect(messages(code)).toHaveLength(expected);
  });

  it("rejects inline typography properties", () => {
    const result = messages(
      `const view = <p style={{ font: "inherit", fontFamily: "inherit", fontSize: 12, lineHeight: 1 }}>Text</p>;`,
    );
    expect(result.map((message) => message.messageId)).toEqual([
      "inline",
      "inline",
      "inline",
      "inline",
    ]);
  });
});
