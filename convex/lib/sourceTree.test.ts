import { describe, expect, it } from "vitest";

import { buildCoverageBreakdown } from "./coverageBreakdown";
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
        linesOfBusiness: ["professional_liability"],
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
    expect(profile.linesOfBusiness).toEqual(["PL"]);
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
        linesOfBusiness: ["professional_liability"],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.namedInsured?.value).toBe("Clarity Labs Inc.");
    expect(profile.parties.find((party: PolicyOperationalProfile["parties"][number]) => party.role === "named_insured")?.name)
      .toBe("Clarity Labs Inc.");
    expect(operationalProfilePolicyFields(profile).insuredName).toBe("Clarity Labs Inc.");
  });

  it("keeps inferred scalar values when provenance is unavailable", () => {
    const profile = normalizeOperationalProfile(
      {
        policyNumber: {
          value: "SLS-EO-26-110482",
          confidence: "high",
          sourceNodeIds: ["missing-node"],
          sourceSpanIds: ["missing-span"],
        },
        linesOfBusiness: ["professional_liability"],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.policyNumber?.value).toBe("SLS-EO-26-110482");
    expect(profile.policyNumber?.confidence).toBe("low");
    expect(profile.policyNumber?.sourceNodeIds).toEqual([]);
    expect(profile.policyNumber?.sourceSpanIds).toEqual([]);
  });

  it("keeps inferred coverage rows and terms when provenance is unavailable", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["professional_liability"],
        coverages: [
          {
            name: "Technology Professional Liability",
            sourceNodeIds: ["missing-node"],
            sourceSpanIds: ["missing-span"],
            limits: [
              {
                kind: "each_claim_limit",
                label: "Each Claim",
                value: "$2,000,000",
                sourceNodeIds: ["missing-node"],
                sourceSpanIds: ["missing-span"],
              },
              {
                kind: "deductible",
                label: "Deductible",
                value: "$10,000",
              },
            ],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.coverages).toHaveLength(1);
    expect(profile.coverages[0].sourceNodeIds).toEqual([]);
    expect(profile.coverages[0].sourceSpanIds).toEqual([]);
    expect(profile.coverages[0].limits?.map((term: { label: string; value: string }) => [term.label, term.value])).toEqual([
      ["Each Claim", "$2,000,000"],
      ["Deductible", "$10,000"],
    ]);
  });

  it("drops torn declaration table coverage fragments and repairs self-referential limits", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["professional_liability"],
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
        linesOfBusiness: ["professional_liability"],
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
        linesOfBusiness: ["general_liability"],
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
    expect(profile.linesOfBusiness).toEqual(["CGL"]);
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
        linesOfBusiness: ["life"],
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

    expect(profile.linesOfBusiness).toEqual(["UN"]);
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
        linesOfBusiness: ["life", "disability"],
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

    expect(profile.linesOfBusiness).toEqual(["DISAB"]);
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
        linesOfBusiness: ["other"],
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

    expect(profile.linesOfBusiness).toEqual(["UN"]);
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
        linesOfBusiness: ["critical_illness"],
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
        linesOfBusiness: ["critical_illness"],
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
        linesOfBusiness: ["life"],
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

  it("keeps policy billing out of coverage rows even when the model labels it as coverage", () => {
    const spans: SourceSpanLike[] = [
      { id: "annual-premium", text: "If paying annually, the total initial annual premium for this policy is $XXX.XX.", pageStart: 5 },
    ];
    const tree = normalizeSourceTree([], spans, "sunpar-policy");
    const annualNodeId = tree.find((node) => node.kind === "text" && node.sourceSpanIds.includes("annual-premium"))?.id;
    expect(annualNodeId).toBeTruthy();

    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["life"],
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

    expect(profile.coverages).toEqual([]);
  });

  it("infers policy types from extracted coverage labels when the model returns other", () => {
    const spans: SourceSpanLike[] = [
      { id: "term-title", text: "Critical illness insurance", pageStart: 1 },
      { id: "term-benefits", text: "Critical illness insurance benefit | Total disability waiver | Long term care conversion option", pageStart: 5 },
    ];
    const tree = normalizeSourceTree([], spans, "term-policy");

    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["other"],
        coverages: [
          {
            name: "Critical illness insurance benefit",
            limits: [
              {
                kind: "other",
                label: "Benefit",
                value: "$50,000",
                sourceNodeIds: ["term-policy:source_node:text:term-benefits"],
                sourceSpanIds: ["term-benefits"],
              },
            ],
            sourceNodeIds: ["term-policy:source_node:text:term-benefits"],
            sourceSpanIds: ["term-benefits"],
          },
        ],
      },
      tree,
      spans,
    );

    expect(profile.linesOfBusiness).toEqual(["DISAB"]);
    expect(profile.warnings).toEqual([]);
  });

  it("infers multiple commercial policy types from coverage lines", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["other"],
        coverages: [
          {
            name: "Commercial General Liability",
            limits: [
              {
                kind: "aggregate_limit",
                label: "General Aggregate Limit",
                value: "$5,000,000",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
            ],
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
          },
          {
            name: "Errors and Omissions Liability - Claims Made",
            limits: [
              {
                kind: "each_claim_limit",
                label: "Each Claim Limit",
                value: "$250,000",
                sourceNodeIds: ["policy-number-row"],
                sourceSpanIds: ["span-policy-number"],
              },
            ],
            sourceNodeIds: ["policy-number-row"],
            sourceSpanIds: ["span-policy-number"],
          },
          {
            name: "Commercial Auto Physical Damage",
            limits: [
              {
                kind: "each_loss_limit",
                label: "Maximum per Auto",
                value: "$250,000",
                sourceNodeIds: ["premium-row"],
                sourceSpanIds: ["span-premium"],
              },
            ],
            sourceNodeIds: ["premium-row"],
            sourceSpanIds: ["span-premium"],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.linesOfBusiness).toEqual([
      "CGL",
      "EO",
      "AUTOB",
    ]);
  });

  it("uses coverage-backed policy types before specific model hints", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["inland_marine"],
        coverages: [
          {
            name: "Motor Truck Cargo Legal Liability",
            limits: [
              {
                kind: "each_occurrence_limit",
                label: "Per Occurrence Limit",
                value: "$250,000",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
            ],
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
          },
          {
            name: "Commercial Auto Physical Damage",
            limits: [
              {
                kind: "other",
                label: "Maximum Limit at Any One Vehicle",
                value: "Actual Cash Value of Scheduled Autos",
                sourceNodeIds: ["policy-number-row"],
                sourceSpanIds: ["span-policy-number"],
              },
            ],
            sourceNodeIds: ["policy-number-row"],
            sourceSpanIds: ["span-policy-number"],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.linesOfBusiness).toEqual(["INMRC", "AUTOB"]);
  });

  it("does not keep a conflicting model policy type when coverage evidence is specific", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["cyber"],
        coverages: [
          {
            name: "Commercial Auto Physical Damage",
            limits: [
              {
                kind: "other",
                label: "Maximum Limit at Any One Vehicle",
                value: "Actual Cash Value of Scheduled Autos",
                sourceNodeIds: ["policy-number-row"],
                sourceSpanIds: ["span-policy-number"],
              },
            ],
            sourceNodeIds: ["policy-number-row"],
            sourceSpanIds: ["span-policy-number"],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.linesOfBusiness).toEqual(["AUTOB"]);
  });

  it("drops generic coverage artifacts but keeps source-backed coverage rows", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["professional_liability"],
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

  it("drops coverage amounts that appear only as a different cited magnitude", () => {
    const spans: SourceSpanLike[] = [
      {
        id: "statutory-notice",
        text: `
          This statutory notice contains a $100 billion government reimbursement cap.
          The annual charge attributable to the optional protection is $0.
        `,
        pageStart: 2,
      },
    ];
    const tree = normalizeSourceTree([], spans, "policy");
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["property"],
        coverages: [
          {
            name: "Statutory Reimbursement Notice",
            limit: "$100",
            sourceSpanIds: ["statutory-notice"],
            sourceNodeIds: [],
            limits: [
              {
                kind: "other",
                label: "Statutory cap",
                value: "$100",
                sourceSpanIds: ["statutory-notice"],
                sourceNodeIds: [],
              },
            ],
          },
        ],
      },
      tree,
      spans,
    );

    expect(profile.coverages).toEqual([]);
  });

  it("keeps a coverage amount when the cited source contains that exact magnitude", () => {
    const spans: SourceSpanLike[] = [
      {
        id: "coverage-terms",
        text: "Personal Property Coverage Limit $5,000. Deductible $100.",
        pageStart: 3,
      },
    ];
    const tree = normalizeSourceTree([], spans, "policy");
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["property"],
        coverages: [
          {
            name: "Personal Property",
            limit: "$5,000",
            deductible: "$100",
            sourceSpanIds: ["coverage-terms"],
            sourceNodeIds: [],
          },
        ],
      },
      tree,
      spans,
    );

    expect(profile.coverages[0]?.limit).toBe("$5,000");
    expect(profile.coverages[0]?.deductible).toBe("$100");
  });

});

describe("sourceTreePolicyFields", () => {
  it("materializes source-backed carrier product identity separately from ACORD classification", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["travel"],
        productIdentity: {
          name: {
            value: "Trip Cancellation & Interruption Plan",
            confidence: "high",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
          },
          companyProductCode: {
            value: "TCI",
            confidence: "high",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
          },
        },
        coverages: [{
          name: "Travel Delay",
          sourceNodeIds: ["named-insured-row"],
          sourceSpanIds: ["span-named-insured"],
        }],
      },
      sourceTree,
      sourceSpans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
    });

    expect(fields.linesOfBusiness).toEqual(["TRVL"]);
    expect(fields.programName).toBe(
      "Trip Cancellation & Interruption Plan",
    );
    expect(fields.productIdentity).toMatchObject({
      name: {
        value: "Trip Cancellation & Interruption Plan",
        confidence: "high",
        sourceNodeIds: ["named-insured-row"],
        sourceSpanIds: ["span-named-insured"],
      },
      companyProductCode: { value: "TCI" },
    });
  });

  it("clears stale carrier product projections when final evidence has no product identity", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["travel"],
        coverages: [],
      },
      sourceTree,
      sourceSpans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
      existingPolicyFields: {
        programName: "Previous Travel Plan",
        productIdentity: {
          name: {
            value: "Previous Travel Plan",
            sourceNodeIds: ["old-product-node"],
            sourceSpanIds: ["old-product-span"],
          },
        },
      },
    });

    expect(fields).toHaveProperty("programName", undefined);
    expect(fields).toHaveProperty("productIdentity", undefined);
    expect(fields.sourceTreeFieldClears).toEqual([
      "productIdentity",
      "programName",
    ]);
  });

  it("keeps source-backed product codes while clearing a stale product name", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["travel"],
        productIdentity: {
          companyProductCode: {
            value: "TCI",
            confidence: "high",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
          },
        },
        coverages: [],
      },
      sourceTree,
      sourceSpans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
      existingPolicyFields: {
        programName: "Previous Travel Plan",
      },
    });

    expect(fields).toHaveProperty("programName", undefined);
    expect(fields.sourceTreeFieldClears).toEqual(["programName"]);
    expect(fields.productIdentity).toMatchObject({
      companyProductCode: {
        value: "TCI",
        confidence: "high",
        sourceNodeIds: ["named-insured-row"],
        sourceSpanIds: ["span-named-insured"],
      },
    });
  });

  it("uses preliminary policy types as hints when coverage evidence is not classifiable", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["other"],
        namedInsured: {
          value: "Cios Technologies Inc.",
          sourceNodeIds: ["named-insured-row"],
          sourceSpanIds: ["span-named-insured"],
        },
      },
      sourceTree,
      sourceSpans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
      existingLinesOfBusiness: ["professional_liability"],
    });

    expect(fields.linesOfBusiness).toEqual(["PL"]);
    expect(fields.linesOfBusiness).toEqual(["PL"]);
    expect((fields.operationalProfile as PolicyOperationalProfile).linesOfBusiness).toEqual(["PL"]);
    expect((fields.operationalProfile as PolicyOperationalProfile).warnings).toEqual([]);
  });

  it("preserves SDK multi-policy types when materializing stored policy fields", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["professional_liability", "cyber"],
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

    expect(operationalProfile.linesOfBusiness).toEqual([
      "EO",
      "TECH",
      "CYBER",
    ]);
    expect(fields.linesOfBusiness).toEqual(["EO", "TECH", "CYBER"]);
    expect(fields.linesOfBusiness).toEqual(["EO", "TECH", "CYBER"]);
    expect(
      (fields.operationalProfile as PolicyOperationalProfile).linesOfBusiness,
    ).toEqual(["EO", "TECH", "CYBER"]);
  });

  it("materializes coverage term appliesTo context for policy storage", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["life"],
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
        linesOfBusiness: ["life"],
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
        linesOfBusiness: ["other"],
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

    expect(fields.linesOfBusiness).toEqual(["UN"]);
    expect(fields.linesOfBusiness).toEqual(["UN"]);
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
        linesOfBusiness: ["professional_liability"],
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
        linesOfBusiness: ["professional_liability"],
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

  it("projects coverage line of business into stored coverages and breakdown groups", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["CGL"],
        coverages: [
          {
            name: "Commercial General Liability",
            lineOfBusiness: "CGL",
            limits: [
              {
                kind: "each_occurrence_limit",
                label: "Each Occurrence",
                value: "$1,000,000",
                sourceNodeIds: ["period-row"],
                sourceSpanIds: ["span-period"],
              },
            ],
            sourceNodeIds: ["period-row"],
            sourceSpanIds: ["span-period"],
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

    expect((fields.coverages as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({ lineOfBusiness: "CGL" }),
    );
    const breakdown = buildCoverageBreakdown(fields);
    expect(breakdown.groups).toEqual([
      expect.objectContaining({
        lineOfBusiness: "CGL",
        label: "General Liability",
      }),
    ]);
  });

  it("preserves source-backed policy party addresses and operations descriptions", () => {
    const spans: SourceSpanLike[] = [
      { id: "span-insured-address", text: "Named Insured Acme LLC 1 Client St Toronto ON M5A 1A1" },
      { id: "span-producer-address", text: "Producer Broker LLC License PR-123 2 Broker St Toronto ON M5B 1B1" },
      { id: "span-insurer-address", text: "Insurer Fortegra Specialty Insurance Company NAIC 16823 3 Carrier St Toronto ON M5C 1C1" },
      { id: "span-general-agent-address", text: "General Agent Diesel Insurance Solutions Inc. License 21058436 4 General Agent St Toronto ON M5D 1D1" },
      { id: "span-operations", text: "Business operations software implementation services" },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "document",
        documentId: "policy-parties",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: spans.map((span) => String(span.id)),
        order: 0,
        path: "Policy",
      },
      {
        id: "declarations",
        documentId: "policy-parties",
        parentId: "document",
        kind: "section",
        title: "Declarations",
        description: "Declarations",
        sourceSpanIds: spans.map((span) => String(span.id)),
        order: 1,
        path: "Policy / Declarations",
      },
    ];
    const profile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
        parties: [
          { role: "named_insured", name: "Acme LLC", address: { street1: "1 Client St", city: "Toronto", state: "ON", zip: "M5A 1A1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-insured-address"] },
          { role: "producer", name: "Broker LLC", licenseNumber: "PR-123", address: { street1: "2 Broker St", city: "Toronto", state: "ON", zip: "M5B 1B1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-producer-address"] },
          { role: "insurer", name: "Fortegra Specialty Insurance Company", naicNumber: "16823", address: { street1: "3 Carrier St", city: "Toronto", state: "ON", zip: "M5C 1C1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-insurer-address"] },
          { role: "general_agent", name: "Diesel Insurance Solutions Inc.", licenseNumber: "21058436", address: { street1: "4 General Agent St", city: "Toronto", state: "ON", zip: "M5D 1D1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-general-agent-address"] },
        ],
        operationsDescription: {
          value: "Software implementation services",
          sourceNodeIds: ["declarations"],
          sourceSpanIds: ["span-operations"],
        },
      },
      nodes,
      spans,
    );

    expect((profile as any).operationsDescription).toMatchObject({
      value: "Software implementation services",
      sourceSpanIds: ["span-operations"],
    });
    expect((profile.parties as any[]).find((party) => party.role === "general_agent")).toMatchObject({
      name: "Diesel Insurance Solutions Inc.",
      licenseNumber: "21058436",
      address: { street1: "4 General Agent St" },
    });

    const fields = operationalProfilePolicyFields(profile, {
      insurer: { legalName: "Fortegra Specialty Insurance Company" },
      producer: { agencyName: "Broker LLC", phone: "555-0100" },
    });
    expect(fields.insuredAddress).toMatchObject({ street1: "1 Client St" });
    expect(fields.insuredAddress).toMatchObject({
      documentNodeId: "declarations",
      sourceSpanIds: ["span-insured-address"],
    });
    expect(fields.producer).toMatchObject({
      agencyName: "Broker LLC",
      licenseNumber: "PR-123",
      phone: "555-0100",
      address: { street1: "2 Broker St" },
      sourceSpanIds: ["span-producer-address"],
    });
    expect(fields.brokerLicenseNumber).toBe("PR-123");
    expect(fields.insurer).toMatchObject({
      legalName: "Fortegra Specialty Insurance Company",
      naicNumber: "16823",
      address: { street1: "3 Carrier St" },
      sourceSpanIds: ["span-insurer-address"],
    });
    expect(fields.carrierNaicNumber).toBe("16823");
    expect(fields.generalAgent).toMatchObject({
      agencyName: "Diesel Insurance Solutions Inc.",
      licenseNumber: "21058436",
      address: { street1: "4 General Agent St" },
    });
  });

  it("preserves multiple legal insurers while using an operating-as name for display", () => {
    const carrierText =
      "CUMIS General Insurance Company, a member of The Co-operators group of companies and/or AZGA Service Canada Inc. operating as Allianz Global Assistance (AGA).";
    const spans: SourceSpanLike[] = [
      {
        id: "span-carrier-identity",
        text: carrierText,
        pageStart: 1,
      },
      {
        id: "span-azga-details",
        text: "AZGA Service Canada Inc. NAIC 54321 100 Secondary St Toronto ON M5V 1A1",
        pageStart: 1,
      },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "document",
        documentId: "carrier-identity-policy",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: ["span-carrier-identity"],
        order: 0,
        path: "Policy",
      },
      {
        id: "carrier-identity",
        documentId: "carrier-identity-policy",
        parentId: "document",
        kind: "section",
        title: "Carrier identity",
        description: carrierText,
        textExcerpt: carrierText,
        sourceSpanIds: ["span-carrier-identity"],
        order: 1,
        path: "Policy / Carrier identity",
      },
      {
        id: "azga-details",
        documentId: "carrier-identity-policy",
        parentId: "document",
        kind: "section",
        title: "Secondary insurer details",
        description: spans[1].text,
        textExcerpt: spans[1].text,
        sourceSpanIds: ["span-azga-details"],
        order: 2,
        path: "Policy / Secondary insurer details",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        insurer: {
          value: "CUMIS General Insurance Company",
          sourceNodeIds: ["carrier-identity"],
          sourceSpanIds: ["span-carrier-identity"],
        },
        parties: [
          {
            role: "insurer",
            name: "CUMIS General Insurance Company",
            sourceNodeIds: ["carrier-identity"],
            sourceSpanIds: ["span-carrier-identity"],
          },
          {
            role: "insurer",
            name: "AZGA Service Canada Inc.",
            naicNumber: "54321",
            address: {
              street1: "100 Secondary St",
              city: "Toronto",
              state: "ON",
              zip: "M5V 1A1",
            },
            sourceNodeIds: ["azga-details"],
            sourceSpanIds: ["span-azga-details"],
          },
          {
            role: "general_agent",
            name: "Allianz Global Assistance",
            sourceNodeIds: ["carrier-identity"],
            sourceSpanIds: ["span-carrier-identity"],
          },
        ],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrier).toBe("Allianz Global Assistance");
    expect(fields.carrierIdentity).toEqual({
      displayName: "Allianz Global Assistance",
      sourceName: "Allianz Global Assistance",
      operatingName: "Allianz Global Assistance",
      legalEntities: [
        {
          name: "CUMIS General Insurance Company",
          sourceNodeIds: ["carrier-identity"],
          sourceSpanIds: ["span-carrier-identity"],
        },
        {
          name: "AZGA Service Canada Inc.",
          sourceNodeIds: ["azga-details", "carrier-identity"],
          sourceSpanIds: ["span-azga-details", "span-carrier-identity"],
        },
      ],
      legalEntityRelationship: "and_or",
      sourceNodeIds: ["carrier-identity", "azga-details"],
      sourceSpanIds: ["span-carrier-identity", "span-azga-details"],
    });
    expect(fields.carrierLegalName).toBe(
      "CUMIS General Insurance Company",
    );
    expect(fields.security).toBeUndefined();
    expect(fields.generalAgent).toBeUndefined();
    expect(fields.mga).toBeUndefined();
    expect(fields.insurer).toMatchObject({
      legalName: "CUMIS General Insurance Company",
    });
    expect(fields.insurer).not.toHaveProperty("address");
    expect(fields.insurer).not.toHaveProperty("naicNumber");
    expect(fields.carrierNaicNumber).toBeUndefined();
  });

  it("does not promote an unrelated named-insured DBA to carrier identity", () => {
    const spans: SourceSpanLike[] = [
      {
        id: "span-insured-dba",
        text: "Acme Holdings LLC doing business as Acme Restaurant.",
        pageStart: 1,
      },
      {
        id: "span-actual-carrier",
        text: "Insurer: HDI Global Specialty SE",
        pageStart: 1,
      },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "named-insured",
        documentId: "insured-dba-policy",
        kind: "section",
        title: "Named insured",
        description: spans[0].text,
        textExcerpt: spans[0].text,
        sourceSpanIds: ["span-insured-dba"],
        order: 0,
        path: "Policy / Named insured",
      },
      {
        id: "actual-carrier",
        documentId: "insured-dba-policy",
        kind: "section",
        title: "Insurer",
        description: spans[1].text,
        textExcerpt: spans[1].text,
        sourceSpanIds: ["span-actual-carrier"],
        order: 1,
        path: "Policy / Insurer",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["GL"],
        coverages: [],
        insurer: {
          value: "HDI Global Specialty SE",
          sourceNodeIds: ["actual-carrier"],
          sourceSpanIds: ["span-actual-carrier"],
        },
        parties: [
          {
            role: "named_insured",
            name: "Acme Holdings LLC",
            sourceNodeIds: ["named-insured"],
            sourceSpanIds: ["span-insured-dba"],
          },
          {
            role: "insurer",
            name: "HDI Global Specialty SE",
            sourceNodeIds: ["actual-carrier"],
            sourceSpanIds: ["span-actual-carrier"],
          },
        ],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrier).toBe("HDI Global Specialty SE");
    expect(fields.carrierLegalName).toBe("HDI Global Specialty SE");
    expect(fields.carrierIdentity).toEqual({
      displayName: "HDI Global Specialty SE",
      sourceName: "HDI Global Specialty SE",
      legalEntities: [{
        name: "HDI Global Specialty SE",
        sourceNodeIds: ["actual-carrier"],
        sourceSpanIds: ["span-actual-carrier"],
      }],
      legalEntityRelationship: "single",
      sourceNodeIds: ["actual-carrier"],
      sourceSpanIds: ["span-actual-carrier"],
    });
  });

  it("does not promote an incidental Lloyd's clause over the actual carrier", () => {
    const spans: SourceSpanLike[] = [
      {
        id: "span-actual-carrier",
        text: "Insurer: HDI Global Specialty SE",
        pageStart: 1,
      },
      {
        id: "span-prior-policy-carrier",
        text:
          "Prior policy: Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472",
        pageStart: 4,
      },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "actual-carrier",
        documentId: "incidental-lloyds-policy",
        kind: "section",
        title: "Insurer",
        description: spans[0].text,
        textExcerpt: spans[0].text,
        sourceSpanIds: ["span-actual-carrier"],
        order: 0,
        path: "Policy / Insurer",
      },
      {
        id: "prior-insurance",
        documentId: "incidental-lloyds-policy",
        kind: "section",
        title: "Prior insurance",
        description: spans[1].text,
        textExcerpt: spans[1].text,
        sourceSpanIds: ["span-prior-policy-carrier"],
        order: 1,
        path: "Policy / Prior insurance",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["GL"],
        coverages: [],
        insurer: {
          value: "HDI Global Specialty SE",
          sourceNodeIds: ["actual-carrier"],
          sourceSpanIds: ["span-actual-carrier"],
        },
        parties: [{
          role: "insurer",
          name: "HDI Global Specialty SE",
          sourceNodeIds: ["actual-carrier"],
          sourceSpanIds: ["span-actual-carrier"],
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrier).toBe("HDI Global Specialty SE");
    expect(fields.carrierIdentity).toEqual({
      displayName: "HDI Global Specialty SE",
      sourceName: "HDI Global Specialty SE",
      legalEntities: [{
        name: "HDI Global Specialty SE",
        sourceNodeIds: ["actual-carrier"],
        sourceSpanIds: ["span-actual-carrier"],
      }],
      legalEntityRelationship: "single",
      sourceNodeIds: ["actual-carrier"],
      sourceSpanIds: ["span-actual-carrier"],
    });
  });

  it("requires generic Lloyd's parties to share provenance with the led-by clause", () => {
    const canonicalText =
      "Lloyd's Underwriters led by Canonical Managing Agency Limited Syndicate 1234";
    const unrelatedText =
      "Underlying policy: Lloyd's Underwriters led by Unrelated Managing Agency Limited Syndicate 1111 and Syndicate 2222";
    const spans: SourceSpanLike[] = [
      {
        id: "canonical-lloyds-span",
        text: canonicalText,
        pageStart: 1,
      },
      {
        id: "unrelated-lloyds-span",
        text: unrelatedText,
        pageStart: 4,
      },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "canonical-lloyds-carrier",
        documentId: "generic-lloyds-policy",
        kind: "section",
        title: "Insurer",
        description: canonicalText,
        textExcerpt: canonicalText,
        sourceSpanIds: ["canonical-lloyds-span"],
        order: 0,
        path: "Policy / Insurer",
      },
      {
        id: "underlying-lloyds-reference",
        documentId: "generic-lloyds-policy",
        kind: "section",
        title: "Underlying policy",
        description: unrelatedText,
        textExcerpt: unrelatedText,
        sourceSpanIds: ["unrelated-lloyds-span"],
        order: 1,
        path: "Policy / Underlying policy",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        parties: [{
          role: "carrier",
          name: "Lloyd's Underwriters",
          sourceNodeIds: ["canonical-lloyds-carrier"],
          sourceSpanIds: ["canonical-lloyds-span"],
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toMatchObject({
      displayName: "Canonical Managing Agency Limited",
      sourceName:
        "Lloyd's Underwriters led by: Canonical Managing Agency Limited, Syndicate No. 1234",
      sourceNodeIds: ["canonical-lloyds-carrier"],
      sourceSpanIds: ["canonical-lloyds-span"],
    });
  });

  it("preserves Lloyd's lead underwriter and syndicates from source evidence", () => {
    const carrierText = [
      "LLOYD'S UNDERWRITERS LED BY: TOKIO",
      "MARINE KILN, SYNDICATE NO. 0510 KLN",
      "AND SYNDICATE NO. 1880 KLN UNDER",
      "CONTRACT NUMBER PG109C/26-PC(L)",
    ];
    const spans: SourceSpanLike[] = carrierText.map((text, index) => ({
      id: `span-carrier-${index + 1}`,
      text,
      pageStart: 2,
    }));
    const nodes: DocumentSourceNode[] = [
      {
        id: "document",
        documentId: "tokio-policy",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: spans.map((span) => span.id as string),
        order: 0,
        path: "Policy",
      },
      {
        id: "carrier-identity",
        documentId: "tokio-policy",
        parentId: "document",
        kind: "section",
        title: "Insurer",
        description: carrierText.join(" "),
        textExcerpt: carrierText.join(" "),
        sourceSpanIds: spans.map((span) => span.id as string),
        order: 1,
        path: "Policy / Insurer",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        insurer: {
          value: "Lloyd's Underwriters",
          sourceNodeIds: ["carrier-identity"],
          sourceSpanIds: spans.map((span) => span.id as string),
        },
        parties: [{
          role: "carrier",
          name: "Lloyd's Underwriters",
          sourceNodeIds: ["carrier-identity"],
          sourceSpanIds: spans.map((span) => span.id as string),
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrier).toBe("Tokio Marine Kiln");
    expect(fields.carrierIdentity).toMatchObject({
      displayName: "Tokio Marine Kiln",
      sourceName:
        "Lloyd's Underwriters led by: Tokio Marine Kiln, Syndicate No. 0510 KLN and Syndicate No. 1880 KLN, under contract number PG109C/26-PC(L)",
      legalEntities: [
        { name: "Tokio Marine Kiln, Syndicate No. 0510 KLN" },
        { name: "Tokio Marine Kiln, Syndicate No. 1880 KLN" },
      ],
      legalEntityRelationship: "and",
      sourceNodeIds: ["carrier-identity"],
      sourceSpanIds: spans.map((span) => span.id as string),
    });
    expect(fields.carrierLegalName).toBe(
      "Tokio Marine Kiln, Syndicate No. 0510 KLN",
    );
    expect(fields.security).toBeUndefined();
  });

  it("ranks a clean Liberty insurer span above an earlier contaminated page block", () => {
    const coarseText =
      "LLOYD'S UNDERWRITERS LED BY Liberty Managing Agency Limited Syndicate 4472 Premium $48,000 Coverage Limit $5,000,000";
    const cleanText =
      "LLOYD'S UNDERWRITERS LED BY Liberty Managing Agency Limited Syndicate 4472";
    const spans: SourceSpanLike[] = [
      {
        id: "liberty-page",
        text: coarseText,
        pageStart: 1,
        sourceUnit: "page",
      },
      {
        id: "liberty-insurer",
        text: cleanText,
        pageStart: 2,
        sourceUnit: "text",
      },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "document",
        documentId: "liberty-policy",
        kind: "document",
        title: "Policy",
        description: coarseText,
        textExcerpt: coarseText,
        sourceSpanIds: ["liberty-page"],
        order: 0,
        path: "Policy",
      },
      {
        id: "insurer-clause",
        documentId: "liberty-policy",
        parentId: "document",
        kind: "clause",
        title: "Insurer",
        description: cleanText,
        textExcerpt: cleanText,
        sourceSpanIds: ["liberty-insurer"],
        order: 1,
        path: "Policy / Insurer",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        parties: [{
          role: "carrier",
          name: "Lloyd's Underwriters",
          sourceNodeIds: ["insurer-clause"],
          sourceSpanIds: ["liberty-insurer"],
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toMatchObject({
      displayName: "Liberty Managing Agency Limited",
      sourceName:
        "Lloyd's Underwriters led by: Liberty Managing Agency Limited, Syndicate No. 4472",
      sourceNodeIds: ["insurer-clause"],
      sourceSpanIds: ["liberty-insurer"],
    });
  });

  it("does not absorb reordered Liberty coverage and premium cells into the lead", () => {
    const coarseText =
      "THE INSURERS COVERAGE INSURED PREMIUM Lloyd's Underwriters led by Liberty Managing Agency Limited Premises Pollution Liability 100% $2,100 Syndicate 4472 under Contract No. B2429BW2508154";
    const cleanText =
      "Lloyd's Underwriters led by Liberty Managing Agency Limited Syndicate 4472 under Contract No. B2429BW2508154 Forward Insurance Managers Ltd. THE INSURERS COVERAGE INSURED Premises Pollution Liability 100% PREMIUM $2,100";
    const spans: SourceSpanLike[] = [
      {
        id: "liberty-reordered-page",
        text: coarseText,
        pageStart: 3,
        sourceUnit: "page",
      },
      {
        id: "liberty-insurer-block",
        text: cleanText,
        pageStart: 3,
        sourceUnit: "text",
        bbox: [{
          page: 3,
          x: 39,
          y: 274,
          width: 516,
          height: 104,
        }],
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        parties: [{
          role: "insurer",
          name: "Lloyd's Underwriters",
          sourceNodeIds: [],
          sourceSpanIds: ["liberty-insurer-block"],
        }],
      },
      [],
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: [],
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toMatchObject({
      displayName: "Liberty Managing Agency Limited",
      sourceName:
        "Lloyd's Underwriters led by: Liberty Managing Agency Limited, Syndicate No. 4472, under contract no. B2429BW2508154",
      legalEntities: [{
        name: "Liberty Managing Agency Limited, Syndicate No. 4472",
      }],
      sourceSpanIds: ["liberty-insurer-block"],
    });
  });

  it("preserves multiple Tokio Marine Kiln syndicates and Contract No.", () => {
    const texts = [
      "LLOYD'S UNDERWRITERS LED BY Tokio Marine Kiln",
      "Syndicate No. 0510 KLN and Syndicate No. 1880 KLN",
      "under Contract No. PG109C/26-PC(L)",
    ];
    const spans: SourceSpanLike[] = texts.map((text, index) => ({
      id: `tokio-column-${index + 1}`,
      text,
      pageStart: 2,
      bbox: [{
        page: 2,
        x: 40,
        y: 100 + index * 18,
        width: 240,
        height: 12,
      }],
    }));
    const nodes: DocumentSourceNode[] = [{
      id: "tokio-document",
      documentId: "tokio-contract-no",
      kind: "document",
      title: "Policy",
      description: "Policy",
      sourceSpanIds: spans.map((span) => span.id as string),
      order: 0,
      path: "Policy",
    }];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        parties: [{
          role: "carrier",
          name: "Lloyd's Underwriters",
          sourceNodeIds: [],
          sourceSpanIds: ["tokio-column-1"],
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toMatchObject({
      displayName: "Tokio Marine Kiln",
      sourceName:
        "Lloyd's Underwriters led by: Tokio Marine Kiln, Syndicate No. 0510 KLN and Syndicate No. 1880 KLN, under contract no. PG109C/26-PC(L)",
      legalEntities: [
        { name: "Tokio Marine Kiln, Syndicate No. 0510 KLN" },
        { name: "Tokio Marine Kiln, Syndicate No. 1880 KLN" },
      ],
      sourceSpanIds: [
        "tokio-column-1",
        "tokio-column-2",
        "tokio-column-3",
      ],
    });
  });

  it("reconstructs only the Allianz same-column operating-name clause", () => {
    const span = (
      id: string,
      text: string,
      x: number,
      y: number,
      width = 250,
    ): SourceSpanLike => ({
      id,
      text,
      pageStart: 1,
      bbox: [{ page: 1, x, y, width, height: 12 }],
    });
    const spans = [
      span(
        "allianz-left-1",
        "CUMIS General Insurance Company, a member of The Co-operators group of companies",
        40,
        100,
      ),
      span(
        "allianz-right-1",
        "Premium and coverage summary for the insured",
        340,
        100,
      ),
      span(
        "allianz-left-2",
        "and/or AZGA Service Canada Inc. operating as",
        40,
        118,
      ),
      span(
        "allianz-right-2",
        "Coverage limit $5,000,000 and premium $48,000",
        340,
        118,
      ),
      span("allianz-left-3", "Allianz Global Assistance (AGA).", 40, 136),
    ];
    const nodes: DocumentSourceNode[] = [{
      id: "allianz-document",
      documentId: "allianz-policy",
      kind: "document",
      title: "Policy",
      description: "Policy",
      sourceSpanIds: spans.map((item) => item.id as string),
      order: 0,
      path: "Policy",
    }];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        parties: [
          {
            role: "insurer",
            name: "CUMIS General Insurance Company",
            sourceNodeIds: [],
            sourceSpanIds: ["allianz-left-1"],
          },
          {
            role: "insurer",
            name: "AZGA Service Canada Inc.",
            sourceNodeIds: [],
            sourceSpanIds: ["allianz-left-2"],
          },
        ],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toEqual({
      displayName: "Allianz Global Assistance",
      sourceName: "Allianz Global Assistance",
      operatingName: "Allianz Global Assistance",
      legalEntities: [
        {
          name: "CUMIS General Insurance Company",
          sourceNodeIds: [],
          sourceSpanIds: [
            "allianz-left-1",
            "allianz-left-2",
            "allianz-left-3",
          ],
        },
        {
          name: "AZGA Service Canada Inc.",
          sourceNodeIds: [],
          sourceSpanIds: [
            "allianz-left-2",
            "allianz-left-1",
            "allianz-left-3",
          ],
        },
      ],
      legalEntityRelationship: "and_or",
      sourceNodeIds: [],
      sourceSpanIds: [
        "allianz-left-1",
        "allianz-left-2",
        "allianz-left-3",
      ],
    });
    expect(
      (fields.carrierIdentity as {
        legalEntities: Array<{ name: string }>;
      }).legalEntities.map(
        (entity: { name: string }) => entity.name,
      ),
    ).not.toContain("The Co-operators group of companies");
  });

  it("rejects a partial legal suffix and reconstructs the complete Allianz clause", () => {
    const span = (
      id: string,
      text: string,
      y: number,
    ): SourceSpanLike => ({
      id,
      text,
      pageStart: 9,
      sourceUnit: "text",
      bbox: [{ page: 9, x: 313, y, width: 250, height: 12 }],
    });
    const spans = [
      span(
        "allianz-legal-1",
        "CUMIS General Insurance Company, a member of The",
        615,
      ),
      span(
        "allianz-legal-2",
        "Co-operators group of companies and/or AZGA Service",
        627,
      ),
      span(
        "allianz-legal-3",
        "Canada Inc. operating as Allianz Global Assistance (AGA).",
        639,
      ),
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        insurer: {
          value: "CUMIS General Insurance Company",
          sourceNodeIds: [],
          sourceSpanIds: ["allianz-legal-1"],
        },
        parties: [
          {
            role: "insurer",
            name: "CUMIS General Insurance Company",
            sourceNodeIds: [],
            sourceSpanIds: ["allianz-legal-1"],
          },
          {
            role: "insurer",
            name: "AZGA Service Canada Inc.",
            sourceNodeIds: [],
            sourceSpanIds: ["allianz-legal-2", "allianz-legal-3"],
          },
        ],
      },
      [],
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: [],
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toEqual({
      displayName: "Allianz Global Assistance",
      sourceName: "Allianz Global Assistance",
      operatingName: "Allianz Global Assistance",
      legalEntities: [
        {
          name: "CUMIS General Insurance Company",
          sourceNodeIds: [],
          sourceSpanIds: [
            "allianz-legal-1",
            "allianz-legal-2",
            "allianz-legal-3",
          ],
        },
        {
          name: "AZGA Service Canada Inc.",
          sourceNodeIds: [],
          sourceSpanIds: [
            "allianz-legal-2",
            "allianz-legal-3",
            "allianz-legal-1",
          ],
        },
      ],
      legalEntityRelationship: "and_or",
      sourceNodeIds: [],
      sourceSpanIds: [
        "allianz-legal-1",
        "allianz-legal-2",
        "allianz-legal-3",
      ],
    });
  });

  it("builds a canonical HDI identity from a source-backed carrier party", () => {
    const spans: SourceSpanLike[] = [{
      id: "hdi-carrier",
      text: "Carrier: HDI Global Specialty SE",
      pageStart: 1,
    }];
    const nodes: DocumentSourceNode[] = [{
      id: "hdi-carrier-node",
      documentId: "hdi-policy",
      kind: "section",
      title: "Carrier",
      description: "Carrier: HDI Global Specialty SE",
      sourceSpanIds: ["hdi-carrier"],
      order: 0,
      path: "Policy / Carrier",
    }];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        parties: [{
          role: "carrier",
          name: "HDI Global Specialty SE",
          sourceNodeIds: ["hdi-carrier-node"],
          sourceSpanIds: ["hdi-carrier"],
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toEqual({
      displayName: "HDI Global Specialty SE",
      sourceName: "HDI Global Specialty SE",
      legalEntities: [{
        name: "HDI Global Specialty SE",
        sourceNodeIds: ["hdi-carrier-node"],
        sourceSpanIds: ["hdi-carrier"],
      }],
      legalEntityRelationship: "single",
      sourceNodeIds: ["hdi-carrier-node"],
      sourceSpanIds: ["hdi-carrier"],
    });
  });

  it("recovers insurer and agency identifiers from exact-party source evidence", () => {
    const span = {
      id: "span-declarations",
      text: "INSURANCE COMPANY Fortegra Specialty Insurance Company COMPANY ADDRESS 10751 Deerwood Park Blvd NAIC # 16823 GENERAL AGENT Diesel Insurance Solutions Inc. GA ADDRESS 26431 Crown Valley Pkwy LICENSE 21058436 PRODUCER Broker LLC LICENSE PR-123",
    };
    const profile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["INMRC"],
        coverages: [],
        parties: [
          {
            role: "insurer",
            name: "Fortegra Specialty Insurance Company",
            sourceNodeIds: ["declarations"],
            sourceSpanIds: [span.id],
          },
          {
            role: "general_agent",
            name: "Diesel Insurance Solutions Inc.",
            sourceNodeIds: ["declarations"],
            sourceSpanIds: [span.id],
          },
          {
            role: "producer",
            name: "Broker LLC",
            sourceNodeIds: ["declarations"],
            sourceSpanIds: [span.id],
          },
        ],
      },
      [{
        id: "declarations",
        documentId: "party-identifiers",
        kind: "section",
        title: "Declarations",
        description: "Declarations",
        sourceSpanIds: [span.id],
        order: 0,
        path: "Declarations",
      }],
      [span],
    );

    const parties = profile.parties as Array<{
      role: string;
      naicNumber?: string;
      licenseNumber?: string;
      sourceSpanIds: string[];
    }>;
    expect(parties.find(
      (party) => party.role === "insurer",
    )).toMatchObject({ naicNumber: "16823", sourceSpanIds: [span.id] });
    expect(parties.find(
      (party) => party.role === "general_agent",
    )).toMatchObject({ licenseNumber: "21058436", sourceSpanIds: [span.id] });
    expect(parties.find(
      (party) => party.role === "producer",
    )).toMatchObject({ licenseNumber: "PR-123", sourceSpanIds: [span.id] });
  });

  it("resets carrier enrichment state when source extraction changes the identity", () => {
    const span = {
      id: "replacement-carrier-span",
      text: "INSURER Replacement Carrier Insurance Company",
    };
    const node: DocumentSourceNode = {
      id: "replacement-carrier",
      documentId: "replacement-policy",
      kind: "section",
      title: "Insurer",
      description: span.text,
      textExcerpt: span.text,
      sourceSpanIds: [span.id],
      order: 0,
      path: "Policy / Insurer",
    };
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
        insurer: {
          value: "Replacement Carrier Insurance Company",
          sourceNodeIds: [node.id],
          sourceSpanIds: [span.id],
        },
        parties: [{
          role: "insurer",
          name: "Replacement Carrier Insurance Company",
          sourceNodeIds: [node.id],
          sourceSpanIds: [span.id],
        }],
      },
      [node],
      [span],
    );

    const fields = sourceTreePolicyFields({
      sourceTree: [node],
      sourceSpans: [span],
      operationalProfile,
      existingPolicyFields: {
        carrierIdentity: {
          displayName: "Original Carrier Insurance Company",
          sourceName: "Original Carrier Insurance Company",
          legalEntities: [{
            name: "Original Carrier Insurance Company",
            sourceNodeIds: ["original-carrier"],
            sourceSpanIds: ["original-carrier-span"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["original-carrier"],
          sourceSpanIds: ["original-carrier-span"],
        },
        carrierIdentityEnrichmentStatus: "failed",
        carrierIdentityEnrichmentAttempts: 3,
        carrierIdentityEnrichmentAttemptedAt: 100,
      },
    });

    expect(fields.carrierIdentity).toMatchObject({
      sourceName: "Replacement Carrier Insurance Company",
    });
    expect(fields).toHaveProperty("carrierIdentityEnrichmentStatus", undefined);
    expect(fields).toHaveProperty("carrierIdentityEnrichmentAttempts", undefined);
    expect(fields).toHaveProperty(
      "carrierIdentityEnrichmentAttemptedAt",
      undefined,
    );
  });

  it("clears stale carrier identity when replacement evidence cannot rebuild it", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
        insurer: {
          value: "Replacement Carrier Insurance Company",
          sourceNodeIds: ["missing-replacement-carrier"],
          sourceSpanIds: ["missing-replacement-carrier-span"],
        },
      },
      [],
      [],
    );

    const fields = sourceTreePolicyFields({
      sourceTree: [],
      sourceSpans: [],
      operationalProfile,
      existingPolicyFields: {
        carrier: "Replacement Carrier Insurance Company",
        security: "Replacement Carrier Insurance Company",
        insurer: {
          legalName: "Replacement Carrier Insurance Company",
        },
        carrierLegalName: "Original Carrier Insurance Company",
        carrierIdentity: {
          displayName:
            "Original Carrier Insurance Company and/or Replacement Carrier Insurance Company",
          sourceName:
            "Original Carrier Insurance Company and/or Replacement Carrier Insurance Company",
          legalEntities: [
            {
              name: "Original Carrier Insurance Company",
              sourceNodeIds: ["original-carrier"],
              sourceSpanIds: ["original-carrier-span"],
            },
            {
              name: "Replacement Carrier Insurance Company",
              sourceNodeIds: ["original-carrier"],
              sourceSpanIds: ["original-carrier-span"],
            },
          ],
          legalEntityRelationship: "and_or",
          sourceNodeIds: ["original-carrier"],
          sourceSpanIds: ["original-carrier-span"],
        },
        carrierBrandId: "legacy-brand-cache",
        carrierBrandStatus: "ready",
        carrierBrandAttempts: 1,
        carrierBrandAttemptedAt: 50,
        carrierIdentityEnrichmentStatus: "failed",
        carrierIdentityEnrichmentAttempts: 3,
        carrierIdentityEnrichmentAttemptedAt: 100,
      },
    });

    expect(fields).toMatchObject({
      carrier: "Replacement Carrier Insurance Company",
      security: "Replacement Carrier Insurance Company",
      insurer: {
        legalName: "Replacement Carrier Insurance Company",
      },
    });
    expect(fields).toHaveProperty("carrierNaicNumber", undefined);
    expect(fields).toHaveProperty("carrierIdentity", undefined);
    expect(fields).toHaveProperty("carrierLegalName", undefined);
    expect(fields).toHaveProperty("carrierBrandId", undefined);
    expect(fields).toHaveProperty("carrierBrandStatus", undefined);
    expect(fields).toHaveProperty("carrierBrandAttempts", undefined);
    expect(fields).toHaveProperty("carrierBrandAttemptedAt", undefined);
    expect(fields).toHaveProperty("carrierIdentityEnrichmentStatus", undefined);
    expect(fields).toHaveProperty("carrierIdentityEnrichmentAttempts", undefined);
    expect(fields).toHaveProperty(
      "carrierIdentityEnrichmentAttemptedAt",
      undefined,
    );
  });

  it("retains a stored carrier identity when the current designation still matches", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
      },
      [],
      [],
    );
    const carrierIdentity = {
      displayName: "Fortegra",
      sourceName: "Fortegra Specialty Insurance Company",
      publicNameRelationship: "same_legal_entity" as const,
      legalEntities: [{
        name: "Fortegra Specialty Insurance Company",
        sourceNodeIds: ["stored-carrier"],
        sourceSpanIds: ["stored-carrier-span"],
      }],
      legalEntityRelationship: "single" as const,
      sourceNodeIds: ["stored-carrier"],
      sourceSpanIds: ["stored-carrier-span"],
      branding: {
        website: "https://www.fortegra.com",
        accentColor: "#123456",
        confidence: "high" as const,
        sourceUrls: ["https://www.fortegra.com"],
        enrichmentVersion: 1,
        updatedAt: 100,
      },
    };

    const fields = sourceTreePolicyFields({
      sourceTree: [],
      sourceSpans: [],
      operationalProfile,
      existingPolicyFields: {
        carrier: "Fortegra Specialty Insurance Company",
        carrierIdentity,
      },
    });

    expect(fields.carrier).toBe("Fortegra");
    expect(fields.carrierIdentity).toEqual(carrierIdentity);
  });

  it("clears a stored carrier identity without a positive current carrier match", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
      },
      [],
      [],
    );
    const fields = sourceTreePolicyFields({
      sourceTree: [],
      sourceSpans: [],
      operationalProfile,
      existingPolicyFields: {
        carrier: "Unknown",
        carrierIdentity: {
          displayName: "Original Carrier",
          sourceName: "Original Carrier Insurance Company",
          legalEntities: [{
            name: "Original Carrier Insurance Company",
            sourceNodeIds: ["stored-carrier"],
            sourceSpanIds: ["stored-carrier-span"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["stored-carrier"],
          sourceSpanIds: ["stored-carrier-span"],
        },
        carrierLegalName: "Original Carrier Insurance Company",
        carrierIdentityEnrichmentStatus: "ready",
      },
    });

    expect(fields).toMatchObject({
      carrier: "Unknown",
      carrierIdentity: undefined,
      carrierLegalName: undefined,
      carrierIdentityEnrichmentStatus: undefined,
    });
  });

  it("drops operations descriptions whose evidence ids are invalid", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["CGL"],
        coverages: [],
        operationsDescription: {
          value: "Invented operations description",
          sourceNodeIds: ["missing-node"],
          sourceSpanIds: ["missing-span"],
        },
      },
      sourceTree,
      sourceSpans,
    );

    expect((profile as any).operationsDescription).toBeUndefined();
  });

  it("merges declaration recovery into the operational projection without coverage premiums", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["AUTOB"],
        premium: {
          value: "$5,166.32",
          normalizedValue: "5166.32",
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        },
        coverages: [{
          name: "Commercial Auto Physical Damage",
          lineOfBusiness: "AUTOB",
          premium: "$1,300.00",
          limits: [{
            kind: "premium",
            label: "Premium",
            value: "$1,300.00",
            sourceNodeIds: ["period-row"],
            sourceSpanIds: ["span-period"],
          }],
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        }],
      },
      sourceTree,
      sourceSpans,
    );
    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
      existingLinesOfBusiness: ["AUTOB"],
      existingPolicyFields: {
        premium: "$4,572.40",
        premiumAmount: 4572.4,
        totalCost: "$5,166.32",
        premiumBreakdown: [{ line: "Physical Damage", amount: "$1,300.00", sourceSpanIds: ["span-period"] }],
        coverages: [{
          name: "Commercial Auto Physical Damage",
          lineOfBusiness: "AUTOB",
          limit: "$250,000",
          limits: [{
            kind: "each_occurrence_limit",
            label: "Maximum per Occurrence",
            value: "$250,000",
            sourceNodeIds: ["period-row"],
            sourceSpanIds: ["span-period"],
          }],
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        }],
      },
    });

    expect(fields).toMatchObject({ premium: "$4,572.40", premiumAmount: 4572.4 });
    expect((fields.coverages as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: "Commercial Auto Physical Damage",
      limit: "$250,000",
    });
    expect((fields.coverages as Array<Record<string, unknown>>)[0]).not.toHaveProperty("premium");
    expect(((fields.operationalProfile as PolicyOperationalProfile).coverages[0] as Record<string, unknown>)).not.toHaveProperty("premium");
  });
});
