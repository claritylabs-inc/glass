import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("typed compliance requirement surfaces", () => {
  it("renders source grouping and typed requirement sections on the compliance page", () => {
    const page = read("components/compliance-page.tsx");

    expect(page).toContain("SourceFilter");
    expect(page).toContain("CoverageRow");
    expect(page).toContain("Insurer standards");
    expect(page).toContain("Conditions");
    expect(page).toContain("verifyRequirement");
    expect(page).not.toContain("EvaluationTargetBadge");
    expect(page).not.toContain("minimumRequired");
  });

  it("exposes kind and scope through agent lookup tools", () => {
    const complianceAgent = read("convex/lib/complianceAgent.ts");
    const chatTools = read("convex/lib/chatTools.ts");
    const executors = read("convex/lib/agentToolExecutors.ts");

    expect(complianceAgent).toContain("kind says how it is evaluated");
    expect(chatTools).toContain("REQUIREMENT_KIND_FILTER_VALUES");
    expect(chatTools).toContain("Filter by rule kind");
    expect(executors).toContain("kind?: RequirementKind");
    expect(executors).toContain("scope?: RequirementScope");
  });

  it("uses typed REST and MCP creation payloads", () => {
    const http = read("convex/http.ts");
    const mcpClient = read("mcp-server/src/tools/client.ts");

    expect(http).toContain("line_of_business");
    expect(http).toContain("min_am_best_rating");
    expect(http).not.toContain('appliesTo: "vendors"');
    expect(mcpClient).toContain('kind: z.enum(["coverage", "insurer", "condition"])');
    expect(mcpClient).toContain("line_of_business: lineOfBusiness");
  });
});
