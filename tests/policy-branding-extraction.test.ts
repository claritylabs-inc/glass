import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("policy carrier branding ownership", () => {
  it("persists branding in terminal extraction instead of policy-page reads", () => {
    const extraction = read("convex/actions/policyExtraction.ts");
    const policyPage = read("app/policies/page.tsx");
    const carrierIdentityAction = read(
      "convex/actions/enrichCarrierIdentity.ts",
    );

    expect(extraction).toMatch(
      /await convexCtx\.runAction\(\s*internal\.actions\.enrichCarrierIdentity\.ensureInternal/,
    );
    expect(policyPage).not.toContain("enrichCarrierIdentity");
    expect(policyPage).not.toContain("CARRIER_IDENTITY_ENRICHMENT_VERSION");
    expect(carrierIdentityAction).not.toContain("export const ensure = action");
  });
});
