import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveApplicationIntakeStartIntent } from "../convex/lib/applicationIntakeIntent";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("application intake intent", () => {
  it("detects clear client application and quote starts", () => {
    const apply = resolveApplicationIntakeStartIntent(
      "Can I apply for a new commercial auto policy",
    );
    expect(apply).toMatchObject({
      title: "Commercial Auto Application",
      lineOfBusiness: "commercial auto",
      applicationType: "commercial auto",
    });
    expect(apply?.missingQuestions.map((q) => q.fieldId)).toEqual([
      "coverage_goal",
      "vehicle_schedule",
      "driver_information",
      "target_effective_date",
    ]);

    const quote = resolveApplicationIntakeStartIntent(
      "Hi can you help me with a new commercial auto insurance quote",
    );
    expect(quote?.lineOfBusiness).toBe("commercial auto");
  });

  it("does not treat policy details, delivery, or endorsement requests as intake starts", () => {
    for (const text of [
      "Can you get me the details of my cyber policy",
      "Can I see the full details",
      "We need to update our E&O policy",
      "Add Adyan Tanver as an additional insured",
      "Can you send me the policy PDF?",
      "Can you send me a new copy of the cyber policy?",
      "/new",
    ]) {
      expect(resolveApplicationIntakeStartIntent(text), text).toBeNull();
    }
  });

  it("runs the iMessage intake start guard before task control and model generation", () => {
    const inbound = read("convex/actions/handleInboundImessage.ts");
    const controls = read("convex/lib/imessageDeterministicControls.ts");
    const emailControlGate = controls.indexOf("const emailControl =");
    const applicationGate = controls.indexOf("const applicationStartIntent");
    const taskControlGate = controls.indexOf("const taskControlIntent");

    expect(inbound).toContain("const userMessageId = await ctx.runMutation");
    expect(inbound).toContain("userMessageId,");
    expect(controls).toContain("resolveApplicationIntakeStartIntent");
    expect(controls).toContain("internal.applicationIntakes.startFromAgent");
    expect(controls).toContain('usedTools: ["start_application_intake"]');
    expect(applicationGate).toBeGreaterThan(emailControlGate);
    expect(applicationGate).toBeLessThan(taskControlGate);
  });
});
