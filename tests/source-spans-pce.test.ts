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
    expect(schema).toContain('policyChangeCaseId: v.optional(v.id("policyChangeCases"))');
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
    const aiUtils = read("convex/lib/aiUtils.ts");

    expect(chatTools).toContain("createPolicyChangeRequest");
    expect(chatTools).toContain("certificate_holder_only");
    expect(chatTools).toContain("requestKind");
    expect(chatTools).toContain("policy number plus the requested new value is enough");
    expect(aiUtils).toContain("Do not ask \"if you want me to proceed\"");
    expect(aiUtils).toContain("Missing recipient information should not block creating the case");
    expect(threadChat).toContain("create_policy_change_request");
    expect(threadChat).toContain("add_policy_change_info");
    expect(threadChat).toContain("draft_policy_change_email");
    expect(threadChat).toContain("complete_policy_change_from_endorsement");
    expect(threadChat).toContain("evaluatePceIntake");
    expect(threadChat).toContain("internal.actions.policyChangeRequests.createFromChatForThread");
    expect(threadChat).toContain("policyChangeCaseId");
    expect(read("convex/actions/handleInboundEmail.ts")).toContain("create_policy_change_request");
    expect(read("convex/actions/handleInboundEmail.ts")).toContain("createFromEmailForThread");
    expect(read("convex/actions/handleInboundImessage.ts")).toContain("create_policy_change_request");
  });

  it("renders policy change request artifacts in chat", () => {
    const policyChangeArtifact = read("components/agent-thread/artifacts/policy-change.tsx");
    const policyChanges = read("convex/policyChanges.ts");

    expect(policyChangeArtifact).toContain("function PolicyChangeSummaryCard");
    expect(policyChangeArtifact).toContain("function PolicyChangeThreadSidebar");
    expect(policyChangeArtifact).toContain("Policy change request");
    expect(policyChangeArtifact).toContain("Review request");
    expect(policyChangeArtifact).toContain("Affected values");
    expect(policyChanges).toContain("assertCanManagePolicyChange");
    expect(policyChanges).toContain("assertCanCreatePolicyChange");
    expect(read("convex/actions/policyChangeRequests.ts")).toContain("broker_contact_required");
    expect(read("convex/actions/policyChangeRequests.ts")).not.toContain("STANDALONE_CLIENT_PCE_MESSAGE");
    expect(read("convex/lib/access.ts")).toContain("assertCanDraftPolicyChangeSubmission");
    expect(read("convex/policyChanges.ts")).toContain("canCreatePolicyChangeForUserInternal");
    expect(read("convex/policyChanges.ts")).toContain("Policy change requests require direct org membership or broker access");
    expect(read("convex/lib/aiUtils.ts")).toContain("Create the case and ask for the broker contact");
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

  it("renders chat sources and tool calls as compact footer controls", () => {
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const referenceCards = read("components/context-reference-card.tsx");

    expect(threadContent).toContain("function MessageFooterActions");
    expect(threadContent).toContain("toolCalls.length} tool");
    expect(threadContent).toContain("msg.usedTools ?? []");
    expect(threadContent).toContain("relatedEmailMessages.flatMap");
    expect(referenceCards).toContain("function PolicyCitation");
    expect(referenceCards).toContain("function PolicySourcePill");
    expect(referenceCards).toContain("{refs.length} sources");
    expect(referenceCards).toContain("refs.length === 1");
    expect(referenceCards).not.toContain(">Sources<");
    expect(threadContent).not.toContain("Hide tool calls");
  });

  it("prepares LiteParse or PDF source spans before policy extraction", () => {
    const policyExtraction = read("convex/actions/policyExtraction.ts");
    const doclingPreprocessor = read("convex/lib/doclingPreprocessor.ts");
    const pdfSourceSpans = read("convex/lib/pdfSourceSpans.ts");

    expect(doclingPreprocessor).toContain("preparePdfTextWithParserFallback");
    expect(doclingPreprocessor).toContain("tryConvertPdfWithLiteParse");
    expect(doclingPreprocessor).toContain("/liteparse/convert");
    expect(doclingPreprocessor).toContain("EXTRACTION_WORKER_URL");
    expect(doclingPreprocessor).toContain("buildPdfSourceSpans");
    expect(pdfSourceSpans).toContain("pdfjs-dist/legacy/build/pdf.mjs");
    expect(pdfSourceSpans).toContain("getTextContent");
    expect(pdfSourceSpans).toContain("splitPageIntoSectionCandidates");
    expect(pdfSourceSpans).toContain("sourceUnit: \"section_candidate\"");
    expect(policyExtraction).toContain("preparePdfTextWithParserFallback");
    expect(policyExtraction).not.toContain("kind: \"docling_document\"");
    expect(policyExtraction).toContain("sourceSpans: pdfSource.sourceSpans as Array<Record<string, any>>");
    expect(policyExtraction).toContain(": pdfSource.sourceSpans as Array<Record<string, any>>");
    expect(policyExtraction).not.toContain("SDK source-grounding is disabled");
    expect(policyExtraction).toContain("documentChunksForEmbedding");
    expect(policyExtraction).toContain("sourceChunksForEmbedding");
  });
});
