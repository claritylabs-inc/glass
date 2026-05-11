import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { policyToCoiData } from "../convex/lib/coiGenerator";

const ROOT = join(__dirname, "..");

describe("policyToCoiData", () => {
  it("uses explicit policy type for the certificate title and coverage row", () => {
    const data = policyToCoiData({
      policyTypes: ["travel"],
      policyNumber: "WES0000518111",
      effectiveDate: "05/05/2026",
      expirationDate: "05/16/2026",
      carrier: "CUMIS General Insurance Company",
      producer: { agencyName: "Allianz Global Assistance" },
      limits: { combinedSingleLimit: "$1,000,000" },
      insuredName: "Terrence Wang",
    });

    expect(data.title).toBe("CERTIFICATE OF TRAVEL INSURANCE");
    expect(data.coverages).toHaveLength(1);
    expect(data.coverages[0]?.type).toBe("Travel");
  });

  it("keeps broker user information out of the producer box", () => {
    const data = policyToCoiData({
      policyTypes: ["travel"],
      brokerAgency: "Allianz Global Assistance",
      brokerContactName: "Terrence Wang",
      underwriter: "Allianz Travel Underwriting",
      policyNumber: "WES0000518111",
      effectiveDate: "05/05/2026",
      expirationDate: "05/16/2026",
      carrier: "CUMIS General Insurance Company",
      insuredName: "Terrence Wang",
    });

    expect(data.producerAgency).toBe("Allianz Global Assistance");
    expect(data.producerContact).toBe("Allianz Travel Underwriting");
  });
});

describe("COI PDF footer copy", () => {
  it("uses Glass attribution without ACORD marks or the old website", () => {
    const source = readFileSync(join(ROOT, "convex/lib/coiGenerator.ts"), "utf-8");

    expect(source).toContain("Generated using Glass from Clarity Labs");
    expect(source).not.toContain("ACORD 25 (2016/03)  |  Generated");
    expect(source).not.toContain("claritylabs.dev");
  });
});
