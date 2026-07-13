import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("UI simplification", () => {
  it("keeps certificate status in version rows but not the drawer header", () => {
    const source = read("components/certificates/certificate-workspace.tsx");
    const detail = source.slice(source.indexOf("export function CertificateDetailPanel"));
    expect(detail).not.toContain("actions={");
    expect(source).toContain("Current");
    expect(source).toContain("versionBadge(version)");
  });

  it("removes overview policy tags and coverage form sublines", () => {
    const compliance = read("components/compliance-page.tsx");
    const overview = compliance.slice(
      compliance.indexOf("function OverviewTab"),
      compliance.indexOf("function RequirementsTable"),
    );
    expect(overview).not.toContain("PolicyTagList");

    const coverage = read("app/policies/[id]/policy-coverage-breakdown.tsx");
    expect(coverage).not.toContain("function formLabel");
    expect(coverage).toContain('role={canOpenSource ? "button" : undefined}');
  });
});
