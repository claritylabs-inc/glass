import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string) {
  return existsSync(join(root, path));
}

describe("source spans and policy update backend surfaces", () => {
  it("defines persistent source span and source chunk tables", () => {
    const schema = read("convex/schema.ts");

    expect(schema).toContain("sourceSpans: defineTable");
    expect(schema).toContain("sourceChunks: defineTable");
    expect(schema).toContain("sourceSpanIds: v.array(v.string())");
    expect(schema).toContain(".vectorIndex(\"by_embedding\"");
  });

  it("keeps policy-change compatibility tables dormant behind cleanup", () => {
    const schema = read("convex/schema.ts");
    const operator = read("convex/operator.ts");

    expect(schema).toContain("policyChangeCases: defineTable");
    expect(schema).toContain("pcePackets: defineTable");
    expect(schema).toContain('policyChangeCaseId: v.optional(v.id("policyChangeCases"))');
    expect(schema).toContain("caseMessages: defineTable");
    expect(schema).toContain("caseEvidenceLinks: defineTable");
    expect(schema).toContain("caseValidationReports: defineTable");
    expect(operator).toContain("cleanupRemovedPolicyChangeData");
    expect(operator).toContain("REMOVED_POLICY_CHANGE_TABLES");
    expect(exists("convex/policyChanges.ts")).toBe(false);
    expect(exists("convex/lib/pceIntake.ts")).toBe(false);
    expect(exists("convex/actions/policyChangeRequests.ts")).toBe(false);
  });

  it("removes policy-change agent tools and executors", () => {
    const chatTools = read("convex/lib/chatTools.ts");
    const threadChat = read("convex/actions/processThreadChat.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");
    const aiUtils = read("convex/lib/aiUtils.ts");

    expect(chatTools).not.toContain("createPolicyChangeRequest");
    expect(chatTools).not.toContain("addPolicyChangeInfo");
    expect(chatTools).not.toContain("draftPolicyChangeSubmission");
    expect(chatTools).not.toContain("completePolicyChangeFromEndorsement");
    expect(aiUtils).toContain("Do not ask \"if you want me to proceed\"");
    expect(aiUtils).toContain("draft a broker email");
    expect(threadChat).not.toContain("create_policy_change_request");
    expect(threadChat).not.toContain("add_policy_change_info");
    expect(threadChat).not.toContain("draft_policy_change_email");
    expect(threadChat).not.toContain("complete_policy_change_from_endorsement");
    expect(threadChat).toContain("buildAgentToolExecutors");
    expect(agentToolExecutors).not.toContain("evaluatePceIntake");
    expect(agentToolExecutors).not.toContain("internal.actions.policyChangeRequests");
    expect(agentToolExecutors).not.toContain("resolvePolicyChangeCaseForTool");
    expect(agentToolExecutors).not.toContain("resolveCaseCandidatesInternal");
    expect(agentToolExecutors).not.toContain("getCurrentPolicyChangeCaseId");
    expect(agentToolExecutors).not.toContain("defaultPolicyChangeCaseId");
    expect(chatTools).not.toContain("caseId: z.string().optional()");
    expect(threadChat).not.toContain("policyChangeCaseId");
    expect(read("convex/actions/handleInboundEmail.ts")).toContain("buildAgentToolExecutors");
    expect(read("convex/actions/handleInboundImessage.ts")).toContain("buildAgentToolExecutors");
  });

  it("strips endorsement-completion case correlation from inbound email", () => {
    const inboundEmail = read("convex/actions/handleInboundEmail.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");

    expect(agentToolExecutors).not.toContain("That policy change case belongs to a different policy");
    expect(inboundEmail).not.toContain("resolveInboundThreadAndPolicyChange");
    expect(inboundEmail).toContain("extractPendingEmailIdsFromHeaders");
    expect(inboundEmail).toContain("GLASS_PENDING_MESSAGE_ID_RE");
    expect(inboundEmail).not.toContain("findSingleWaitingForEndorsementCaseInThreadInternal");
    expect(inboundEmail).not.toContain("findLatestPolicyChangeEmailInThread");
    expect(inboundEmail).not.toContain("defaultPolicyChangeCaseId: correlatedPolicyChangeCaseId");
    expect(inboundEmail).not.toContain("policyChangeCaseId: correlatedPolicyChangeCaseId");
  });

  it("removes policy-change chat artifacts and access helpers", () => {
    expect(exists("components/agent-thread/artifacts/policy-change.tsx")).toBe(false);
    expect(exists("components/policy-change-status.ts")).toBe(false);
    expect(exists("convex/lib/policyChangeBrokerRouting.ts")).toBe(false);
    expect(exists("convex/actions/policyChangeRequests.ts")).toBe(false);
    expect(read("convex/lib/access.ts")).not.toContain("assertCanDraftPolicyChangeSubmission");
    expect(read("convex/lib/access.ts")).not.toContain("canCreatePolicyChangeForUserInternal");
    expect(read("convex/lib/aiUtils.ts")).toContain("draft a broker email");
  });

  it("prefers source nodes in agent retrieval context", () => {
    const prompts = read("convex/lib/agentPrompts.ts");
    const queryAgent = read("convex/lib/queryAgent.ts");
    const sourceRetriever = read("convex/lib/convexSourceRetriever.ts");
    const threadChat = read("convex/actions/processThreadChat.ts");
    const agentTools = read("convex/lib/agentToolExecutors.ts");
    const policies = read("convex/policies.ts");

    expect(prompts).toContain("SOURCE-TREE EVIDENCE");
    expect(prompts).toContain("sourceSpanIds");
    expect(prompts).toContain("SOURCE_NODE_CANDIDATE_LIMIT_PER_ORG");
    expect(prompts).toContain("MAX_PORTFOLIO_DOCUMENT_CONTEXT_ORGS");
    expect(prompts).toContain("DOCUMENT CONTEXT BOUNDS");
    expect(prompts).toContain("sourceNodes.listByOrgInternal");
    expect(prompts).toContain("sourceNodes.listByPolicyCandidatesInternal");
    expect(prompts).toContain("sourceNodes.listContextByPolicyAndNodeIdsInternal");
    expect(prompts).not.toContain("sourceNodes.listByPolicyInternal");
    expect(threadChat).not.toContain("documentContextOrgIdsForScope");
    expect(threadChat).not.toContain("listPreviewReadableForAgentContextInternal");
    expect(agentTools).toContain("lookup_policy_section");
    expect(agentTools).toContain("searchPolicyDocumentWithSourceSpans");
    expect(agentTools).toContain("agent_policy_section_lookup");
    expect(policies).toContain("listPreviewReadableForAgentContextInternal");
    expect(sourceRetriever).toContain("createConvexSourceRetriever");
    expect(sourceRetriever).toContain("searchSourceNodes");
    expect(sourceRetriever).toContain("sourceNodes.listByOrgInternal");
    expect(sourceRetriever).toContain("sourceSpans.listChunksByOrgInternal");
    expect(queryAgent).toContain("sourceRetriever: createConvexSourceRetriever");
    expect(queryAgent).toContain("retrievalMode: \"hybrid\"");
  });

  it("returns source span IDs from policy section lookup tools", () => {
    const policyLookup = read("convex/lib/policyLookup.ts");
    const threadChat = read("convex/actions/processThreadChat.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");
    const inboundEmail = read("convex/actions/handleInboundEmail.ts");
    const inboundImessage = read("convex/actions/handleInboundImessage.ts");

    expect(policyLookup).toContain("searchPolicyDocumentWithSourceSpans");
    expect(policyLookup).toContain("sourceSpanIds");
    expect(threadChat).toContain("citedSourceSpanIds");
    expect(threadChat).toContain("buildAgentToolExecutors");
    expect(agentToolExecutors).toContain("searchPolicyDocumentWithSourceSpans");
    expect(inboundEmail).toContain("buildAgentToolExecutors");
    expect(inboundImessage).toContain("buildAgentToolExecutors");
  });

  it("renders chat sources as compact footer controls without tool activity", () => {
    const threadContent = read("components/agent-thread/thread-content.tsx");
    const referenceCards = read("components/context-reference-card.tsx");

    expect(threadContent).toContain("function MessageFooterActions");
    expect(threadContent).toContain("MessageMetaTag");
    expect(threadContent).not.toContain("steps={msg.agentSteps}");
    expect(threadContent).not.toContain("fallbackToolCalls={regularToolCalls}");
    expect(threadContent).not.toContain('"Tool" : "Tools"');
    expect(threadContent).not.toContain("msg.usedTools ?? []");
    expect(threadContent).not.toContain("relatedEmailMessages.flatMap");
    expect(threadContent).toContain(
      "const referencedPolicyIds = msg.referencedPolicyIds ?? [];",
    );
    expect(referenceCards).toContain("function PolicyCitation");
    expect(referenceCards).toContain("function PolicySourcePill");
    expect(threadContent).not.toContain("showSingleCount");
    expect(referenceCards).not.toContain("index: number");
    expect(referenceCards).not.toContain("{index}");
    expect(referenceCards).not.toContain(">Sources<");
    expect(threadContent).not.toContain("Hide tool calls");
  });

  it("prepares LiteParse or PDF source spans before policy extraction", () => {
    const policyExtraction = read("convex/actions/policyExtraction.ts");
    const liteparsePreprocessor = read("convex/lib/liteparsePreprocessor.ts");
    const pdfSourceSpans = read("convex/lib/pdfSourceSpans.ts");
    const workerLiteparse = read("extraction-worker/src/liteparse.ts");
    const worker = read("extraction-worker/src/index.ts");
    const workerCancellation = read(
      "extraction-worker/src/httpRequestCancellation.ts",
    );
    const conductorSetup = read("scripts/setup-conductor-workspace.mjs");

    expect(liteparsePreprocessor).toContain("preparePdfTextWithParserFallback");
    expect(liteparsePreprocessor).toContain("tryConvertPdfWithLiteParse");
    expect(liteparsePreprocessor).toContain("/liteparse/convert");
    expect(liteparsePreprocessor).toContain("EXTRACTION_WORKER_URL");
    expect(liteparsePreprocessor).toContain("buildPdfSourceSpans");
    expect(pdfSourceSpans).toContain("pdfjs-dist/legacy/build/pdf.mjs");
    expect(pdfSourceSpans).toContain("getTextContent");
    expect(pdfSourceSpans).toContain("splitPageIntoSectionCandidates");
    expect(pdfSourceSpans).toContain("sourceUnit: \"section_candidate\"");
    expect(policyExtraction).toContain("preparePdfTextWithParserFallback");
    expect(policyExtraction).toContain("sourceSpans: pdfSource.sourceSpans as Array<Record<string, any>>");
    expect(policyExtraction).toContain(": pdfSource.sourceSpans as Array<Record<string, any>>");
    expect(policyExtraction).not.toContain("SDK source-grounding is disabled");
    expect(policyExtraction).toContain("documentChunksForEmbedding");
    expect(policyExtraction).toContain("sourceChunksForEmbedding");
    expect(workerLiteparse).toContain("withSerializedLiteParse");
    expect(workerLiteparse).toContain("LiteParseQueuePriority");
    expect(workerLiteparse).toContain('priority?: LiteParseQueuePriority');
    expect(workerLiteparse).toContain("signal?: AbortSignal");
    expect(workerLiteparse).toContain("liteParseWaitQueue");
    expect(worker).toContain('priority: "http"');
    expect(worker).toContain('priority: "preview"');
    expect(worker).toContain('priority: "full"');
    expect(worker).toContain("watchClientDisconnect(req, res)");
    expect(workerCancellation).toContain('res.once("close", abort)');
    expect(workerCancellation).toContain('req.socket.once("close", abort)');
    expect(conductorSetup).toContain('EXTRACTION_JOB_CONCURRENCY: "8"');
    expect(conductorSetup).toContain('EXTRACTION_PREVIEW_CONCURRENCY: "2"');
  });
});
