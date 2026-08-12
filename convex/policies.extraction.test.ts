/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  pipelineCompleteLease,
  pipelineSaveArtifact,
  pipelineReconcileTerminalState,
  pipelineRejectExternalJob,
  pipelineSetStatus,
  listForClient,
  promoteCompletedExtractionInternal,
  updateExtractionInternal,
  updatePreviewExtractionInternal,
} from "./policies";
import { policyExtractionRetrySource } from "./actions/policyExtraction";
import {
  buildExtractionCompletionManifest,
  buildPromotionEvidenceLedger,
  buildPromotionSourceCoverageMap,
} from "./lib/extractionPromotion";

const modules = import.meta.glob("./**/*.ts");
const pipelineCompleteLeaseFn = pipelineCompleteLease as any;
const pipelineSaveArtifactFn = pipelineSaveArtifact as any;
const pipelineReconcileTerminalStateFn = pipelineReconcileTerminalState as any;
const pipelineRejectExternalJobFn = pipelineRejectExternalJob as any;
const pipelineSetStatusFn = pipelineSetStatus as any;
const listForClientFn = listForClient as any;
const updateExtractionInternalFn = updateExtractionInternal as any;
const promoteCompletedExtractionInternalFn =
  promoteCompletedExtractionInternal as any;
const updatePreviewExtractionInternalFn =
  updatePreviewExtractionInternal as any;

async function promoteTestPolicy(
  t: ReturnType<typeof convexTest>,
  policyId: any,
  fields: Record<string, unknown>,
) {
  const sourceSpans = [{
    id: "promotion-span",
    documentId: String(policyId),
    sourceKind: "policy_pdf",
    text: "General policy wording retained for promotion testing.",
    pageStart: 1,
    pageEnd: 1,
  }];
  const sourceTree = [{
    id: "promotion-node",
    documentId: String(policyId),
    kind: "text" as const,
    title: "Policy wording",
    description: "Policy wording",
    sourceSpanIds: ["promotion-span"],
    order: 0,
    path: "1",
  }];
  const ledger = buildPromotionEvidenceLedger({ sourceSpans, sourceTree });
  const manifest = buildExtractionCompletionManifest({
    protocolVersion: "source-tree-v1",
    extractorVersion: "test",
    ledger,
  });
  const leaseId = "promotion-lease";
  const ids = await t.run(async (ctx) => {
    const runId = await ctx.db.insert("policyExtractionRuns", {
      policyId,
      pipelineStatus: "running",
      pipelineCheckpoint: {
        nextPhase: "extract",
        state: {},
        createdAt: 1,
        lease: { id: leaseId, phase: "extract", expiresAt: 10_000 },
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob([JSON.stringify({
      sourceSpans,
      sourceTree,
      evidenceLedger: ledger,
      completionManifest: manifest,
    })], { type: "application/json" }));
    const artifactId = await ctx.db.insert("policyExtractionArtifacts", {
      policyId,
      runId,
      kind: "source_bundle",
      storageId,
      sourceFingerprint: ledger.sourceFingerprint,
      extractorVersion: manifest.extractorVersion,
      metadata: {
        evidenceLedgerHash: ledger.ledgerHash,
        manifestHash: manifest.manifestHash,
      },
      createdAt: 1,
      updatedAt: 1,
    });
    return { runId, artifactId };
  });
  return await t.mutation(promoteCompletedExtractionInternalFn, {
    id: policyId,
    runId: ids.runId,
    leaseId,
    sourceBundleArtifactId: ids.artifactId,
    fields,
    evidenceLedger: ledger,
    completionManifest: manifest,
  });
}

describe("policy list extraction visibility", () => {
  test("returns a placeholder row before its extraction run starts", async () => {
    const t = convexTest(schema, modules);
    const { userId, policyId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Client Admin",
        email: "client@example.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Extracting...",
        policyNumber: "Extracting...",
        insuredName: "Extracting...",
        linesOfBusiness: ["UN"],
        effectiveDate: "Extracting...",
        expirationDate: "Extracting...",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        extractionDataStage: "placeholder",
      });
      return { userId, policyId };
    });

    const rows = await t
      .withIdentity({ subject: `${userId}|session` })
      .query(listForClientFn, { documentType: "policy" });

    expect(rows).toEqual([
      expect.objectContaining({
        _id: policyId,
        extractionDataStage: "placeholder",
        pipelineStatus: "idle",
      }),
    ]);
  });
});

describe("policy extraction retry source selection", () => {
  const policy = {
    orgId: "org-active",
    userId: "user-active",
    uploadedByUserId: "uploader-active",
    fileId: "active-policy-file",
    fileName: "active-policy.pdf",
  };
  const existingState = {
    sourceKind: "upload" as const,
    fileId: "staged-replacement-file",
    fileName: "staged-replacement.pdf",
    orgId: "org-active",
    userId: "user-replacement",
    policyFileId: "replacement-policy-file-row",
    policyVersionKind: "re_extraction" as const,
    replacementPromotionStarted: false,
  };

  test("full re-extraction selects the active policy file", () => {
    expect(policyExtractionRetrySource({
      mode: "full",
      policy,
      existingState,
    })).toEqual({
      sourceKind: "upload",
      fileId: "active-policy-file",
      fileName: "active-policy.pdf",
      orgId: "org-active",
      userId: "user-active",
      policyFileId: undefined,
      policyVersionKind: "re_extraction",
      replacementPromotionStarted: false,
    });
  });

  test("resume keeps the staged replacement checkpoint source", () => {
    expect(policyExtractionRetrySource({
      mode: "resume",
      policy,
      existingState,
    })).toEqual(existingState);
  });

  test("restart reseeds the staged replacement file", () => {
    expect(policyExtractionRetrySource({
      mode: "restart",
      policy,
      existingState,
    })).toEqual(existingState);
  });
});

describe("policies.updatePreviewExtractionInternal", () => {
  test("persists the provisional carrier product name", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Unknown",
        policyNumber: "Unknown",
        insuredName: "Unknown",
        linesOfBusiness: ["UN"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        extractionDataStage: "placeholder",
      });
    });

    await expect(t.mutation(updatePreviewExtractionInternalFn, {
      id: policyId,
      fields: {
        programName: "Trip Cancellation & Interruption Plan",
      },
      previewVersion: "preview-test",
    })).resolves.toEqual({ updated: true });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy).toMatchObject({
      programName: "Trip Cancellation & Interruption Plan",
      extractionDataStage: "preview",
      extractionPreviewVersion: "preview-test",
    });
  });
});

describe("policies.updateExtractionInternal", () => {
  test("rejects attempts to set the final stage through the generic writer", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Unknown",
        policyNumber: "Unknown",
        insuredName: "Unknown",
        linesOfBusiness: ["UN"],
        effectiveDate: "Unknown",
        expirationDate: "Unknown",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await expect(t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: { extractionDataStage: "final" },
    })).rejects.toThrow("cannot promote a policy to final");
  });

  test("requires persisted v2 section results before promotion", async () => {
    const t = convexTest(schema, modules);
    const contract = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Unknown",
        policyNumber: "Unknown",
        insuredName: "Unknown",
        linesOfBusiness: ["UN"],
        effectiveDate: "Unknown",
        expirationDate: "Unknown",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
      const sourceSpans = [{
        id: "core-span",
        documentId: String(policyId),
        sourceKind: "policy_pdf",
        text: "Policy Number: GL-200",
        pageStart: 1,
        pageEnd: 1,
      }, {
        id: "coverage-span",
        documentId: String(policyId),
        sourceKind: "policy_pdf",
        text: "Property Coverage Limit $500,000",
        pageStart: 2,
        pageEnd: 2,
      }];
      const sourceTree = sourceSpans.map((span, index) => ({
        id: `node-${index}`,
        documentId: String(policyId),
        kind: "text" as const,
        title: index === 0 ? "Policy number" : "Property coverage",
        description: span.text,
        sourceSpanIds: [span.id],
        order: index,
        path: String(index + 1),
      }));
      const ledger = buildPromotionEvidenceLedger({ sourceSpans, sourceTree });
      const sourceCoverageMap = buildPromotionSourceCoverageMap({
        sourceSpans,
        sourceTree,
      });
      const coreSpanIds = sourceCoverageMap.entries
        .filter((entry) => entry.assignment !== "coverage")
        .map((entry) => entry.sourceSpanId);
      const coverageSpanIds = sourceCoverageMap.entries
        .filter((entry) =>
          entry.assignment === "coverage" || entry.assignment === "both")
        .map((entry) => entry.sourceSpanId);
      const sections = [{
        id: "extraction_policy_core" as const,
        status: "complete" as const,
        sourceSpanIds: coreSpanIds,
        resultHash: "core-result-hash",
      }, {
        id: "extraction_policy_coverage" as const,
        status: "complete" as const,
        sourceSpanIds: coverageSpanIds,
        resultHash: "coverage-result-hash",
      }, {
        id: "extraction_coverage_cleanup" as const,
        status: "complete" as const,
        sourceSpanIds: coverageSpanIds,
        resultHash: "cleanup-result-hash",
      }];
      const manifest = buildExtractionCompletionManifest({
        protocolVersion: "source-tree-v2",
        extractorVersion: "test-v2",
        ledger,
        sourceCoverageMap,
        sections,
      });
      const leaseId = "v2-promotion-lease";
      const runId = await ctx.db.insert("policyExtractionRuns", {
        policyId,
        pipelineStatus: "running",
        pipelineCheckpoint: {
          nextPhase: "extract",
          state: {},
          createdAt: 1,
          lease: { id: leaseId, phase: "extract", expiresAt: 10_000 },
        },
        createdAt: 1,
        updatedAt: 1,
      });
      const sourceStorageId = await ctx.storage.store(new Blob(["source"]));
      const sourceBundleArtifactId = await ctx.db.insert(
        "policyExtractionArtifacts",
        {
          policyId,
          runId,
          kind: "source_bundle",
          storageId: sourceStorageId,
          sourceFingerprint: ledger.sourceFingerprint,
          extractorVersion: manifest.extractorVersion,
          metadata: {
            evidenceLedgerHash: ledger.ledgerHash,
            manifestHash: manifest.manifestHash,
          },
          createdAt: 1,
          updatedAt: 1,
        },
      );
      return {
        policyId,
        runId,
        leaseId,
        sourceBundleArtifactId,
        ledger,
        manifest,
        sections,
      };
    });
    const fields = {
      operationalProfile: {
        policyNumber: {
          value: "GL-200",
          sourceSpanIds: ["core-span"],
        },
        coverages: [{
          name: "Property",
          sourceSpanIds: ["coverage-span"],
        }],
      },
    };
    const promote = () => t.mutation(promoteCompletedExtractionInternalFn, {
      id: contract.policyId,
      runId: contract.runId,
      leaseId: contract.leaseId,
      sourceBundleArtifactId: contract.sourceBundleArtifactId,
      fields,
      evidenceLedger: contract.ledger,
      completionManifest: contract.manifest,
    });

    await expect(promote()).rejects.toThrow(
      "requires the persisted extraction_policy_core result",
    );

    await t.run(async (ctx) => {
      for (const section of contract.sections) {
        const storageId = await ctx.storage.store(new Blob([section.resultHash]));
        await ctx.db.insert("policyExtractionArtifacts", {
          policyId: contract.policyId,
          runId: contract.runId,
          kind: "section_result",
          storageId,
          sourceFingerprint: contract.ledger.sourceFingerprint,
          extractorVersion: contract.manifest.extractorVersion,
          sectionId: section.id,
          metadata: {
            status: section.status,
            resultHash: section.resultHash,
          },
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });

    await expect(promote()).resolves.toMatchObject({ promoted: true });
    const policy = await t.run(async (ctx) => ctx.db.get(contract.policyId));
    expect(policy?.extractionDataStage).toBe("final");
  });

  test("retains the worker source bundle when promotion evidence is saved", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Unknown",
        policyNumber: "Unknown",
        insuredName: "Unknown",
        linesOfBusiness: ["UN"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });
    const saveBundle = async (artifactRole: string, contents: string) => {
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([contents])));
      return await t.mutation(pipelineSaveArtifactFn, {
        jobId: String(policyId),
        kind: "source_bundle",
        storageId,
        sourceFingerprint: "source-fingerprint",
        extractorVersion: "4.6.0",
        metadata: { artifactRole },
      });
    };

    const firstWorkerBundle = await saveBundle("worker_source", "worker-v1");
    const promotionBundle = await saveBundle(
      "promotion_evidence",
      "promotion",
    );
    const currentWorkerBundle = await saveBundle("worker_source", "worker-v2");
    const artifacts = await t.run((ctx) =>
      ctx.db
        .query("policyExtractionArtifacts")
        .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
        .collect());

    expect(artifacts.map((artifact) => artifact._id)).toEqual(
      expect.arrayContaining([promotionBundle, currentWorkerBundle]),
    );
    expect(artifacts.map((artifact) => artifact._id)).not.toContain(
      firstWorkerBundle,
    );
    expect(artifacts).toHaveLength(2);
  });

  test("clears a provisional product name when final extraction has no product identity", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Unknown",
        policyNumber: "Unknown",
        insuredName: "Unknown",
        linesOfBusiness: ["UN"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        extractionDataStage: "placeholder",
      });
    });
    await t.mutation(updatePreviewExtractionInternalFn, {
      id: policyId,
      fields: {
        programName: "Provisional Travel Plan",
      },
      previewVersion: "preview-test",
    });

    await promoteTestPolicy(t, policyId, {
      sourceTreeFieldClears: ["productIdentity", "programName"],
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.extractionDataStage).toBe("final");
    expect(policy?.programName).toBeUndefined();
    expect(policy?.productIdentity).toBeUndefined();
  });

  test("clears a previous PDF product identity when replacement evidence omits it", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        policyNumber: "POL-REPLACEMENT",
        insuredName: "Known Insured",
        linesOfBusiness: ["TRVL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        extractionDataStage: "final",
        programName: "Previous Travel Plan",
        productIdentity: {
          name: {
            value: "Previous Travel Plan",
            confidence: "high",
            sourceNodeIds: ["previous-product-node"],
            sourceSpanIds: ["previous-product-span"],
          },
        },
      });
    });

    await promoteTestPolicy(t, policyId, {
      sourceTreeFieldClears: ["productIdentity", "programName"],
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.programName).toBeUndefined();
    expect(policy?.productIdentity).toBeUndefined();
  });

  test("stores SDK-formatted compatibility addresses for extracted policy parties", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        insurer: {
          legalName: "Carrier",
          address: {
            street1: "10751 Deerwood Park Blvd",
            street2: "Suite 200",
            city: "Jacksonville",
            state: "FL",
            zip: "32256",
            country: "US",
            formatted: "10751 Deerwood Park Blvd, Suite 200, Jacksonville, FL 32256",
          },
        },
        producer: {
          agencyName: "Producer",
          address: {
            street1: "100 Main Street",
            city: "Toronto",
            state: "ON",
            zip: "M5V 1A1",
            country: "CA",
            formatted: "100 Main Street, Toronto, ON M5V 1A1",
          },
        },
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.insurer?.address?.formatted).toBe(
      "10751 Deerwood Park Blvd, Suite 200, Jacksonville, FL 32256",
    );
    expect(policy?.producer?.address?.formatted).toBe(
      "100 Main Street, Toronto, ON M5V 1A1",
    );
  });

  test("stores source provenance on extracted insured addresses", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        insuredAddress: {
          street1: "175 Pearl Street",
          street2: "Suite 410",
          city: "Brooklyn",
          state: "NY",
          zip: "11201",
          country: "US",
          documentNodeId: "policy:source_node:declarations",
          sourceSpanIds: ["policy:span:6:104"],
          sourceTextHash: "address-hash",
        },
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.insuredAddress).toEqual({
      street1: "175 Pearl Street",
      street2: "Suite 410",
      city: "Brooklyn",
      state: "NY",
      zip: "11201",
      country: "US",
      documentNodeId: "policy:source_node:declarations",
      sourceSpanIds: ["policy:span:6:104"],
      sourceTextHash: "address-hash",
    });
  });

  test("stores source provenance on extracted scheduled policy parties", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        additionalNamedInsureds: [
          {
            name: "Town of Milton",
            documentNodeId: "policy:source_node:additional-insured",
            sourceSpanIds: ["policy:span:additional-insured"],
            sourceTextHash: "additional-insured-hash",
            pageStart: 2,
            pageEnd: 2,
          },
        ],
        lossPayees: [
          {
            name: "First Bank",
            role: "loss_payee",
            documentNodeId: "policy:source_node:loss-payee",
            sourceSpanIds: ["policy:span:loss-payee"],
            sourceTextHash: "loss-payee-hash",
            pageStart: 4,
            pageEnd: 4,
          },
        ],
        mortgageHolders: [
          {
            name: "Second Bank",
            role: "mortgage_holder",
            documentNodeId: "policy:source_node:mortgage-holder",
            sourceSpanIds: ["policy:span:mortgage-holder"],
            sourceTextHash: "mortgage-holder-hash",
            pageStart: 5,
            pageEnd: 5,
          },
        ],
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.additionalNamedInsureds?.[0]).toMatchObject({
      name: "Town of Milton",
      documentNodeId: "policy:source_node:additional-insured",
      sourceSpanIds: ["policy:span:additional-insured"],
      sourceTextHash: "additional-insured-hash",
      pageStart: 2,
      pageEnd: 2,
    });
    expect(policy?.lossPayees?.[0]).toMatchObject({
      name: "First Bank",
      role: "loss_payee",
      documentNodeId: "policy:source_node:loss-payee",
      sourceSpanIds: ["policy:span:loss-payee"],
      sourceTextHash: "loss-payee-hash",
      pageStart: 4,
      pageEnd: 4,
    });
    expect(policy?.mortgageHolders?.[0]).toMatchObject({
      name: "Second Bank",
      role: "mortgage_holder",
      documentNodeId: "policy:source_node:mortgage-holder",
      sourceSpanIds: ["policy:span:mortgage-holder"],
      sourceTextHash: "mortgage-holder-hash",
      pageStart: 5,
      pageEnd: 5,
    });
  });

  test("drops provenance-only address shells without rejecting the extraction update", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      return await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-123",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
      });
    });

    await t.mutation(updateExtractionInternalFn, {
      id: policyId,
      fields: {
        insuredAddress: {
          documentNodeId: "policy:source_node:insured",
          sourceSpanIds: ["policy:span:insured"],
        },
        insurer: {
          legalName: "Carrier",
          address: {
            formatted: "Address unavailable",
            documentNodeId: "policy:source_node:insurer",
            sourceSpanIds: ["policy:span:insurer"],
          },
          sourceSpanIds: ["policy:span:insurer"],
        },
        additionalNamedInsureds: [
          {
            name: "Known Subsidiary",
            address: {
              city: "Toronto",
              sourceSpanIds: ["policy:span:subsidiary"],
            },
          },
        ],
      },
    });

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.insuredAddress).toBeUndefined();
    expect(policy?.insurer).toEqual({
      legalName: "Carrier",
      sourceSpanIds: ["policy:span:insurer"],
    });
    expect(policy?.additionalNamedInsureds).toEqual([
      { name: "Known Subsidiary" },
    ]);
  });

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
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        fileName: "known-policy.pdf",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [{ name: "Known Coverage", limit: "$1,000,000" }],
        extractionDataStage: "preview",
      });
    });

    await promoteTestPolicy(t, policyId, {
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

  test("leaves an existing bound policy active when re-extraction is rejected", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        policyNumber: "POL-REEXTRACT",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "complete",
        extractionDataStage: "final",
      });
      const factId = await ctx.db.insert("policyDeclarationFacts", {
        orgId,
        policyId,
        fieldPath: "coverages.0.limit",
        fieldGroup: "coverage_limit:general_liability",
        displayValue: "General Liability: $1,000,000",
        normalizedValue: "general liability 1000000",
        valueKind: "money",
        observedAt: 1,
        active: true,
        recordHash: "re-extraction-fact",
      });
      return { factId, policyId };
    });

    await t.mutation(pipelineRejectExternalJobFn, {
      jobId: ids.policyId,
      error: "Replacement document is not a bound policy.",
      archivePolicy: false,
      state: {
        policyVersionKind: "re_extraction",
        replacementPromotionStarted: false,
        fileId: "replacement-file",
        traceId: "replacement-trace",
      },
    });

    const result = await t.run(async (ctx) => ({
      policy: await ctx.db.get(ids.policyId),
      fact: await ctx.db.get(ids.factId),
      run: await ctx.db
        .query("policyExtractionRuns")
        .withIndex("by_policyId", (q) => q.eq("policyId", ids.policyId))
        .first(),
    }));
    expect(result.policy).toMatchObject({
      carrier: "Known Carrier",
      policyNumber: "POL-REEXTRACT",
      pipelineStatus: "complete",
    });
    expect(result.run).toMatchObject({
      pipelineStatus: "complete",
      pipelineCheckpoint: {
        nextPhase: "extract",
        state: {
          policyVersionKind: "re_extraction",
          replacementPromotionStarted: false,
          fileId: "replacement-file",
          externalWorker: true,
        },
      },
    });
    expect(result.run?.pipelineError).toBeUndefined();
    expect(result.policy?.pipelineError).toBeUndefined();
    expect(result.policy?.deletedAt).toBeUndefined();
    expect(result.fact?.active).toBe(true);
  });

  test("keeps final policy workflows active when in-process re-extraction fails", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        policyNumber: "POL-IN-PROCESS",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "running",
        extractionDataStage: "final",
      });
      await ctx.db.insert("policyExtractionRuns", {
        policyId,
        pipelineStatus: "running",
        pipelineCheckpoint: {
          nextPhase: "extract",
          state: {
            policyVersionKind: "re_extraction",
            replacementPromotionStarted: false,
            fileId: "replacement-file",
          },
          createdAt: 1,
        },
        createdAt: 1,
        updatedAt: 1,
      });
      return policyId;
    });

    await t.mutation(pipelineSetStatusFn, {
      jobId: policyId,
      status: "error",
      error: "Replacement document is not a bound policy.",
    });
    await t.mutation(pipelineReconcileTerminalStateFn, {
      jobId: policyId,
    });

    const result = await t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      run: await ctx.db
        .query("policyExtractionRuns")
        .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
        .first(),
    }));
    expect(result.policy?.pipelineStatus).toBe("complete");
    expect(result.policy?.pipelineError).toBeUndefined();
    expect(result.run).toMatchObject({
      pipelineStatus: "complete",
      pipelineCheckpoint: {
        nextPhase: "extract",
        state: {
          policyVersionKind: "re_extraction",
          replacementPromotionStarted: false,
          fileId: "replacement-file",
        },
      },
    });
    expect(result.run?.pipelineError).toBeUndefined();
  });

  test("keeps an external replacement checkpoint retryable after worker failure", async () => {
    const t = convexTest(schema, modules);
    const policyId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Known Carrier",
        policyNumber: "POL-EXTERNAL-RETRY",
        insuredName: "Known Insured",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "running",
        extractionDataStage: "final",
      });
      await ctx.db.insert("policyExtractionRuns", {
        policyId,
        pipelineStatus: "running",
        pipelineCheckpoint: {
          nextPhase: "extract",
          state: {
            policyVersionKind: "re_extraction",
            replacementPromotionStarted: false,
            fileId: "replacement-file",
            externalWorker: true,
          },
          createdAt: 1,
          lease: {
            id: "replacement-lease",
            phase: "extract",
            expiresAt: 100,
          },
        },
        createdAt: 1,
        updatedAt: 1,
      });
      return policyId;
    });

    await t.mutation(pipelineCompleteLeaseFn, {
      jobId: policyId,
      leaseId: "replacement-lease",
      status: "error",
      error: "Worker failed before replacement promotion.",
      checkpoint: {
        nextPhase: "extract",
        state: {
          policyVersionKind: "re_extraction",
          replacementPromotionStarted: false,
          fileId: "replacement-file",
          externalWorker: true,
        },
        createdAt: 2,
      },
    });
    await t.mutation(pipelineReconcileTerminalStateFn, {
      jobId: policyId,
    });

    const result = await t.run(async (ctx) => ({
      policy: await ctx.db.get(policyId),
      run: await ctx.db
        .query("policyExtractionRuns")
        .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
        .first(),
    }));
    expect(result.policy?.pipelineStatus).toBe("complete");
    expect(result.run).toMatchObject({
      pipelineStatus: "complete",
      pipelineCheckpoint: {
        nextPhase: "extract",
        state: {
          fileId: "replacement-file",
          replacementPromotionStarted: false,
        },
      },
    });
    expect(result.run?.pipelineError).toBeUndefined();
  });

  test.each([
    {
      nextPhase: "extract",
      replacementPromotionStarted: true,
    },
    {
      nextPhase: "embed_and_store",
      replacementPromotionStarted: false,
    },
  ])(
    "fails closed when re-extraction errors after replacement promotion ($nextPhase)",
    async ({ nextPhase, replacementPromotionStarted }) => {
      const t = convexTest(schema, modules);
      const policyId = await t.run(async (ctx) => {
        const orgId = await ctx.db.insert("organizations", {
          name: "Client",
          type: "client",
        });
        const policyId = await ctx.db.insert("policies", {
          orgId,
          carrier: "Replacement Carrier",
          policyNumber: "POL-PROMOTED",
          insuredName: "Known Insured",
          linesOfBusiness: ["CGL"],
          effectiveDate: "01/01/2026",
          expirationDate: "01/01/2027",
          documentType: "policy",
          policyYear: 2026,
          isRenewal: false,
          coverages: [],
          pipelineStatus: "running",
          extractionDataStage: "final",
        });
        await ctx.db.insert("policyExtractionRuns", {
          policyId,
          pipelineStatus: "running",
          pipelineCheckpoint: {
            nextPhase,
            state: {
              policyVersionKind: "re_extraction",
              replacementPromotionStarted,
            },
            createdAt: 1,
          },
          createdAt: 1,
          updatedAt: 1,
        });
        return policyId;
      });

      await t.mutation(pipelineSetStatusFn, {
        jobId: policyId,
        status: "error",
        error: "Replacement evidence persistence failed.",
      });

      const result = await t.run(async (ctx) => ({
        policy: await ctx.db.get(policyId),
        run: await ctx.db
          .query("policyExtractionRuns")
          .withIndex("by_policyId", (q) => q.eq("policyId", policyId))
          .first(),
      }));
      expect(result.policy).toMatchObject({
        pipelineStatus: "error",
        pipelineError: "Replacement evidence persistence failed.",
      });
      expect(result.run).toMatchObject({
        pipelineStatus: "error",
        pipelineError: "Replacement evidence persistence failed.",
      });
    },
  );
});
