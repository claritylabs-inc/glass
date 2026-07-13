import { describe, expect, it } from "vitest";
import { resolvePolicyPartyContext } from "../convex/lib/policyPartyContext";

describe("policy party context", () => {
  it("materializes historical compatibility parties without using client profile data", () => {
    const context = resolvePolicyPartyContext({
      insuredName: "Compatibility Client",
      insuredAddress: { street1: "1 Client St", city: "Toronto", state: "ON" },
      producer: {
        agencyName: "Compatibility Broker",
        address: { street1: "2 Broker St", city: "Toronto", state: "ON" },
      },
      insurer: {
        legalName: "Compatibility Carrier",
        address: { street1: "3 Carrier St", city: "Toronto", state: "ON" },
        documentNodeId: "node-carrier",
      },
      mga: "Compatibility General Agent",
    }, {
      clientProfileFacts: {
        mailingAddress: { value: { street1: "Profile Client St" } },
      },
    });

    expect(context.insuredAddress).toMatchObject({ street1: "1 Client St" });
    expect(context.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "producer", name: "Compatibility Broker" }),
      expect.objectContaining({
        role: "insurer",
        name: "Compatibility Carrier",
        sourceNodeIds: ["node-carrier"],
      }),
      expect.objectContaining({ role: "general_agent", name: "Compatibility General Agent" }),
    ]));
    expect(JSON.stringify(context.parties)).not.toContain("Profile Client St");
  });

  it("uses structured policy parties before compatibility and legacy fields", () => {
    const context = resolvePolicyPartyContext({
      producer: { agencyName: "Compatibility Broker" },
      insurer: { legalName: "Compatibility Carrier" },
      operationalProfile: {
        parties: [
          { role: "broker", name: "Structured Producer", address: { street1: "10 Source St" } },
          { role: "carrier", name: "Structured Carrier", address: { street1: "20 Source St" } },
        ],
      },
      declarations: {
        fields: [
          { field: "producerName", value: "Legacy Broker" },
          { field: "insurerName", value: "Legacy Carrier" },
        ],
      },
    });

    expect(context.producerName).toBe("Structured Producer");
    expect(context.insurerName).toBe("Structured Carrier");
    expect(context.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "producer", name: "Structured Producer" }),
    ]));
    expect(context.parties.some((party) => party.role === "broker")).toBe(false);
  });

  it("ignores legacy manual overrides and keeps policy parties extraction-backed", () => {
    const context = resolvePolicyPartyContext({
      policyProfileOverrides: {
        insuredName: "Legacy Edited Insured",
        insuredAddress: { street1: "4 Edited Insured Way" },
        producer: {
          name: "Edited Broker",
          contactName: "Pat Producer",
          phone: "+1 555 0100",
          email: "pat@example.com",
          address: { street1: "1 Edited Broker Way", country: "Canada" },
        },
        insurer: {
          name: "Edited Carrier",
          address: { street1: "2 Edited Carrier Way" },
        },
        mga: {
          name: "Edited General Agent",
          address: { street1: "3 Edited General Agent Way" },
        },
        operationsDescription: "Edited policy operations",
        additionalNamedInsureds: ["Edited Subsidiary"],
      },
      operationalProfile: {
        parties: [
          { role: "producer", name: "Extracted Broker", address: { street1: "Old Broker" } },
          { role: "carrier", name: "Extracted Carrier", address: { street1: "Old Carrier" } },
          { role: "general_agent", name: "Extracted General Agent", address: { street1: "Old General Agent" } },
          { role: "named_insured", name: "Extracted Insured", address: { street1: "Extracted Insured Way" } },
        ],
        operationsDescription: { value: "Extracted policy operations" },
      },
      additionalNamedInsureds: ["Extracted Subsidiary"],
    }, {
      clientProfileFacts: {
        mailingAddress: { value: { street1: "Client Only" } },
      },
    });

    expect(context).toMatchObject({
      producerName: "Extracted Broker",
      insuredName: "Extracted Insured",
      insuredAddress: { street1: "Extracted Insured Way" },
      insurerName: "Extracted Carrier",
      generalAgentName: "Extracted General Agent",
      operationsDescription: "Extracted policy operations",
      additionalNamedInsureds: ["Extracted Subsidiary"],
    });
    expect(context.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "producer", name: "Extracted Broker" }),
      expect.objectContaining({ role: "carrier", name: "Extracted Carrier" }),
      expect.objectContaining({ role: "general_agent", name: "Extracted General Agent" }),
    ]));
    expect(JSON.stringify(context)).not.toContain("Legacy Edited Insured");
    expect(JSON.stringify(context.parties)).not.toContain("Client Only");
  });

  it("uses broker-authored policy detail overrides without mutating extracted provenance", () => {
    const context = resolvePolicyPartyContext({
      policyDetailOverrides: {
        operationsDescription: "Edited policy operations",
        insured: {
          name: "Edited Insured",
          address: { street1: "4 Edited Insured Way" },
          additionalNamedInsureds: ["Edited Subsidiary"],
        },
        producer: {
          name: "Edited Broker",
          contactName: "Pat Producer",
          licenseNumber: "PR-123",
          phone: "+12025550100",
          email: "pat@example.com",
          address: { street1: "1 Edited Broker Way" },
        },
        insurer: {
          name: "Edited Carrier",
          naicNumber: "16823",
          address: { street1: "2 Edited Carrier Way" },
        },
        generalAgent: {
          name: "Edited General Agent",
          licenseNumber: "21058436",
          address: { street1: "3 Edited General Agent Way" },
        },
      },
      operationalProfile: {
        parties: [
          {
            role: "producer",
            name: "Extracted Broker",
            licenseNumber: "OLD-PRODUCER",
            address: { street1: "Old Broker" },
            sourceNodeIds: ["producer-source"],
          },
          {
            role: "carrier",
            name: "Extracted Carrier",
            naicNumber: "99999",
            address: { street1: "Old Carrier" },
            sourceNodeIds: ["carrier-source"],
          },
          {
            role: "general_agent",
            name: "Extracted General Agent",
            licenseNumber: "OLD-GA",
            address: { street1: "Old General Agent" },
            sourceNodeIds: ["general-agent-source"],
          },
          {
            role: "named_insured",
            name: "Extracted Insured",
            address: { street1: "Old Insured" },
            sourceNodeIds: ["insured-source"],
          },
        ],
        operationsDescription: { value: "Extracted policy operations" },
      },
    });

    expect(context).toMatchObject({
      insuredName: "Edited Insured",
      insuredAddress: { street1: "4 Edited Insured Way" },
      additionalNamedInsureds: ["Edited Subsidiary"],
      producerName: "Edited Broker",
      producerContactName: "Pat Producer",
      producerPhone: "+12025550100",
      producerEmail: "pat@example.com",
      producerLicenseNumber: "PR-123",
      insurerName: "Edited Carrier",
      insurerNaicNumber: "16823",
      generalAgentName: "Edited General Agent",
      generalAgentLicenseNumber: "21058436",
      operationsDescription: "Edited policy operations",
    });
    expect(context.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "producer",
        name: "Edited Broker",
        sourceNodeIds: [],
      }),
      expect.objectContaining({
        role: "insurer",
        name: "Edited Carrier",
        sourceNodeIds: [],
      }),
      expect.objectContaining({
        role: "general_agent",
        name: "Edited General Agent",
        licenseNumber: "21058436",
        sourceNodeIds: [],
      }),
    ]));
    expect(JSON.stringify(context.parties)).not.toContain("Extracted Broker");
    expect(JSON.stringify(context.parties)).not.toContain("producer-source");
  });

  it("does not copy identifiers across different party identities", () => {
    const context = resolvePolicyPartyContext({
      insurer: { legalName: "Fortegra Specialty Insurance Company", naicNumber: "16823" },
      producer: { agencyName: "Unrelated Producer", licenseNumber: "PR-999" },
      generalAgent: {
        agencyName: "Diesel Insurance Solutions Inc.",
        licenseNumber: "21058436",
      },
      operationalProfile: {
        parties: [
          { role: "insurer", name: "Different Insurer", naicNumber: "11111" },
          { role: "general_agent", name: "Different General Agent", licenseNumber: "GA-OTHER" },
        ],
      },
    });

    expect(context.insurerName).toBe("Different Insurer");
    expect(context.insurerNaicNumber).toBe("11111");
    expect(context.generalAgentName).toBe("Different General Agent");
    expect(context.generalAgentLicenseNumber).toBe("GA-OTHER");
    expect(context.producerLicenseNumber).toBe("PR-999");
    expect(context.insurerNaicNumber).not.toBe("16823");
    expect(context.generalAgentLicenseNumber).not.toBe("21058436");
  });
});
