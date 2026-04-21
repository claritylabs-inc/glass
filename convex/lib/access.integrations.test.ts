import { describe, it, expect } from "vitest";
import {
  assertCanReadIntegrationsList,
  assertCanConnectIntegration,
  assertCanDisconnectIntegration,
  assertCanRequestIntegration,
  assertCanReadRawIntegrationData,
} from "./access";
import type { OrgAccess } from "./access";

function makeAccess(overrides: Partial<OrgAccess>): OrgAccess {
  return {
    userId: "u1" as OrgAccess["userId"],
    org: { _id: "o1", name: "Test", type: "client" } as OrgAccess["org"],
    orgType: "client",
    accessType: "member",
    role: "member",
    brokerOrgId: undefined,
    ...overrides,
  };
}

describe("assertCanReadIntegrationsList", () => {
  it("allows member", () => {
    expect(() => assertCanReadIntegrationsList(makeAccess({}))).not.toThrow();
  });
  it("allows broker_of_client", () => {
    expect(() =>
      assertCanReadIntegrationsList(
        makeAccess({ accessType: "broker_of_client", brokerOrgId: "b1" as OrgAccess["brokerOrgId"] }),
      ),
    ).not.toThrow();
  });
});

describe("assertCanConnectIntegration", () => {
  it("allows member", () => {
    expect(() => assertCanConnectIntegration(makeAccess({}))).not.toThrow();
  });
  it("throws for broker_of_client", () => {
    expect(() =>
      assertCanConnectIntegration(
        makeAccess({ accessType: "broker_of_client", brokerOrgId: "b1" as OrgAccess["brokerOrgId"] }),
      ),
    ).toThrow("Only org members");
  });
});

describe("assertCanDisconnectIntegration", () => {
  it("allows member", () => {
    expect(() => assertCanDisconnectIntegration(makeAccess({}))).not.toThrow();
  });
  it("throws for broker_of_client", () => {
    expect(() =>
      assertCanDisconnectIntegration(
        makeAccess({ accessType: "broker_of_client", brokerOrgId: "b1" as OrgAccess["brokerOrgId"] }),
      ),
    ).toThrow("Only org members");
  });
});

describe("assertCanRequestIntegration", () => {
  it("allows broker_of_client", () => {
    expect(() =>
      assertCanRequestIntegration(
        makeAccess({ accessType: "broker_of_client", brokerOrgId: "b1" as OrgAccess["brokerOrgId"] }),
      ),
    ).not.toThrow();
  });
  it("throws for member", () => {
    expect(() => assertCanRequestIntegration(makeAccess({}))).toThrow("broker");
  });
});

describe("assertCanReadRawIntegrationData", () => {
  it("allows member", () => {
    expect(() => assertCanReadRawIntegrationData(makeAccess({}))).not.toThrow();
  });
  it("throws for broker_of_client", () => {
    expect(() =>
      assertCanReadRawIntegrationData(
        makeAccess({ accessType: "broker_of_client", brokerOrgId: "b1" as OrgAccess["brokerOrgId"] }),
      ),
    ).toThrow("restricted to org members");
  });
});
