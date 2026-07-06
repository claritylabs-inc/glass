/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { updateExtractionInternal, pipelineAppendLog } from "./policies";
import { recordEvent as recordExtractionTraceEvent } from "./extractionTraces";

const modules = import.meta.glob("./**/*.ts");
const updateExtractionInternalFn = updateExtractionInternal as any;
const pipelineAppendLogFn = pipelineAppendLog as any;
const recordExtractionTraceEventFn = recordExtractionTraceEvent as any;
type TestConvex = ReturnType<typeof convexTest>;

async function seedPolicyExtractionRun(t: TestConvex) {
  return await t.run(async (ctx) => {
    const now = 1_780_000_000_000;
    const orgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      carrier: "Carrier",
      policyNumber: "POL-123",
      insuredName: "Client",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      fileName: "policy.pdf",
      policyTypes: ["general_liability"],
      documentType: "policy",
      policyYear: 2026,
      isRenewal: false,
      coverages: [],
    });
    await ctx.db.insert("policyExtractionRuns", {
      policyId,
      pipelineStatus: "running",
      pipelineCheckpoint: {
        nextPhase: "extract",
        state: { traceId: "trace-test" },
        createdAt: now,
      },
      pipelineLog: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("policyExtractionTraceSessions", {
      traceId: "trace-test",
      policyId,
      orgId,
      status: "running",
      startedAt: now,
      lastEventAt: now,
      expiresAt: now + 60_000,
      updatedAt: now,
    });
    return policyId;
  });
}

async function readExtractionRunAndEvents(
  t: TestConvex,
  policyId: string,
) {
  return await t.run(async (ctx) => {
    const runs = await ctx.db.query("policyExtractionRuns").collect();
    const events = (await ctx.db.query("policyExtractionTraceEvents").collect())
      .filter((event) => event.traceId === "trace-test")
      .sort((left, right) => left.timestamp - right.timestamp);
    const run = runs.find((candidate) => candidate.policyId === policyId);
    return { run, events };
  });
}

describe("policies.updateExtractionInternal", () => {
  test("does not let final extraction erase known identity fields with unknown values", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        security: "Known Security",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        broker: "Known Broker",
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        fileName: "known-policy.pdf",
        policyTypes: ["general_liability"],
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [{ name: "Known Coverage", limit: "$1,000,000" }],
        extractionDataStage: "preview",
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        extractionDataStage: "final",
        carrier: "Unknown",
        security: undefined,
        policyNumber: "Unknown",
        insuredName: "Unknown",
        broker: "",
        effectiveDate: undefined,
        expirationDate: "Unknown",
        fileName: "Unknown.pdf",
        coverages: [],
        premium: "$100",
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy).toMatchObject({
      carrier: "Known Carrier",
      security: "Known Security",
      policyNumber: "POL-123",
      insuredName: "Known Insured",
      broker: "Known Broker",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      fileName: "known-policy.pdf",
      coverages: [{ name: "Known Coverage", limit: "$1,000,000" }],
      premium: "$100",
      extractionDataStage: "final",
    });
  });
});

describe("extraction progress logs", () => {
  test("keeps operator-only logs out of the client pipeline log", async () => {
    const t = convexTest(schema, modules);
    const policyId = await seedPolicyExtractionRun(t);

    await t.mutation(pipelineAppendLogFn, {
      jobId: policyId,
      timestamp: 1_780_000_000_100,
      message: "Completion payload sizes: document 631KB, sourceTree 1.1MB",
      phase: "worker",
      level: "info",
      audience: "operator",
    });

    const { run, events } = await readExtractionRunAndEvents(t, policyId);
    expect(run?.pipelineLog).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      kind: "log",
      message: "Completion payload sizes: document 631KB, sourceTree 1.1MB",
      phase: "worker",
    });
  });

  test("stores friendly client copy while preserving technical operator copy", async () => {
    const t = convexTest(schema, modules);
    const policyId = await seedPolicyExtractionRun(t);

    await t.mutation(pipelineAppendLogFn, {
      jobId: policyId,
      timestamp: 1_780_000_000_100,
      message: "External extraction complete. Type: policy. 0 chunks, 1301 source spans.",
      clientMessage: "Policy reading is complete; organizing source-backed details.",
      phase: "extract",
      level: "info",
    });

    const { run, events } = await readExtractionRunAndEvents(t, policyId);
    expect(run?.pipelineLog?.at(-1)).toMatchObject({
      message: "Policy reading is complete; organizing source-backed details.",
      phase: "extract",
    });
    expect(events.at(-1)).toMatchObject({
      kind: "log",
      message: "External extraction complete. Type: policy. 0 chunks, 1301 source spans.",
      phase: "extract",
    });
  });

  test("does not turn operator trace events into client progress logs", async () => {
    const t = convexTest(schema, modules);
    const policyId = await seedPolicyExtractionRun(t);

    await t.mutation(recordExtractionTraceEventFn, {
      traceId: "trace-test",
      kind: "model_call",
      label: "Build source tree: forms, sections, schedules",
      task: "extraction",
      taskKind: "extraction_source_tree",
      provider: "fireworks",
      model: "accounts/fireworks/models/deepseek-v4-flash",
      status: "complete",
      durationMs: 76_000,
      inputTokens: 1000,
      outputTokens: 500,
    });

    const { run, events } = await readExtractionRunAndEvents(t, policyId);
    expect(run?.pipelineLog).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      kind: "model_call",
      label: "Build source tree: forms, sections, schedules",
      taskKind: "extraction_source_tree",
    });
  });
});
