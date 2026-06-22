import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("source spans and policy update backend surfaces", () => {
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
    expect(policyChanges).toContain("draftSubmission");
    expect(policyChanges).toContain("cancelRequest");
  });

  it("wires the create_policy_change_request agent tool", () => {
    const chatTools = read("convex/lib/chatTools.ts");
    const threadChat = read("convex/actions/processThreadChat.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");
    const aiUtils = read("convex/lib/aiUtils.ts");

    expect(chatTools).toContain("createPolicyChangeRequest");
    expect(chatTools).toContain("certificate_holder_only");
    expect(chatTools).toContain("requestKind");
    expect(chatTools).toContain("A policy number plus the requested new value is enough");
    expect(aiUtils).toContain("Do not ask \"if you want me to proceed\"");
    expect(aiUtils).toContain("Missing recipient information should not block capturing the follow-up");
    expect(threadChat).toContain("create_policy_change_request");
    expect(threadChat).toContain("add_policy_change_info");
    expect(threadChat).toContain("draft_policy_change_email");
    expect(threadChat).toContain("complete_policy_change_from_endorsement");
    expect(threadChat).toContain("buildAgentToolExecutors");
    expect(agentToolExecutors).toContain("evaluatePceIntake");
    expect(agentToolExecutors).toContain("internal.actions.policyChangeRequests.createFromChatForThread");
    expect(agentToolExecutors).toContain("internal.actions.policyChangeRequests.createFromEmailForThread");
    expect(agentToolExecutors).toContain("resolvePolicyChangeCaseForTool");
    expect(agentToolExecutors).toContain("resolveCaseCandidatesInternal");
    expect(agentToolExecutors).toContain("getCurrentPolicyChangeCaseId");
    expect(agentToolExecutors).toContain("defaultPolicyChangeCaseId");
    expect(chatTools).toContain("caseId: z.string().optional()");
    expect(threadChat).toContain("policyChangeCaseId");
    expect(read("convex/actions/handleInboundEmail.ts")).toContain("buildAgentToolExecutors");
    expect(read("convex/actions/handleInboundImessage.ts")).toContain("buildAgentToolExecutors");
  });

  it("keeps endorsement completion policy-scoped and email-correlated", () => {
    const policyChanges = read("convex/policyChanges.ts");
    const inboundEmail = read("convex/actions/handleInboundEmail.ts");
    const agentToolExecutors = read("convex/lib/agentToolExecutors.ts");

    expect(policyChanges).toContain("caseBelongsToPolicy");
    expect(policyChanges).toContain("Policy change case does not belong to this policy");
    expect(agentToolExecutors).toContain("That policy change case belongs to a different policy");
    expect(inboundEmail).toContain("resolveInboundThreadAndPolicyChange");
    expect(inboundEmail).toContain("extractPendingEmailIdsFromHeaders");
    expect(inboundEmail).toContain("GLASS_PENDING_MESSAGE_ID_RE");
    expect(inboundEmail).toContain("findSingleWaitingForEndorsementCaseInThreadInternal");
    expect(inboundEmail).not.toContain("findLatestPolicyChangeEmailInThread");
    expect(inboundEmail).toContain("defaultPolicyChangeCaseId: correlatedPolicyChangeCaseId");
    expect(inboundEmail).toContain("policyChangeCaseId: correlatedPolicyChangeCaseId");
  });

  it("renders broker follow-up artifacts in chat", () => {
    const policyChangeArtifact = read("components/agent-thread/artifacts/policy-change.tsx");
    const policyChanges = read("convex/policyChanges.ts");

    expect(policyChangeArtifact).toContain("function PolicyChangeSummaryCard");
    expect(policyChangeArtifact).toContain("function PolicyChangeThreadSidebar");
    expect(policyChangeArtifact).toContain("Broker follow-up");
    expect(policyChangeArtifact).not.toContain("Review request");
    expect(policyChangeArtifact).not.toContain("Requested updates");
    expect(policyChanges).toContain("assertCanCreatePolicyChange");
    expect(read("convex/lib/policyChangeBrokerRouting.ts")).toContain("broker_contact_required");
    expect(read("convex/actions/policyChangeRequests.ts")).not.toContain("STANDALONE_CLIENT_PCE_MESSAGE");
    expect(read("convex/lib/access.ts")).toContain("assertCanDraftPolicyChangeSubmission");
    expect(read("convex/policyChanges.ts")).toContain("canCreatePolicyChangeForUserInternal");
    expect(read("convex/policyChanges.ts")).toContain("Broker follow-ups require direct org membership or broker access");
    expect(read("convex/lib/aiUtils.ts")).toContain("Capture the follow-up and ask for the broker contact");
  });

  it("prefers source nodes in agent retrieval context", () => {
    const prompts = read("convex/lib/agentPrompts.ts");
    const queryAgent = read("convex/lib/queryAgent.ts");
    const sourceRetriever = read("convex/lib/convexSourceRetriever.ts");
    const threadChat = read("convex/actions/processThreadChat.ts");
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
    expect(threadChat).toContain("documentContextOrgIdsForScope");
    expect(threadChat).toContain("listPreviewReadableForAgentContextInternal");
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
    const liteparsePreprocessor = read("convex/lib/liteparsePreprocessor.ts");
    const pdfSourceSpans = read("convex/lib/pdfSourceSpans.ts");

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
  });
});
