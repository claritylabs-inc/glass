/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Logo discovery is the only network dependency of the local seed.
vi.mock("./actions/extractCompanyInfo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./actions/extractCompanyInfo")>();
  const { internalAction } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    importOrgLogoForOrgInternal: internalAction({
      args: { orgId: v.id("organizations"), url: v.string() },
      handler: async () => ({ success: true }),
    }),
  };
});

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SPOT_ENV", "local");
  vi.stubEnv("SLACK_MODE", "mock");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.action(api.seed.seed, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, ids };
}

test("seeds a usable renewal with private market data and grounded documents", async () => {
  const { t, ids } = await fixture();
  const requestId = ids.requestId!;
  const operator = t.withIdentity({ subject: `${ids.operatorUserId}|session` });
  const client = t.withIdentity({ subject: `${ids.clientUserId}|session` });
  const broker = t.withIdentity({ subject: `${ids.brokerUserId}|session` });
  const request = await client.query(api.clientProcurementRequests.get, {
    requestId,
  });
  expect(request).not.toHaveProperty("outreaches");
  expect(request).not.toHaveProperty("proposals");
  expect(JSON.stringify(request)).not.toContain("Internal QA note");
  expect(JSON.stringify(request)).not.toContain("51,000");
  await expect(
    client.query(api.procurementProposals.get, { proposalId: ids.proposalId! }),
  ).rejects.toThrow();
  await expect(
    broker.query(api.clientProcurementRequests.get, { requestId }),
  ).rejects.toThrow();
  await expect(
    broker.query(api.procurementProposals.get, { proposalId: ids.proposalId! }),
  ).rejects.toThrow();
  await expect(
    client.query(api.operatorAgent.listThreads, {}),
  ).rejects.toThrow();
  expect(await operator.query(api.operatorAgent.listThreads, {})).toHaveLength(
    1,
  );

  await t.run(async (ctx) => {
    expect((await ctx.db.get(ids.clientOrgId))?.brokerOrgId).toBeUndefined();
    expect(
      await ctx.db.query("brokerClientAssignments").collect(),
    ).toHaveLength(0);
    const policy = await ctx.db.get(ids.policyId);
    expect(policy?.uploadedBySide).toBe("operator");
    expect(
      policy?.coverages?.find((coverage) => coverage.name.includes("Cyber"))
        ?.lineOfBusiness,
    ).toBe("CYBER");
    const spans = await ctx.db.query("sourceSpans").collect();
    const nodes = await ctx.db.query("sourceNodes").collect();
    for (const spanId of policy?.operationalProfile.sourceSpanIds ?? []) {
      expect(spans.some((span) => span.spanId === spanId)).toBe(true);
    }
    for (const nodeId of policy?.operationalProfile.sourceNodeIds ?? []) {
      expect(nodes.some((node) => node.nodeId === nodeId)).toBe(true);
    }
    const files = await ctx.db.query("clientFiles").collect();
    expect(files).toHaveLength(4);
    expect(files.filter((file) => file.archivedAt)).toHaveLength(1);
    for (const file of files) {
      const blob = await ctx.storage.get(file.fileId);
      const pdf = await PDFDocument.load(await blob!.arrayBuffer());
      expect(pdf.getPageCount()).toBe(1);
    }
    const proposal = await ctx.db.get(ids.proposalId!);
    const review = await ctx.db.query("procurementProposalReviews").first();
    const storedRequest = await ctx.db.get(requestId);
    expect(review?.packetRevision).toBe(storedRequest?.packetRevision);
    expect(review?.extractionFingerprint).toBe(proposal?.extractionFingerprint);
    expect(review?.modelConclusion).toBe("has_gaps");
    expect(review?.confirmedAt).toBeUndefined();
    expect(proposal?.selectedAt).toBeUndefined();
    const document = await ctx.db.query("procurementProposalDocuments").first();
    expect(
      files.find((file) => file._id === document?.clientFileId)?.clientVisible,
    ).toBe(false);
    const links = await ctx.db.query("procurementPacketLinks").collect();
    expect(links).toHaveLength(1);
    expect(links[0].packetRevisionAtIssue).toBe(storedRequest?.packetRevision);
    expect(
      links[0].sectionSnapshot?.map((section) => section.key),
    ).not.toContain("market_strategy");
    expect(
      links[0].sectionSnapshot?.map((section) => section.key),
    ).not.toContain("client_contacts");
    expect(links[0].artifactSnapshot).toHaveLength(1);
    expect(links[0].artifactSnapshot?.[0].name).toContain("company profile");
    expect(await ctx.db.query("pendingEmails").collect()).toHaveLength(0);
    expect(
      await ctx.db.query("procurementProposalExtractionJobs").collect(),
    ).toHaveLength(0);
  });
});

test("rerunning setup preserves edited work and reuses records and stored files", async () => {
  const { t, ids } = await fixture();
  const before = await t.run(async (ctx) => {
    await ctx.db.patch(ids.requestId!, {
      title: "Renamed during QA",
      status: "binding",
    });
    await ctx.db.patch(ids.policyId, { premiumAmount: 99_000 });
    const profile = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", ids.brokerOrgId))
      .unique();
    await ctx.db.patch(profile!._id, { networkStatus: "inactive" });
    const wiki = await ctx.db.query("orgWikiSections").first();
    await ctx.db.patch(wiki!._id, { body: "User-edited wiki" });
    const section = await ctx.db.query("procurementPacketSections").first();
    await ctx.db.patch(section!._id, { body: "User-edited packet" });
    const archived = (await ctx.db.query("clientFiles").collect()).find(
      (file) => file.archivedAt,
    )!;
    await ctx.db.patch(archived._id, {
      archivedAt: undefined,
      archivedByUserId: undefined,
    });
    return {
      wikiId: wiki!._id,
      sectionId: section!._id,
      archivedId: archived._id,
      files: await ctx.db.query("clientFiles").collect(),
    };
  });
  const second = await t.action(api.seed.seed, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(second.requestId).toBe(ids.requestId);
  expect(second.proposalId).toBe(ids.proposalId);
  expect(second.operatorThreadId).toBe(ids.operatorThreadId);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("procurementRequests").collect()).toHaveLength(1);
    expect(await ctx.db.query("procurementProposals").collect()).toHaveLength(
      1,
    );
    expect(await ctx.db.query("operatorAgentThreads").collect()).toHaveLength(
      1,
    );
    expect(await ctx.db.query("procurementPacketLinks").collect()).toHaveLength(
      1,
    );
    expect((await ctx.db.get(ids.requestId!))?.title).toBe("Renamed during QA");
    expect((await ctx.db.get(ids.requestId!))?.status).toBe("binding");
    expect((await ctx.db.get(ids.policyId))?.premiumAmount).toBe(99_000);
    expect((await ctx.db.get(before.wikiId))?.body).toBe("User-edited wiki");
    expect((await ctx.db.get(before.sectionId))?.body).toBe(
      "User-edited packet",
    );
    expect((await ctx.db.get(before.archivedId))?.archivedAt).toBeUndefined();
    expect(
      (
        await ctx.db
          .query("brokerProfiles")
          .withIndex("broker", (q) => q.eq("brokerOrgId", ids.brokerOrgId))
          .unique()
      )?.networkStatus,
    ).toBe("inactive");
    expect(
      (await ctx.db.query("clientFiles").collect()).map((file) => file.fileId),
    ).toEqual(before.files.map((file) => file.fileId));
  });
});

test.each(["production", "dev", ""])(
  "rejects seeding and cleanup outside local (%s)",
  async (environment) => {
    vi.stubEnv("SPOT_ENV", environment);
    const t = convexTest(schema, modules);
    await expect(t.action(api.seed.seed, {})).rejects.toThrow("SPOT_ENV=local");
    await expect(
      t.mutation(internal.seed.insertLocalFixture, {}),
    ).rejects.toThrow("SPOT_ENV=local");
    await expect(
      t.mutation(internal.seed.removeLegacyDemoFixture, { dryRun: false }),
    ).rejects.toThrow("SPOT_ENV=local");
    await expect(
      t.mutation(internal.seed.removeLocalVerificationArtifacts, {}),
    ).rejects.toThrow("SPOT_ENV=local");
    expect(
      await t.run((ctx) => ctx.db.query("organizations").collect()),
    ).toHaveLength(0);
  },
);
