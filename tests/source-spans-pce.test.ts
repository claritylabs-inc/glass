import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("source spans and PCE backend surfaces", () => {
  it("defines persistent source span and source chunk tables", () => {
    const schema = read("convex/schema.ts");

    expect(schema).toContain("sourceSpans: defineTable");
    expect(schema).toContain("sourceChunks: defineTable");
    expect(schema).toContain("sourceSpanIds: v.array(v.string())");
    expect(schema).toContain(".vectorIndex(\"by_embedding\"");
  });

  it("defines policy-change case lifecycle tables and entrypoints", () => {
    const schema = read("convex/schema.ts");
    const policyChanges = read("convex/policyChanges.ts");

    expect(schema).toContain("policyChangeCases: defineTable");
    expect(schema).toContain("pcePackets: defineTable");
    expect(schema).toContain("caseMessages: defineTable");
    expect(schema).toContain("caseEvidenceLinks: defineTable");
    expect(schema).toContain("caseValidationReports: defineTable");
    expect(policyChanges).toContain("createFromChat");
    expect(policyChanges).toContain("createFromEmail");
    expect(policyChanges).toContain("createFromUploadedDocument");
    expect(policyChanges).toContain("generateCarrierPacket");
    expect(policyChanges).toContain("markStatus");
  });

  it("wires the create_policy_change_request agent tool", () => {
    const chatTools = read("convex/lib/chatTools.ts");
    const threadChat = read("convex/actions/processThreadChat.ts");

    expect(chatTools).toContain("createPolicyChangeRequest");
    expect(threadChat).toContain("create_policy_change_request");
    expect(threadChat).toContain("internal.actions.policyChangeRequests.createFromChatForThread");
    expect(read("convex/actions/handleInboundEmail.ts")).toContain("create_policy_change_request");
    expect(read("convex/actions/handleInboundEmail.ts")).toContain("createFromEmailForThread");
    expect(read("convex/actions/handleInboundImessage.ts")).toContain("create_policy_change_request");
  });

  it("prefers source chunks in agent retrieval context", () => {
    const prompts = read("convex/lib/agentPrompts.ts");
    const queryAgent = read("convex/lib/queryAgent.ts");
    const sourceRetriever = read("convex/lib/convexSourceRetriever.ts");

    expect(prompts).toContain("ctx.vectorSearch(\"sourceChunks\"");
    expect(prompts).toContain("SOURCE-SPAN EVIDENCE");
    expect(prompts).toContain("sourceSpanIds");
    expect(sourceRetriever).toContain("createConvexSourceRetriever");
    expect(sourceRetriever).toContain("ctx.vectorSearch(\"sourceChunks\"");
    expect(queryAgent).toContain("sourceRetriever: createConvexSourceRetriever");
    expect(queryAgent).toContain("retrievalMode: \"hybrid\"");
  });

  it("returns source span IDs from policy section lookup tools", () => {
    const policyLookup = read("convex/lib/policyLookup.ts");
    const threadChat = read("convex/actions/processThreadChat.ts");
    const inboundEmail = read("convex/actions/handleInboundEmail.ts");
    const inboundImessage = read("convex/actions/handleInboundImessage.ts");

    expect(policyLookup).toContain("searchPolicyDocumentWithSourceSpans");
    expect(policyLookup).toContain("sourceSpanIds");
    expect(threadChat).toContain("citedSourceSpanIds");
    expect(threadChat).toContain("searchPolicyDocumentWithSourceSpans");
    expect(inboundEmail).toContain("searchPolicyDocumentWithSourceSpans");
    expect(inboundImessage).toContain("searchPolicyDocumentWithSourceSpans");
  });

  it("builds PDF source spans before policy extraction", () => {
    const policyExtraction = read("convex/actions/policyExtraction.ts");
    const pdfSourceSpans = read("convex/lib/pdfSourceSpans.ts");

    expect(pdfSourceSpans).toContain("pdfjs-dist/legacy/build/pdf.mjs");
    expect(pdfSourceSpans).toContain("getTextContent");
    expect(pdfSourceSpans).toContain("splitPageIntoSectionCandidates");
    expect(pdfSourceSpans).toContain("sourceUnit: \"section_candidate\"");
    expect(policyExtraction).toContain("buildPdfSourceSpans");
    expect(policyExtraction).toContain("sourceSpans: pdfSource.sourceSpans as Array<Record<string, any>>");
    expect(policyExtraction).toContain(": pdfSource.sourceSpans as Array<Record<string, any>>");
    expect(policyExtraction).not.toContain("SDK source-grounding is disabled");
    expect(policyExtraction).toContain("documentChunksForEmbedding");
    expect(policyExtraction).toContain("sourceChunksForEmbedding");
  });
});
