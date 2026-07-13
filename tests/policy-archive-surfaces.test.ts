import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("policy archive surfaces", () => {
  it("uses archive language and exposes active and archived list modes", () => {
    const detail = read("app/policies/[id]/policy-detail-body.tsx");
    const policies = read("convex/policies.ts");
    expect(detail).toContain("Archive policy");
    expect(detail).not.toContain("Delete Policy");
    expect(detail).toContain("Policy restored");
    expect(policies).toContain("archived: v.optional(v.boolean())");
    expect(policies).toContain("export const archive = mutation");
    expect(policies).toContain("reactivatePolicyDeclarationFacts");
  });

  it("filters archived parents from operational descendant queries", () => {
    expect(read("convex/lib/agentToolExecutors.ts")).toContain("!policy.deletedAt");
    expect(read("convex/certificates.ts")).toContain("policy.deletedAt");
    expect(read("convex/policyVersions.ts")).toContain("activePolicyIds");
    expect(read("convex/certificateLifecycle.ts")).toContain(
      "!policies.get(version.policyId)?.deletedAt",
    );
    expect(read("convex/certificateWorkflowJobs.ts")).toContain(
      "if (!policy || policy.deletedAt) return null",
    );
    expect(read("convex/appCardLinks.ts")).toContain("policy.deletedAt");
    expect(read("convex/policyDelivery.ts")).toContain("policy.deletedAt");
  });
});
