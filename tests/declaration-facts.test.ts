import { describe, expect, it } from "vitest";
import {
  extractDeclarationFactsFromPolicy,
  normalizeDeclarationValue,
} from "../convex/lib/declarationFacts";

describe("declaration facts", () => {
  it("normalizes comparable declaration values", () => {
    expect(normalizeDeclarationValue("Acme, Incorporated")).toBe("acme inc");
    expect(normalizeDeclarationValue("$1,000,000", "money")).toBe("1000000");
  });

  it("extracts top-level and declaration facts from a policy", () => {
    const facts = extractDeclarationFactsFromPolicy({
      _id: "policy1",
      orgId: "org1",
      insuredName: "Acme Inc.",
      policyNumber: "GL-123",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      declarations: {
        mailingAddress: "123 Main St, New York, NY",
        locations: [{ address: "500 Market St", city: "San Francisco", state: "CA" }],
      },
      coverages: [{ name: "General Liability", limit: "$1,000,000", limitAmount: 1000000 }],
    });

    expect(facts.map((fact) => fact.fieldGroup)).toContain("insured_identity");
    expect(facts.map((fact) => fact.fieldGroup)).toContain("mailing_address");
    expect(facts.map((fact) => fact.fieldGroup)).toContain("scheduled_location");
    expect(facts.map((fact) => fact.fieldGroup)).toContain("coverage_limit:general liability");
  });

});
