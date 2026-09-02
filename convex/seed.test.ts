/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { encode } from "fast-png";
import { afterEach, describe, expect, test, vi } from "vitest";
const { dnsLookupMock, undiciFetchMock } = vi.hoisted(() => ({
  dnsLookupMock: vi.fn(),
  undiciFetchMock: vi.fn(),
}));
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return { ...actual, lookup: dnsLookupMock };
});
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: undiciFetchMock };
});
import schema from "./schema";
import { insertLocalFixture, seed } from "./seed";
import { listForClient as listPoliciesForClient } from "./policies";
import { current as currentOperator } from "./operator";

const modules = import.meta.glob("./**/*.ts");
const insertLocalFixtureFn = insertLocalFixture as any;
const seedFn = seed as any;
const listPoliciesForClientFn = listPoliciesForClient as any;
const currentOperatorFn = currentOperator as any;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  dnsLookupMock.mockReset();
  undiciFetchMock.mockReset();
});

describe("local workspace seed", () => {
  test("creates a usable operator, broker, client, and policy idempotently", async () => {
    const t = convexTest(schema, modules);
    const legacy = await t.run(async (ctx) => {
      const brokerUserId = await ctx.db.insert("users", {
        email: "terry@releaserent.com",
        name: "Terry Wang",
        accountKind: "customer",
      });
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "ReLease",
        type: "broker",
        slug: "release",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: brokerUserId,
        role: "admin",
      });
      return { brokerUserId, brokerOrgId };
    });

    const first = await t.mutation(insertLocalFixtureFn, {});
    const second = await t.mutation(insertLocalFixtureFn, {});

    expect(second).toMatchObject({
      operatorUserId: first.operatorUserId,
      brokerUserId: first.brokerUserId,
      clientUserId: first.clientUserId,
      brokerOrgId: first.brokerOrgId,
      clientOrgId: first.clientOrgId,
      policyId: first.policyId,
      brokerPhone: "+16472921666",
      clientPhone: "+12025550102",
    });
    expect(first).toMatchObject({
      brokerUserId: legacy.brokerUserId,
      brokerOrgId: legacy.brokerOrgId,
    });

    const fixture = await t.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      organizations: await ctx.db.query("organizations").collect(),
      memberships: await ctx.db.query("orgMemberships").collect(),
      operatorProfiles: await ctx.db.query("operatorProfiles").collect(),
      assignments: await ctx.db.query("brokerClientAssignments").collect(),
      brokerProfiles: await ctx.db.query("brokerProfiles").collect(),
      policies: await ctx.db.query("policies").collect(),
      declarationFacts: await ctx.db.query("policyDeclarationFacts").collect(),
    }));

    expect(fixture.users).toHaveLength(3);
    expect(fixture.organizations).toHaveLength(2);
    expect(fixture.memberships).toHaveLength(2);
    expect(fixture.operatorProfiles).toHaveLength(1);
    expect(fixture.assignments).toHaveLength(0);
    expect(fixture.brokerProfiles).toHaveLength(1);
    expect(fixture.policies).toHaveLength(1);

    expect(
      fixture.users.find((user) => user.email === "terry@claritylabs.inc"),
    ).toMatchObject({ accountKind: "operator", onboardingComplete: true });
    expect(
      fixture.users.find((user) => user.email === "terry@montgomeryrisk.com"),
    ).toMatchObject({
      accountKind: "customer",
      onboardingComplete: true,
      phone: "+16472921666",
    });
    expect(
      fixture.users.find((user) => user.email === "adyan@cove.dev"),
    ).toMatchObject({
      accountKind: "customer",
      onboardingComplete: true,
      phone: "+12025550102",
    });
    expect(fixture.operatorProfiles[0]).toMatchObject({
      email: "terry@claritylabs.inc",
      role: "operator",
      status: "active",
    });

    const broker = fixture.organizations.find((org) => org.type === "broker");
    const client = fixture.organizations.find((org) => org.type === "client");
    expect(broker).toMatchObject({
      name: "Montgomery Risk",
      slug: "montgomery-risk",
      website: "https://montgomeryrisk.com",
    });
    expect(client).toMatchObject({ name: "Cove" });
    expect(client?.brokerOrgId).toBeUndefined();
    expect(fixture.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orgId: broker?._id, role: "admin" }),
        expect.objectContaining({ orgId: client?._id, role: "admin" }),
      ]),
    );
    expect(fixture.brokerProfiles[0]).toMatchObject({
      brokerOrgId: broker?._id,
      networkStatus: "active",
      writingStates: ["CA", "NY", "TX"],
      lineOfBusinessCodes: ["CYBER", "EO", "OLIB"],
    });
    expect(fixture.policies[0]).toMatchObject({
      orgId: client?._id,
      policyNumber: "NWC-TEC-3110-26-01",
      broker: "Montgomery Risk",
      pipelineStatus: "complete",
      extractionDataStage: "final",
      insuredAddress: {
        street1: "111 Richmond Street West",
        city: "Toronto",
      },
      producer: {
        agencyName: "Montgomery Risk",
        address: { street1: "161 Bay Street" },
      },
      insurer: {
        legalName: "Northwoods Continental Insurance Company",
        address: { street1: "200 Front Street West" },
      },
      generalAgent: {
        agencyName: "Highland Risk Services",
        address: { street1: "100 King Street West" },
      },
    });
    expect(client?.profileFacts).toMatchObject({
      namedInsured: { value: "Cove Technologies Inc." },
      mailingAddress: { value: { street1: "111 Richmond Street West" } },
      operationsDescription: {
        value:
          "Technology company providing underwriting, credit, and workflow software for housing and finance professionals.",
      },
    });
    expect(client?.profileFacts).not.toHaveProperty("producer");
    expect(client?.profileFacts).not.toHaveProperty("insurer");
    expect(client?.profileFacts).not.toHaveProperty("mga");
    expect(client?.profileFacts).not.toHaveProperty("insuranceParties");
    expect(
      fixture.declarationFacts.some(
        (fact) => fact.fieldGroup === "operations_description",
      ),
    ).toBe(true);

    const operatorSession = t.withIdentity({
      subject: `${first.operatorUserId}|session`,
    });
    const clientSession = t.withIdentity({
      subject: `${first.clientUserId}|session`,
    });
    await expect(
      operatorSession.query(currentOperatorFn, {}),
    ).resolves.toMatchObject({
      user: { email: "terry@claritylabs.inc" },
      profile: { role: "operator", status: "active" },
    });
    await expect(
      clientSession.query(listPoliciesForClientFn, { documentType: "policy" }),
    ).resolves.toEqual([
      expect.objectContaining({ policyNumber: "NWC-TEC-3110-26-01" }),
    ]);
  });

  test("stores Montgomery Risk and Cove favicons during the full seed action", async () => {
    vi.stubEnv("SPOT_ENV", "local");
    const fetchedUrls: string[] = [];
    const favicon = encode({
      width: 2,
      height: 2,
      channels: 4,
      depth: 8,
      data: new Uint8Array([
        20, 52, 203, 255, 20, 52, 203, 255, 20, 52, 203, 255, 20, 52, 203, 255,
      ]),
    });
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    undiciFetchMock.mockImplementation(
      async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        fetchedUrls.push(url);
        if (url.endsWith("/favicon.png")) {
          const body = favicon.buffer.slice(
            favicon.byteOffset,
            favicon.byteOffset + favicon.byteLength,
          ) as ArrayBuffer;
          return new Response(body, {
            headers: { "content-type": "image/png" },
          });
        }
        return new Response('<link rel="icon" href="/favicon.png">', {
          headers: { "content-type": "text/html" },
        });
      },
    );

    const t = convexTest(schema, modules);
    await t.action(seedFn, {});

    const organizations = await t.run(async (ctx) =>
      ctx.db.query("organizations").collect(),
    );
    const broker = organizations.find((org) => org.name === "Montgomery Risk");
    const client = organizations.find((org) => org.name === "Cove");
    expect(broker).toMatchObject({
      iconStorageId: expect.any(String),
    });
    expect(client).toMatchObject({ iconStorageId: expect.any(String) });
    expect(client?.iconStorageId).not.toBe(broker?.iconStorageId);
    expect(fetchedUrls).toEqual(
      expect.arrayContaining([
        "https://montgomeryrisk.com/",
        "https://montgomeryrisk.com/favicon.png",
        "https://cove.dev/",
        "https://cove.dev/favicon.png",
      ]),
    );
  });
});
