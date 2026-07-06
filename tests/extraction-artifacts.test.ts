import { describe, expect, it } from "vitest";
import { getDocumentSize } from "convex/values";
import { readFileSync } from "fs";
import { join } from "path";

const read = (path: string) =>
  readFileSync(join(__dirname, "..", path), "utf-8");

describe("policy extraction transient artifacts", () => {
  it("keeps large extraction artifacts in storage-backed artifact records", () => {
    const schema = read("convex/schema.ts");
    const policies = read("convex/policies.ts");
    const extraction = read("convex/actions/policyExtraction.ts");

    expect(schema).toContain("policyExtractionArtifacts: defineTable");
    expect(schema).toContain('v.literal("cl_sdk_checkpoint")');
    expect(schema).toContain('v.literal("embedding_payload")');
    expect(schema).toContain('storageId: v.id("_storage")');
    expect(schema).toContain(
      '.index("by_policyId_kind", ["policyId", "kind"])',
    );

    expect(policies).toContain("pipelineSaveArtifact");
    expect(policies).toContain("clearPolicyExtractionArtifacts");
    expect(policies).toContain('args.status === "complete"');
    expect(policies).toContain('args.error === "Cancelled by user"');

    expect(extraction).toContain("storeJsonArtifact");
    expect(extraction).toContain("pipelineSaveArtifact");
    expect(extraction).toContain('"cl_sdk_checkpoint"');
    expect(extraction).toContain('"embedding_payload"');
    expect(extraction).toContain("getLatestArtifactStorageId");
    expect(extraction).toContain(
      'await clearArtifacts(convexCtx, policyId, "embedding_payload")',
    );
  });

  it("keeps external completion payloads replayable after boundary failures", () => {
    const externalPayload = read("convex/externalExtractionPayload.ts");
    const extraction = read("convex/actions/policyExtraction.ts");
    const worker = read("extraction-worker/src/index.ts");

    expect(externalPayload).toContain("appendPayloadSavedLog");
    expect(externalPayload).toContain("pipelineSaveArtifact");
    expect(externalPayload).toContain("logSaved: false");

    expect(extraction).toContain("completeExternalExtractFromStoredPayload");
    expect(extraction).toContain("externalCompletionLeaseIsCurrent");
    expect(extraction).toContain('"external_completion_payload"');
    expect(extraction).toContain("hasReplayableCompletionPayload");
    expect(extraction).toContain('status: "running"');

    expect(worker).toContain("completeExternalExtractFromStoredPayload");
    expect(worker).toContain("Replayed stored completion payload");
  });

  it("represents a large pending embedding checkpoint as a compact storage pointer", () => {
    const largeText = "x".repeat(1_100_000);
    const inlineCheckpoint = {
      nextPhase: "embed_and_store",
      state: {
        sourceKind: "upload",
        orgId: "org",
        userId: "user",
        documentChunksForEmbedding: [
          { id: "chunk-1", type: "coverage", text: largeText, metadata: {} },
        ],
      },
      createdAt: 1,
    };
    const compactCheckpoint = {
      nextPhase: "embed_and_store",
      state: {
        sourceKind: "upload",
        orgId: "org",
        userId: "user",
        embeddingPayloadFileId: "storage-id",
        chunkIds: ["chunk-1"],
      },
      createdAt: 1,
    };

    expect(getDocumentSize(inlineCheckpoint)).toBeGreaterThan(1_048_576);
    expect(getDocumentSize(compactCheckpoint)).toBeLessThan(1_000);
  });

  it("reconciles terminal policy extraction runs with running trace sessions", () => {
    const policies = read("convex/policies.ts");
    const traces = read("convex/extractionTraces.ts");
    const extraction = read("convex/actions/policyExtraction.ts");

    expect(policies).toContain("pipelineReconcileTerminalState");
    expect(policies).toContain('status === "complete" || status === "error"');
    expect(policies).toContain("pipelineCheckpoint: undefined");

    expect(traces).toContain("reconcileTerminalPolicy");
    expect(traces).toContain("reconcileTerminalRunningSessions");
    expect(traces).toContain("Extraction trace reconciled from terminal pipeline status");
    expect(traces).toContain('if (status === "complete")');
    expect(traces).toContain("patch.error = undefined");

    expect(extraction).toContain("pipelineReconcileTerminalState");
    expect(extraction).toContain("reconcileTerminalPolicy");
    expect(extraction).toContain("reconcileTerminalRunningSessions");
  });
});
