import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / external
    ".worktrees/**",
    ".claude/worktrees/**",
    // Convex codegen output — regenerated on every `convex dev`.
    "convex/_generated/**",
  ]),
  // Allow underscore-prefixed identifiers to mark intentionally-unused values
  // across the repo. Matches the existing convention (`_unused`, `catch (_)`).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Convex functions deal with dynamic data: cl-sdk discriminated unions,
  // LLM JSON output, and `v.any()`-typed schema fields (document, analysis,
  // declarations, etc). Explicit `any` is the pragmatic choice here rather
  // than a code smell, so relax the rule in this directory.
  {
    files: ["convex/**/*.{ts,tsx,js}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
