import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("extraction finalization boundary", () => {
  test("all full-extraction completions use the guarded promotion helper", () => {
    const action = read("convex/actions/policyExtraction.ts");
    const calls = [...action.matchAll(/await persistEvidenceAndPromote\(/g)];

    expect(calls).toHaveLength(2);
    expect(action).not.toMatch(/extractionDataStage\s*:\s*["']final["']/);
  });

  test("only the promotion mutation writes the final stage", () => {
    const policies = read("convex/policies.ts");
    const finalAssignments = [...policies.matchAll(
      /extractionDataStage\s*=\s*["']final["']/g,
    )];
    const promotionStart = policies.indexOf(
      "export const promoteCompletedExtractionInternal",
    );
    const promotionEnd = policies.indexOf(
      "const PREVIEW_EXTRACTION_FIELD_ALLOWLIST",
      promotionStart,
    );

    expect(finalAssignments).toHaveLength(1);
    expect(finalAssignments[0]!.index).toBeGreaterThan(promotionStart);
    expect(finalAssignments[0]!.index).toBeLessThan(promotionEnd);
    expect(policies).toContain(
      "updateExtractionInternal cannot promote a policy to final",
    );
  });
});
