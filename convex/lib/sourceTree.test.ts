import { describe, expect, it } from "vitest";

import { normalizeOperationalProfile, normalizeSourceTree, operationalProfilePolicyFields, sourceTreePolicyFields, type DocumentSourceNode, type PolicyOperationalProfile, type SourceSpanLike } from "./sourceTree";

const sourceSpans: SourceSpanLike[] = [
  { id: "span-jacket", text: "THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY.", pageStart: 1 },
  { id: "span-insurer", text: "SPECIMEN POLICY — FOR TESTING ONLY SAINT LAWRENCE SPECIALTY INSURANCE COMPANY", pageStart: 1 },
  { id: "span-named-insured", text: "Column 1: Item 1. Named Insured and | Column 2: Cios Technologies Inc.", pageStart: 5 },
  { id: "span-policy-number", text: "Column 1: Item 2. Policy Number | Column 2: SLS-EO-26-110482", pageStart: 5 },
  { id: "span-period", text: "Column 1: Item 3. Policy Period | Column 2: From: 02/01/2026 To: 02/01/2027", pageStart: 5 },
  { id: "span-business-continuation", text: "Column 1: Named Insured | Column 2: holds delegated underwriting and binding authority from one or more", pageStart: 5 },
  { id: "span-premium", text: "Column 1: Annual Premium | Column 2: CAD $42,000", pageStart: 6 },
  { id: "span-total-payable", text: "Column 1: Total Payable | Column 2: CAD $43,820", pageStart: 6 },
  { id: "span-broker", text: "Item 12. Broker of Record Wellington Risk Partners Inc. RIBO Registration No. 1142208 (Ontario) Item 13. Forms", pageStart: 7 },
];

const sourceTree: DocumentSourceNode[] = [
  {
    id: "document",
    documentId: "policy",
    kind: "document",
    title: "Policy",
    description: "Policy",
    sourceSpanIds: [],
    order: 0,
    path: "Policy",
  },
  {
    id: "jacket",
    documentId: "policy",
    parentId: "document",
    kind: "page",
    title: "Policy Jacket",
    description: "Opening policy jacket",
    textExcerpt: "THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY.",
    sourceSpanIds: ["span-jacket"],
    pageStart: 1,
    pageEnd: 1,
    order: 1,
    path: "Policy > Policy Jacket",
  },
  {
    id: "insurer",
    documentId: "policy",
    parentId: "jacket",
    kind: "text",
    title: "Insurer",
    description: "Insurer name",
    textExcerpt: "SPECIMEN POLICY — FOR TESTING ONLY SAINT LAWRENCE SPECIALTY INSURANCE COMPANY",
    sourceSpanIds: ["span-insurer"],
    pageStart: 1,
    pageEnd: 1,
    order: 2,
    path: "Policy > Policy Jacket > Insurer",
  },
  {
    id: "named-insured-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Item 1 Named Insured Row",
    description: "Named insured entry",
    textExcerpt: "Column 1: Item 1. Named Insured and | Column 2: Cios Technologies Inc.",
    sourceSpanIds: ["span-named-insured"],
    pageStart: 5,
    pageEnd: 5,
    order: 3,
    path: "Policy > Declarations > Item 1 Named Insured Row",
  },
  {
    id: "policy-number-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Item 2 Policy Number Row",
    description: "Policy number entry",
    textExcerpt: "Column 1: Item 2. Policy Number | Column 2: SLS-EO-26-110482",
    sourceSpanIds: ["span-policy-number"],
    pageStart: 5,
    pageEnd: 5,
    order: 4,
    path: "Policy > Declarations > Item 2 Policy Number Row",
  },
  {
    id: "period-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Item 3 Policy Period Row",
    description: "Policy period entry",
    textExcerpt: "Column 1: Item 3. Policy Period | Column 2: From: 02/01/2026 To: 02/01/2027",
    sourceSpanIds: ["span-period"],
    pageStart: 5,
    pageEnd: 5,
    order: 5,
    path: "Policy > Declarations > Item 3 Policy Period Row",
  },
  {
    id: "premium-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Annual Premium Row",
    description: "Annual premium entry",
    textExcerpt: "Column 1: Annual Premium | Column 2: CAD $42,000",
    sourceSpanIds: ["span-premium"],
    pageStart: 6,
    pageEnd: 6,
    order: 6,
    path: "Policy > Declarations > Annual Premium Row",
  },
  {
    id: "business-continuation-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Business Continuation Row",
    description: "Business description continuation",
    textExcerpt: "Column 1: Named Insured | Column 2: holds delegated underwriting and binding authority from one or more",
    sourceSpanIds: ["span-business-continuation"],
    pageStart: 5,
    pageEnd: 5,
    order: 7,
    path: "Policy > Declarations > Business Continuation Row",
  },
  {
    id: "total-payable-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Total Payable Row",
    description: "Total payable entry",
    textExcerpt: "Column 1: Total Payable | Column 2: CAD $43,820",
    sourceSpanIds: ["span-total-payable"],
    pageStart: 6,
    pageEnd: 6,
    order: 8,
    path: "Policy > Declarations > Total Payable Row",
  },
  {
    id: "broker-page",
    documentId: "policy",
    parentId: "document",
    kind: "page",
    title: "Declarations Page 3",
    description: "Broker and forms",
    textExcerpt: "Item 12. Broker of Record Wellington Risk Partners Inc. RIBO Registration No. 1142208 (Ontario) Item 13. Forms",
    sourceSpanIds: ["span-broker"],
    pageStart: 7,
    pageEnd: 7,
    order: 9,
    path: "Policy > Declarations Page 3",
  },
];

describe("normalizeOperationalProfile", () => {
  it("drops polluted raw identity values instead of deriving declaration replacements", () => {
    const profile = normalizeOperationalProfile(
      {
        namedInsured: {
          value: ". THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY. _________________________ Page 1 of 27",
          confidence: "high",
          sourceNodeIds: ["jacket"],
          sourceSpanIds: ["span-jacket"],
        },
        broker: {
          value: "ERRORS AND OMISSIONS LIABILITY POLICY In consideration of the payment of the premium",
          confidence: "high",
          sourceNodeIds: ["jacket"],
          sourceSpanIds: ["span-jacket"],
        },
        policyTypes: ["professional_liability"],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.namedInsured).toBeUndefined();
    expect(profile.policyNumber).toBeUndefined();
    expect(profile.effectiveDate).toBeUndefined();
    expect(profile.expirationDate).toBeUndefined();
    expect(profile.premium).toBeUndefined();
    expect(profile.broker).toBeUndefined();
    expect(profile.insurer).toBeUndefined();
    expect(profile.policyTypes).toEqual(["professional_liability"]);
    expect(profile.parties).toEqual([]);
  });

  it("persists normalized source-backed identity values instead of address/contact blobs", () => {
    const profile = normalizeOperationalProfile(
      {
        namedInsured: {
          value: "Clarity Labs Inc. 1070 Bridgeview Way San Francisco, CA 94121 Risk Management & Notices Contact: Terrence Wang",
          normalizedValue: "Clarity Labs Inc.",
          confidence: "high",
          sourceNodeIds: ["named-insured-row"],
          sourceSpanIds: ["span-named-insured"],
        },
        policyTypes: ["professional_liability"],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.namedInsured?.value).toBe("Clarity Labs Inc.");
    expect(profile.parties.find((party: PolicyOperationalProfile["parties"][number]) => party.role === "named_insured")?.name)
      .toBe("Clarity Labs Inc.");
    expect(operationalProfilePolicyFields(profile).insuredName).toBe("Clarity Labs Inc.");
  });

  it("drops torn declaration table coverage fragments and repairs self-referential limits", () => {
    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["professional_liability"],
        coverages: [
          {
            name: "C. Regulatory Proceedings Sub-Limit",
            limit: "C. Regulatory Proceedings Sub-Limit",
            deductible: "$5,000 Each",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
            limits: [
              {
                kind: "sublimit",
                label: "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit)",
                value: "C. Regulatory Proceedings Sub-Limit",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
              {
                kind: "each_claim_limit",
                label: "Claim",
                value: "$100,000 Each Proceeding /",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
            ],
          },
          {
            name: "Coverage Part B)",
            limit: "Coverage Part B)",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
            limits: [
              {
                kind: "other",
                label: "Aggregate (sub-limit, part of",
                value: "Coverage Part B)",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
            ],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name))
      .toContain("C. Regulatory Proceedings Sub-Limit");
    expect(profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name))
      .not.toContain("Coverage Part B)");
    const regulatory = profile.coverages.find((coverage: PolicyOperationalProfile["coverages"][number]) =>
      coverage.name === "C. Regulatory Proceedings Sub-Limit"
    );
    expect(regulatory?.limit).toBe("$100,000 Each Proceeding");
    expect(regulatory?.limits?.map((term: NonNullable<PolicyOperationalProfile["coverages"][number]["limits"]>[number]) => term.value))
      .toEqual(["$100,000 Each Proceeding"]);
  });

  it("preserves model-provided endorsement support with source citations", () => {
    const endorsementSpans: SourceSpanLike[] = [
      {
        id: "loss-payee-1",
        text: "D. Loss Payee. For avoidance of doubt, no Scheduled Additional Insured is named as a loss payee, mortgageholder, or assignee of policy proceeds; nothing in this Endorsement entitles any Scheduled",
        pageStart: 28,
      },
      {
        id: "loss-payee-2",
        text: "Additional Insured to receive direct payment of any proceeds of this Policy.",
        pageStart: 28,
      },
    ];
    const endorsementTree = normalizeSourceTree([], endorsementSpans, "endorsement-policy");
    const lossPayeeNode = endorsementTree.find((node) => node.sourceSpanIds.includes("loss-payee-1"));
    if (!lossPayeeNode) throw new Error("Expected loss payee source node");

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["professional_liability"],
        endorsementSupport: [
          {
            kind: "loss_payee",
            status: "excluded",
            summary: `${endorsementSpans[0].text} ${endorsementSpans[1].text}`,
            sourceNodeIds: [lossPayeeNode.id],
            sourceSpanIds: ["loss-payee-1", "loss-payee-2"],
          },
        ],
      },
      endorsementTree,
      endorsementSpans,
    );

    const lossPayee = profile.endorsementSupport.find((row: PolicyOperationalProfile["endorsementSupport"][number]) =>
      row.kind === "loss_payee"
    );
    expect(lossPayee?.status).toBe("excluded");
    expect(lossPayee?.summary).toContain("direct payment of any proceeds");
  });

  it("persists model-backed declaration fields from flexible source rows", () => {
    const flexibleSpans: SourceSpanLike[] = [
      { id: "named", text: "Column 1: Named Insured | Column 2: Example Holdings Ltd.", pageStart: 1 },
      { id: "number", text: "Column 1: Policy No. | Column 2: GL-100", pageStart: 1 },
      { id: "term", text: "Column 1: Period of Insurance | Column 2: From: 03/01/2026 To: 03/01/2027", pageStart: 1 },
      { id: "premium", text: "Column 1: Total Premium | Column 2: $12,500", pageStart: 1 },
      { id: "broker", text: "Column 1: Broker | Column 2: Northshore Risk Advisors Inc.", pageStart: 1 },
    ];
    const flexibleTree: DocumentSourceNode[] = [
      {
        id: "document",
        documentId: "flexible-policy",
        kind: "document",
        title: "Commercial General Liability Policy",
        description: "Commercial General Liability Policy",
        sourceSpanIds: [],
        order: 0,
        path: "Policy",
      },
      ...flexibleSpans.map((span, index): DocumentSourceNode => ({
        id: `row-${index}`,
        documentId: "flexible-policy",
        parentId: "document",
        kind: "table_row",
        title: `Row ${index + 1}`,
        description: span.text ?? "",
        textExcerpt: span.text,
        sourceSpanIds: [span.id ?? ""],
        pageStart: 1,
        pageEnd: 1,
        order: index + 1,
        path: `Policy > Row ${index + 1}`,
      })),
    ];

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["general_liability"],
        namedInsured: {
          value: "Example Holdings Ltd.",
          confidence: "high",
          sourceNodeIds: ["row-0"],
          sourceSpanIds: ["named"],
        },
        policyNumber: {
          value: "GL-100",
          confidence: "high",
          sourceNodeIds: ["row-1"],
          sourceSpanIds: ["number"],
        },
        effectiveDate: {
          value: "03/01/2026",
          confidence: "high",
          sourceNodeIds: ["row-2"],
          sourceSpanIds: ["term"],
        },
        expirationDate: {
          value: "03/01/2027",
          confidence: "high",
          sourceNodeIds: ["row-2"],
          sourceSpanIds: ["term"],
        },
        premium: {
          value: "$12,500",
          confidence: "high",
          sourceNodeIds: ["row-3"],
          sourceSpanIds: ["premium"],
        },
        broker: {
          value: "Northshore Risk Advisors Inc.",
          confidence: "high",
          sourceNodeIds: ["row-4"],
          sourceSpanIds: ["broker"],
        },
      },
      flexibleTree,
      flexibleSpans,
    );

    expect(profile.namedInsured?.value).toBe("Example Holdings Ltd.");
    expect(profile.policyNumber?.value).toBe("GL-100");
    expect(profile.effectiveDate?.value).toBe("03/01/2026");
    expect(profile.expirationDate?.value).toBe("03/01/2027");
    expect(profile.premium?.value).toBe("$12,500");
    expect(profile.broker?.value).toBe("Northshore Risk Advisors Inc.");
    expect(profile.policyTypes).toEqual(["general_liability"]);
  });

  it("keeps model-backed life policy fields without document fallback candidates", () => {
    const lifeSpans: SourceSpanLike[] = [
      { id: "life-insurer-good", text: "Sun Life Assurance Company of Canada", pageStart: 1 },
      { id: "life-insurer-bad", text: "This phrase can mean Sun Life Assurance Company of Canad in context.", pageStart: 2 },
      { id: "life-policy-short", text: "Column 1: Policy Number | Column 2: LI-1234", pageStart: 3 },
      { id: "life-policy-full", text: "Policy number LI-1234,567-8", pageStart: 3 },
      { id: "life-insured", text: "Column 1: Owner | Column 2: Jim Doe", pageStart: 3 },
      { id: "life-coverage", text: "Sun Permanent Life Basic insurance coverage $X,XXX,XXX", pageStart: 4 },
    ];
    const lifeTree: DocumentSourceNode[] = [
      {
        id: "life-document",
        documentId: "life-policy",
        kind: "document",
        title: "Sun Permanent Life",
        description: "Sun Permanent Life",
        sourceSpanIds: [],
        order: 0,
        path: "Policy",
      },
      ...lifeSpans.map((span, index): DocumentSourceNode => ({
        id: span.id?.replace("life-", "node-") ?? `node-${index}`,
        documentId: "life-policy",
        parentId: "life-document",
        kind: index >= 2 && index <= 4 ? "table_row" : "text",
        title: `Life source ${index + 1}`,
        description: span.text ?? "",
        textExcerpt: span.text,
        sourceSpanIds: [span.id ?? ""],
        pageStart: span.pageStart,
        pageEnd: span.pageStart,
        order: index + 1,
        path: `Policy > Life source ${index + 1}`,
      })),
    ];

    const profile = normalizeOperationalProfile(
      {
        documentType: "policy",
        policyTypes: ["life"],
        policyNumber: {
          value: "LI-1234,567-8",
          confidence: "high",
          sourceNodeIds: ["node-policy-full"],
          sourceSpanIds: ["life-policy-full"],
        },
        namedInsured: {
          value: "Jim Doe",
          confidence: "high",
          sourceNodeIds: ["node-insured"],
          sourceSpanIds: ["life-insured"],
        },
        insurer: {
          value: "Sun Life Assurance Company of Canada",
          confidence: "high",
          sourceNodeIds: ["node-insurer-good"],
          sourceSpanIds: ["life-insurer-good"],
        },
        broker: {
          value: "s • immunosuppressive agents •",
          confidence: "high",
          sourceNodeIds: ["node-insurer-bad"],
          sourceSpanIds: ["life-insurer-bad"],
        },
        coverages: [
          {
            name: "Sun Permanent Life - Basic insurance coverage",
            limit: "$X,XXX,XXX",
            sourceNodeIds: ["node-coverage"],
            sourceSpanIds: ["life-coverage"],
          },
        ],
      },
      lifeTree,
      lifeSpans,
    );

    expect(profile.policyTypes).toEqual(["life"]);
    expect(profile.policyNumber?.value).toBe("LI-1234,567-8");
    expect(profile.namedInsured?.value).toBe("Jim Doe");
    expect(profile.insurer?.value).toBe("Sun Life Assurance Company of Canada");
    expect(profile.broker).toBeUndefined();
    expect(profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name)).toEqual([
      "Sun Permanent Life - Basic insurance coverage",
    ]);
  });

  it("preserves descriptive source-backed life benefit rows without adding uncited terms", () => {
    const benefitSpans: SourceSpanLike[] = [
      { id: "benefit-product", text: "Manulife Par with VitalityPlusTM", pageStart: 1 },
      { id: "benefit-death", text: "The death benefit is the amount we pay when the insured person dies.", pageStart: 3 },
      { id: "benefit-disability", text: "If the insured person becomes disabled, you can ask us to pay a disability benefit.", pageStart: 6 },
      { id: "benefit-catastrophic-heading", text: "Catastrophic disability", pageStart: 7 },
      { id: "benefit-catastrophic-age", text: "Any catastrophic disability must occur on or after the policy anniversary nearest the insured person’s 18th birthday.", pageStart: 7 },
      { id: "benefit-catastrophic-categories", text: "The 4 categories of catastrophic disability are:", pageStart: 7 },
    ];
    const benefitTree: DocumentSourceNode[] = [
      {
        id: "benefit-document",
        documentId: "benefit-policy",
        kind: "document",
        title: "Manulife Par",
        description: "Manulife Par",
        sourceSpanIds: [],
        order: 0,
        path: "Policy",
      },
      ...benefitSpans.map((span, index): DocumentSourceNode => ({
        id: `benefit-node-${index + 1}`,
        documentId: "benefit-policy",
        parentId: "benefit-document",
        kind: "text",
        title: span.text ?? "",
        description: span.text ?? "",
        textExcerpt: span.text,
        sourceSpanIds: [span.id ?? ""],
        pageStart: span.pageStart,
        pageEnd: span.pageStart,
        order: index + 1,
        path: `Policy > Benefit ${index + 1}`,
      })),
    ];

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["life", "disability"],
        coverages: [
          {
            name: "Manulife Par with VitalityPlusTM",
            formNumber: "1118-995",
            sourceNodeIds: ["benefit-node-1"],
            sourceSpanIds: ["benefit-product"],
          },
          {
            name: "Death benefit",
            limits: [
              {
                kind: "other",
                label: "Benefit description",
                value: "The death benefit is the amount we pay when the insured person dies.",
                appliesTo: "Death benefit",
                sourceNodeIds: ["benefit-node-2"],
                sourceSpanIds: ["benefit-death"],
              },
            ],
            sourceNodeIds: ["benefit-node-2"],
            sourceSpanIds: ["benefit-death"],
          },
          {
            name: "Disability benefit",
            limits: [
              {
                kind: "other",
                label: "Benefit description",
                value: "If the insured person becomes disabled, you can ask us to pay a disability benefit.",
                appliesTo: "Disability benefit",
                sourceNodeIds: ["benefit-node-3"],
                sourceSpanIds: ["benefit-disability"],
              },
            ],
            sourceNodeIds: ["benefit-node-3"],
            sourceSpanIds: ["benefit-disability"],
          },
          {
            name: "Unsupported benefit shell",
            sourceNodeIds: ["benefit-node-3"],
            sourceSpanIds: ["benefit-disability"],
          },
        ],
      },
      benefitTree,
      benefitSpans,
    );

    expect(profile.policyTypes).toEqual(["life", "disability"]);
    expect(profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name)).toEqual([
      "Manulife Par with VitalityPlusTM",
      "Death benefit",
      "Disability benefit",
    ]);
    expect(profile.coverages.find((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name === "Death benefit")?.limits?.[0]?.value)
      .toBe("The death benefit is the amount we pay when the insured person dies.");
    expect(profile.coverages.find((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name === "Disability benefit")?.limits)
      .toHaveLength(1);
  });

  it("keeps model-provided policy type and policy number without source-tree repair", () => {
    const spans: SourceSpanLike[] = [
      { id: "life-title", text: "Sun Permanent Life", pageStart: 1 },
      { id: "life-policy-number", text: "Policy number: LI-1234,567-8", pageStart: 1 },
      { id: "life-owner", text: "Owner: Jim Doe", pageStart: 1 },
      { id: "life-benefit", text: "Sun Permanent Life Basic insurance coverage Insurance amount: $X,XXX,XXX", pageStart: 4 },
    ];
    const tree = normalizeSourceTree([], spans, "life-policy");

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["other"],
        policyNumber: {
          value: "LI-1234",
          confidence: "high",
          sourceNodeIds: ["life-policy:source_node:text:life-policy-number"],
          sourceSpanIds: ["life-policy-number"],
        },
        coverages: [
          {
            name: "Sun Permanent Life - Basic insurance coverage",
            limit: "$X,XXX,XXX",
            sourceNodeIds: ["life-policy:source_node:text:life-benefit"],
            sourceSpanIds: ["life-benefit"],
          },
        ],
      },
      tree,
      spans,
    );

    expect(profile.policyTypes).toEqual(["other"]);
    expect(profile.policyNumber?.value).toBe("LI-1234");
  });

  it("keeps cited model policy numbers instead of replacing them from other source nodes", () => {
    const spans: SourceSpanLike[] = [
      { id: "cover-number", text: "Policy number: LI-1234,567-8", pageStart: 1 },
      { id: "summary-page", text: "Policy summary Plan: Sun Critical Illness Insurance - Term 75 Policy number: LI-1234,567-9 Policy date: October 2, 2017 Insured person: John Doe", pageStart: 4 },
    ];
    const tree = normalizeSourceTree([], spans, "term-policy");

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["critical_illness"],
        policyNumber: {
          value: "LI-1234,567-8",
          confidence: "high",
          sourceNodeIds: ["term-policy:source_node:text:cover-number"],
          sourceSpanIds: ["cover-number"],
        },
      },
      tree,
      spans,
    );

    expect(profile.policyNumber?.value).toBe("LI-1234,567-8");
    expect(profile.policyNumber?.sourceSpanIds).toEqual(["cover-number"]);
  });

  it("does not synthesize personal policy dates when the model omits them", () => {
    const spans: SourceSpanLike[] = [
      { id: "policy-date", text: "Column 1: Policy date | Column 2: 2021-10-18", pageStart: 4 },
      { id: "policy-ends", text: "Column 1: Date this policy ends | Column 2: 15 policy years Non-smoker / Smoker October 2, XXXX", pageStart: 5 },
    ];
    const tree = normalizeSourceTree([], spans, "term-policy");

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["critical_illness"],
      },
      tree,
      spans,
    );

    expect(profile.effectiveDate).toBeUndefined();
    expect(profile.expirationDate).toBeUndefined();
  });

  it("drops label-only policy numbers instead of repairing them from source evidence", () => {
    const spans: SourceSpanLike[] = [
      { id: "cover-number", text: "Policy number: LI-1234,567-8", pageStart: 1 },
      { id: "summary", text: "Policy summary Sun Par Protector II Policy number: LI-1234,567-8 Insured persons: John Doe Mary Doe", pageStart: 4 },
    ];
    const tree = normalizeSourceTree([], spans, "sunpar-policy");

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["life"],
        policyNumber: {
          value: "Policy number:",
          confidence: "medium",
          sourceNodeIds: ["sunpar-policy:source_node:text:cover-number"],
          sourceSpanIds: ["cover-number"],
        },
      },
      tree,
      spans,
    );

    expect(profile.policyNumber).toBeUndefined();
  });

  it("keeps model-provided placeholder coverage terms without source repair", () => {
    const spans: SourceSpanLike[] = [
      { id: "annual-premium", text: "If paying annually, the total initial annual premium for this policy is $XXX.XX.", pageStart: 5 },
    ];
    const tree = normalizeSourceTree([], spans, "sunpar-policy");
    const annualNodeId = tree.find((node) => node.kind === "text" && node.sourceSpanIds.includes("annual-premium"))?.id;
    expect(annualNodeId).toBeTruthy();

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["life"],
        coverages: [
          {
            name: "Joint last-to-die basic insurance coverage",
            limits: [
              {
                kind: "premium",
                label: "Total initial annual premium for this policy, if paying annually",
                value: "$XXX",
                appliesTo: "policy",
                sourceNodeIds: [annualNodeId],
                sourceSpanIds: ["annual-premium"],
              },
            ],
            sourceNodeIds: [annualNodeId],
            sourceSpanIds: ["annual-premium"],
          },
        ],
      },
      tree,
      spans,
    );

    expect(profile.coverages[0].limits?.[0]?.value).toBe("$XXX");
  });

  it("does not infer policy types from source evidence when the model returns other", () => {
    const spans: SourceSpanLike[] = [
      { id: "term-title", text: "Critical illness insurance", pageStart: 1 },
      { id: "term-benefits", text: "Critical illness insurance benefit | Total disability waiver | Long term care conversion option", pageStart: 5 },
    ];
    const tree = normalizeSourceTree([], spans, "term-policy");

    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["other"],
        coverages: [
          {
            name: "Critical illness insurance benefit",
            sourceNodeIds: ["term-policy:source_node:text:term-benefits"],
            sourceSpanIds: ["term-benefits"],
          },
        ],
      },
      tree,
      spans,
    );

    expect(profile.policyTypes).toEqual(["other"]);
  });

  it("drops generic coverage artifacts but keeps source-backed coverage rows", () => {
    const profile = normalizeOperationalProfile(
      {
        policyTypes: ["professional_liability"],
        coverages: [
          {
            name: "Part: A. Technology Errors & Omissions",
            limit: "$5,000,000",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
          },
          {
            name: "Row 1 Table row",
            limit: "$1,000,000",
            sourceNodeIds: ["policy-number-row"],
            sourceSpanIds: ["span-policy-number"],
          },
          {
            name: "Text Text",
            limit: "$25,000",
            sourceNodeIds: ["period-row"],
            sourceSpanIds: ["span-period"],
          },
          {
            name: "Part B Aggregate) Column 1: Regulatory Defense and Fines — Each",
            limit: "$500,000",
            sourceNodeIds: ["premium-row"],
            sourceSpanIds: ["span-premium"],
          },
          {
            name: "Bricking Loss — Each Loss /",
            limit: "$500,000",
            sourceNodeIds: ["premium-row"],
            sourceSpanIds: ["span-premium"],
          },
          {
            name: "Part A settlement, which erodes the AI/ML Output Each Claim Sub-Limit of",
            limit: "$1,000,000",
            sourceNodeIds: ["premium-row"],
            sourceSpanIds: ["span-premium"],
          },
          {
            name: "Part: AI/ML Output Sub-Limit (under",
            limit: "$1,000,000",
            sourceNodeIds: ["premium-row"],
            sourceSpanIds: ["span-premium"],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name)).toEqual([
      "Coverage Part A: Technology Errors & Omissions",
      "Regulatory Defense and Fines — Each",
      "Bricking Loss — Each Loss",
      "AI/ML Output Sub-Limit",
    ]);
  });
});

describe("normalizeSourceTree", () => {
  it("preserves valid semantic nodes and drops invalid tree references", () => {
    const tree = normalizeSourceTree([
      {
        id: "document",
        documentId: "policy",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: [],
        order: 0,
        path: "",
      },
      {
        id: "declarations",
        documentId: "policy",
        parentId: "document",
        kind: "page_group",
        title: "Declarations",
        description: "Declarations",
        sourceSpanIds: ["span-declarations", "missing-span"],
        order: 1,
        path: "",
      },
      {
        id: "orphan",
        documentId: "policy",
        parentId: "missing-parent",
        kind: "section",
        title: "Orphan",
        description: "Orphan",
        sourceSpanIds: [],
        order: 2,
        path: "",
      },
      {
        id: "cycle-a",
        documentId: "policy",
        parentId: "cycle-b",
        kind: "section",
        title: "Cycle A",
        description: "Cycle A",
        sourceSpanIds: [],
        order: 3,
        path: "",
      },
      {
        id: "cycle-b",
        documentId: "policy",
        parentId: "cycle-a",
        kind: "section",
        title: "Cycle B",
        description: "Cycle B",
        sourceSpanIds: [],
        order: 4,
        path: "",
      },
      {
        id: "",
        documentId: "policy",
        parentId: "document",
        kind: "section",
        title: "Invalid ID",
        description: "Invalid ID",
        sourceSpanIds: [],
        order: 5,
        path: "",
      },
    ], [
      { id: "span-declarations", text: "Declarations page", pageStart: 1 },
    ], "policy");

    const ids = new Set(tree.map((node) => node.id));
    expect(ids.has("declarations")).toBe(true);
    expect(ids.has("orphan")).toBe(false);
    expect(ids.has("cycle-a")).toBe(false);
    expect(ids.has("cycle-b")).toBe(false);
    expect(tree.find((node) => node.id === "declarations")?.sourceSpanIds)
      .toEqual(["span-declarations"]);
  });

  it("repairs tables and content nested under title-block text nodes", () => {
    const tree = normalizeSourceTree([
      {
        id: "document",
        documentId: "policy",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: [],
        order: 0,
        path: "",
      },
      {
        id: "page-6",
        documentId: "policy",
        parentId: "document",
        kind: "page",
        title: "Declarations",
        description: "Declarations page",
        sourceSpanIds: ["span-title"],
        pageStart: 6,
        pageEnd: 6,
        order: 1,
        path: "",
      },
      {
        id: "title-block",
        documentId: "policy",
        parentId: "page-6",
        kind: "text",
        title: "Coverage notice",
        description: "Coverage notice",
        textExcerpt: "Coverage notice",
        sourceSpanIds: ["span-title"],
        pageStart: 6,
        pageEnd: 6,
        order: 2,
        path: "",
        metadata: { organizer: "title_block" },
      },
      {
        id: "table-1",
        documentId: "policy",
        parentId: "title-block",
        kind: "table",
        title: "Declarations table",
        description: "Declarations table",
        sourceSpanIds: ["span-table"],
        pageStart: 6,
        pageEnd: 6,
        order: 3,
        path: "",
      },
      {
        id: "line-after-title",
        documentId: "policy",
        parentId: "title-block",
        kind: "text",
        title: "Text",
        description: "Continuation text",
        textExcerpt: "Continuation text",
        sourceSpanIds: ["span-continuation"],
        pageStart: 6,
        pageEnd: 6,
        order: 4,
        path: "",
      },
    ], [
      { id: "span-title", text: "Coverage notice", pageStart: 6 },
      { id: "span-table", text: "Coverage Part | Limit", pageStart: 6 },
      { id: "span-continuation", text: "Continuation text", pageStart: 6 },
    ], "policy");

    expect(tree.find((node) => node.id === "table-1")?.parentId).toBe("page-6");
    expect(tree.find((node) => node.id === "line-after-title")?.parentId).toBe("page-6");
  });

  it("keeps generated fallback source span IDs distinct for repeated table-cell text", () => {
    const tree = normalizeSourceTree([], [
      {
        text: "",
        sourceUnit: "table_cell",
        pageStart: 5,
        table: { tableId: "table-1", rowIndex: 0, columnIndex: 2 },
      },
      {
        text: "",
        sourceUnit: "table_cell",
        pageStart: 5,
        table: { tableId: "table-1", rowIndex: 1, columnIndex: 2 },
      },
    ], "policy");

    const spanIds = tree
      .filter((node) => node.kind === "table_cell")
      .flatMap((node) => node.sourceSpanIds);
    expect(new Set(spanIds).size).toBe(spanIds.length);
  });

});

describe("sourceTreePolicyFields", () => {
  it("preserves SDK multi-policy types when materializing stored policy fields", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        policyTypes: ["professional_liability", "cyber"],
        coverages: [
          {
            name: "A. Technology Errors & Omissions Liability",
            limit: "$5,000,000",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
          },
          {
            name: "B. Network Security & Privacy Liability (\"Cyber\")",
            limit: "$3,000,000",
            sourceNodeIds: ["policy-number-row"],
            sourceSpanIds: ["span-policy-number"],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
    });

    expect(operationalProfile.policyTypes).toEqual([
      "professional_liability",
      "cyber",
    ]);
    expect(fields.policyTypes).toEqual(["professional_liability", "cyber"]);
    expect(
      (fields.operationalProfile as PolicyOperationalProfile).policyTypes,
    ).toEqual(["professional_liability", "cyber"]);
  });

  it("materializes coverage term appliesTo context for policy storage", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        policyTypes: ["life"],
        coverages: [
          {
            name: "Death benefit",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
            limits: [
              {
                kind: "other",
                label: "Death benefit is the amount paid when the insured person dies",
                value: "The death benefit is the amount we pay when the insured person dies",
                appliesTo: "Death benefit",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
            ],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
    });

    const coverages = fields.coverages as Array<{ limits?: Array<{ appliesTo?: string }> }>;
    expect(coverages[0]?.limits?.[0]?.appliesTo).toBe("Death benefit");
  });

  it("does not promote coverage terms into named insured fields", () => {
    const spans: SourceSpanLike[] = [
      { id: "sunpar-policy-number", text: "Policy number: LI-1234,567-8", pageStart: 1 },
      { id: "sunpar-insured", text: "Insured persons: John Doe Mary Doe", pageStart: 4 },
      { id: "sunpar-limit", text: "Insurance amount: $X,XXX,XXX", pageStart: 4 },
    ];
    const tree = normalizeSourceTree([], spans, "sunpar-policy");
    const insuredNodeId = tree.find((node) => node.sourceSpanIds.includes("sunpar-insured"))?.id;
    expect(insuredNodeId).toBeTruthy();

    const operationalProfile = normalizeOperationalProfile(
      {
        policyTypes: ["life"],
        namedInsured: {
          value: "Jim Doe",
          confidence: "high",
          sourceNodeIds: [insuredNodeId],
          sourceSpanIds: ["sunpar-insured"],
        },
        coverages: [
          {
            name: "Sun Par Protector II",
            limit: "$X,XXX,XXX",
            sourceNodeIds: [insuredNodeId],
            sourceSpanIds: ["sunpar-insured"],
            limits: [
              {
                kind: "other",
                label: "Insured persons",
                value: "John Doe; Mary Doe",
                appliesTo: "Sun Par Protector II",
                sourceNodeIds: [insuredNodeId],
                sourceSpanIds: ["sunpar-insured"],
              },
            ],
          },
        ],
      },
      tree,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: tree,
      operationalProfile,
    });

    expect(operationalProfile.namedInsured?.value).toBe("Jim Doe");
    expect(fields.insuredName).toBe("Jim Doe");
    expect(operationalProfile.parties.find((party: PolicyOperationalProfile["parties"][number]) => party.role === "named_insured")?.name)
      .toBe("Jim Doe");
  });

  it("clears unsupported insured identity fields without deriving carrier or type", () => {
    const spans: SourceSpanLike[] = [
      { id: "manulife-product", text: "1118-995 | 024 09 30E Manulife Par with Vitality PlusTM", pageStart: 1 },
      { id: "manulife-death", text: "If the insured person dies during the grace period, we reduce the death benefit by the amount of the missed premium.", pageStart: 2 },
    ];
    const tree = normalizeSourceTree([], spans, "manulife-policy");
    const operationalProfile = normalizeOperationalProfile(
      {
        policyTypes: ["other"],
        namedInsured: {
          value: "person dies during the grace period, we reduce the death benefit by the amount of the missed",
          confidence: "high",
          sourceNodeIds: ["manulife-policy:source_node:text:manulife-death"],
          sourceSpanIds: ["manulife-death"],
        },
        insurer: {
          value: "for a loan, the rights of a collateral assignee or, under the Quebec Civil Code, a hypothecary creditor, may take preced",
          confidence: "high",
          sourceNodeIds: ["manulife-policy:source_node:text:manulife-death"],
          sourceSpanIds: ["manulife-death"],
        },
        premium: {
          value: "2",
          confidence: "high",
          sourceNodeIds: ["manulife-policy:source_node:text:manulife-death"],
          sourceSpanIds: ["manulife-death"],
        },
      },
      tree,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: tree,
      operationalProfile,
    });

    expect(fields.policyTypes).toEqual(["other"]);
    expect(fields.policyNumber).toBe("Unknown");
    expect(fields.insuredName).toBe("Unknown");
    expect(fields.carrier).toBe("Unknown");
    expect(fields.security).toBeUndefined();
    expect(fields).toHaveProperty("premium", undefined);
    expect(fields.premium).toBeUndefined();
    expect(operationalProfile.premium).toBeUndefined();
  });

  it("normalizes mixed annual premium and total due strings to the annual premium scalar", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        policyTypes: ["professional_liability"],
        premium: {
          value: "Total Due: $15,203.99 | Annual Premium | $14475",
          confidence: "high",
          sourceNodeIds: ["premium-row"],
          sourceSpanIds: ["span-premium"],
        },
      },
      sourceTree,
      sourceSpans,
    );

    expect(operationalProfile.premium?.value).toBe("$14,475");
    expect(operationalProfile.premium?.normalizedValue).toBe("14475");

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
    });
    expect(fields.premium).toBe("$14,475");
    expect(fields.premiumAmount).toBe(14475);
  });

  it("repairs polluted declaration fields from source-backed operational profile values", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        namedInsured: {
          value: "Cios Technologies Inc.",
          confidence: "high",
          sourceNodeIds: ["named-insured-row"],
          sourceSpanIds: ["span-named-insured"],
        },
        insurer: {
          value: "Saint Lawrence Specialty Insurance Company",
          confidence: "high",
          sourceNodeIds: ["insurer"],
          sourceSpanIds: ["span-insurer"],
        },
        effectiveDate: {
          value: "02/01/2026",
          confidence: "high",
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        },
        expirationDate: {
          value: "02/01/2027",
          confidence: "high",
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        },
        premium: {
          value: "CAD $42,000",
          confidence: "high",
          sourceNodeIds: ["premium-row"],
          sourceSpanIds: ["span-premium"],
        },
        policyTypes: ["professional_liability"],
      },
      sourceTree,
      sourceSpans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
      existingDeclarations: {
        fields: [
          {
            field: "namedInsured",
            value: ". THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY. _________________________ Page 1 of 27",
            sourceSpanIds: ["span-jacket"],
          },
          {
            field: "insurer",
            value: "policy jacket and claims-made notice. SAINT LAWRENCE SPECIALTY INSURANCE COMPANY Compagnie d'assurance spécialisée Saint",
            sourceSpanIds: ["span-jacket"],
          },
          {
            field: "policyNumber",
            value: "SLS-EO-26-110482",
            sourceSpanIds: ["span-policy-number"],
          },
        ],
      },
    });

    const declarations = fields.declarations as { fields: Array<{ field: string; value: string; sourceSpanIds: string[] }> };
    const byField = new Map(declarations.fields.map((field) => [field.field, field]));
    expect(byField.get("namedInsured")?.value).toBe("Cios Technologies Inc.");
    expect(byField.get("namedInsured")?.sourceSpanIds).toEqual(["span-named-insured"]);
    expect(byField.get("insurer")?.value).toBe("Saint Lawrence Specialty Insurance Company");
    expect(byField.get("policyPeriodStart")?.value).toBe("02/01/2026");
    expect(byField.get("policyPeriodEnd")?.value).toBe("02/01/2027");
    expect(byField.get("premium")?.value).toBe("CAD $42,000");
  });
});
