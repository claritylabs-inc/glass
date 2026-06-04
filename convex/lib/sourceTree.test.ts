import { describe, expect, it } from "vitest";

import { normalizeOperationalProfile, normalizeSourceTree, sourceTreePolicyFields, withControlledPolicyTypes, type DocumentSourceNode, type PolicyOperationalProfile, type SourceSpanLike } from "./sourceTree";

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
  it("lets exact declarations rows override polluted raw identity values", () => {
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

    expect(profile.namedInsured?.value).toBe("Cios Technologies Inc.");
    expect(profile.policyNumber?.value).toBe("SLS-EO-26-110482");
    expect(profile.effectiveDate?.value).toBe("02/01/2026");
    expect(profile.expirationDate?.value).toBe("02/01/2027");
    expect(profile.premium?.value).toBe("CAD $42,000");
    expect(profile.broker?.value).toBe("Wellington Risk Partners Inc.");
    expect(profile.insurer?.value).toBe("Saint Lawrence Specialty Insurance Company");
    expect(profile.policyTypes).toEqual(["professional_liability"]);
    expect(profile.coverageTypes).toEqual(["Professional Liability"]);
    expect(profile.parties.find((party: PolicyOperationalProfile["parties"][number]) => party.role === "named_insured")?.name).toBe("Cios Technologies Inc.");
    expect(profile.parties.some((party: PolicyOperationalProfile["parties"][number]) => /claims-made/i.test(party.name))).toBe(false);
  });

  it("handles declaration row labels that do not use fixed item numbers", () => {
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

    const profile = withControlledPolicyTypes(
      normalizeOperationalProfile(undefined, flexibleTree, flexibleSpans),
      ["general_liability"],
    );

    expect(profile.namedInsured?.value).toBe("Example Holdings Ltd.");
    expect(profile.policyNumber?.value).toBe("GL-100");
    expect(profile.effectiveDate?.value).toBe("03/01/2026");
    expect(profile.expirationDate?.value).toBe("03/01/2027");
    expect(profile.premium?.value).toBe("$12,500");
    expect(profile.broker?.value).toBe("Northshore Risk Advisors Inc.");
    expect(profile.policyTypes).toEqual(["general_liability"]);
    expect(profile.coverageTypes).toEqual(["General Liability"]);
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
  it("repairs polluted declaration fields from source-backed operational profile values", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        namedInsured: {
          value: ". THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY. _________________________ Page 1 of 27",
          confidence: "high",
          sourceNodeIds: ["jacket"],
          sourceSpanIds: ["span-jacket"],
        },
        insurer: {
          value: "policy jacket and claims-made notice. SAINT LAWRENCE SPECIALTY INSURANCE COMPANY Compagnie d'assurance spécialisée Saint",
          confidence: "high",
          sourceNodeIds: ["jacket"],
          sourceSpanIds: ["span-jacket"],
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
