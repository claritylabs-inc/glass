import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("coverage-only compliance requirement surfaces", () => {
  it("renders overview monitoring and a requirements table on the compliance page", () => {
    const page = read("components/compliance-page.tsx");

    expect(page).toContain("SourceFilter");
    expect(page).toContain("OverviewTab");
    expect(page).toContain("RequirementsTable");
    expect(page).toContain("RequirementDrawer");
    expect(page).toContain("RequirementSourcesTable");
    expect(page).toContain("TabsTrigger value=\"sources\"");
    expect(page).toContain("Archive selected");
    expect(page).toContain('className="h-1.5 w-full overflow-hidden rounded-full bg-muted"');
    expect(page).not.toContain("pr-32");
    expect(page).not.toContain("Insurer standards");
    expect(page).not.toContain("conditionType");
    expect(page).not.toContain("verifyRequirement");
    expect(page).not.toContain("SummaryHeader");
  });

  it("keeps agent lookup tools scoped to coverage requirements", () => {
    const complianceAgent = read("convex/lib/complianceAgent.ts");
    const chatTools = read("convex/lib/chatTools.ts");
    const executors = read("convex/lib/agentToolExecutors.ts");

    expect(complianceAgent).toContain(
      "typed insurance coverage requirements checked against structured policy coverage evidence",
    );
    expect(complianceAgent).not.toContain("minAmBestRating");
    expect(chatTools).not.toContain("REQUIREMENT_KIND_FILTER_VALUES");
    expect(executors).toContain("scope?: RequirementScope");
    expect(executors).not.toContain('kind?: RequirementKind | "all"');
  });

  it("uses coverage-only REST and MCP creation payloads", () => {
    const http = read("convex/http.ts");
    const mcpClient = read("mcp-server/src/tools/client.ts");

    expect(http).toContain("line_of_business");
    expect(http).not.toContain("min_am_best_rating");
    expect(http).not.toContain('appliesTo: "vendors"');
    expect(mcpClient).toContain('kind: z.literal("coverage")');
    expect(mcpClient).not.toContain("conditionType");
    expect(mcpClient).toContain("line_of_business: lineOfBusiness");
  });

  it("enforces coverage-only writes and archives non-coverage rows", () => {
    const compliance = read("convex/compliance.ts");
    const extraction = read("convex/actions/complianceRequirements.ts");

    expect(compliance).toContain("Only coverage requirements are supported");
    expect(compliance).toContain("listRequirementSources");
    expect(compliance).toContain("renameRequirementSource");
    expect(compliance).toContain("archiveRequirementSources");
    expect(compliance).toContain("archiveNonCoverageRequirementsInternal");
    expect(compliance).toContain('row.kind === "coverage"');
    expect(extraction).not.toContain('z.enum(["coverage", "insurer", "condition"])');
    expect(extraction).toContain("sourceName: v.optional(v.string())");
    expect(extraction).toContain("Amounts must be plain numbers");
  });
});
