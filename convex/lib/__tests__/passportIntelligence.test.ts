import { describe, it, expect } from "vitest";
import {
  fieldToIntelligenceCategory,
  buildPassportFact,
  getRequiredSections,
} from "../passportIntelligence";

describe("fieldToIntelligenceCategory", () => {
  it("maps legalName to company_info", () => {
    expect(fieldToIntelligenceCategory("legalName")).toBe("company_info");
  });
  it("maps annualRevenue to financial", () => {
    expect(fieldToIntelligenceCategory("annualRevenue")).toBe("financial");
  });
  it("maps numberOfEmployees to employees", () => {
    expect(fieldToIntelligenceCategory("numberOfEmployees")).toBe("employees");
  });
  it("maps businessDescription to operations", () => {
    expect(fieldToIntelligenceCategory("businessDescription")).toBe("operations");
  });
  it("maps hasPriorBankruptcy to risk", () => {
    expect(fieldToIntelligenceCategory("hasPriorBankruptcy")).toBe("risk");
  });
  it("falls back to observation for unknown field", () => {
    expect(fieldToIntelligenceCategory("unknownField")).toBe("observation");
  });
});

describe("buildPassportFact", () => {
  it("renders legalName fact", () => {
    expect(buildPassportFact("legalName", "Acme Corp")).toBe(
      "Legal name is Acme Corp"
    );
  });
  it("renders annualRevenue fact", () => {
    expect(buildPassportFact("annualRevenue", "$5M")).toBe("Annual revenue is $5M");
  });
  it("renders numberOfEmployees fact", () => {
    expect(buildPassportFact("numberOfEmployees", "42")).toBe(
      "Number of employees is 42"
    );
  });
});

describe("getRequiredSections", () => {
  const baseClient = { passportRequirementOverrides: undefined } as any;
  const baseBroker = { defaultRequiredPassportSections: undefined } as any;

  it("always includes core 4", () => {
    const result = getRequiredSections(baseClient, baseBroker);
    expect(result).toContain("applicant_info");
    expect(result).toContain("nature_of_business");
    expect(result).toContain("locations");
    expect(result).toContain("general_info");
  });

  it("uses broker default when no client override", () => {
    const broker = { defaultRequiredPassportSections: ["loss_history"] } as any;
    const result = getRequiredSections(baseClient, broker);
    expect(result).toContain("loss_history");
  });

  it("client override replaces broker default", () => {
    const broker = { defaultRequiredPassportSections: ["loss_history"] } as any;
    const client = { passportRequirementOverrides: ["prior_carrier"] } as any;
    const result = getRequiredSections(client, broker);
    expect(result).toContain("prior_carrier");
    expect(result).not.toContain("loss_history");
  });

  it("empty array override means no extras", () => {
    const broker = { defaultRequiredPassportSections: ["loss_history"] } as any;
    const client = { passportRequirementOverrides: [] } as any;
    const result = getRequiredSections(client, broker);
    expect(result).not.toContain("loss_history");
  });
});
