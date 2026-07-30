import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("policy preview surface", () => {
  it("reuses the branded policy card and keeps only preview-specific details", () => {
    const preview = read("components/preview/policy-preview.tsx");
    const panel = read("components/entity-preview-panel.tsx");

    expect(preview).toContain("import { PolicyListItem }");
    expect(preview).toContain("<PolicyListItem");
    expect(preview).toContain("carrierIdentity={policy.carrierIdentity}");
    expect(preview).toContain(
      "policyDetailOverrides={policy.policyDetailOverrides}",
    );
    expect(preview).toContain('label: "Named insured"');
    expect(preview).toContain('label: "Premium"');
    expect(preview).toContain('label: "Taxes & fees"');
    expect(preview).toContain('label: "Total payable"');
    expect(preview).toContain("repeatsPremium ? undefined : totalPayable");
    expect(preview).not.toContain('label: "Legal entities"');
    expect(preview).not.toContain('label: "General Agent"');
    expect(preview).not.toContain('label: "Producer"');
    expect(preview).not.toContain('label: "Policy type"');
    expect(preview).not.toContain('label: "Files"');
    expect(preview).not.toContain("Key details");
    expect(preview).toContain("groups.length === 1 && group.rows.length === 1");
    expect(preview).toContain("showRowTitles={!useCoverageNameAsHeader}");
    expect(preview).toContain("{headerTitle}");
    expect(preview).toContain("showName={showRowTitles}");
    expect(preview).not.toContain('group.title !== "Coverage schedules"');

    expect(panel).toContain("Policy preview");
    expect(panel).not.toContain("headerInfo");
    expect(panel).not.toContain("currentHeaderInfo");
  });
});
