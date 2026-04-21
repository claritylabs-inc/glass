// convex/lib/mergeClient.ts
//
// Interface for all Merge.dev API calls.
// DEFERRED: Replace stub with real @merge-api/merge-node-client calls once
// MERGE_API_KEY_PROD / MERGE_API_KEY_SANDBOX are provisioned.

export type MergeCategory = "accounting" | "hris" | "payroll";

export interface MergeLinkTokenResult {
  linkToken: string;
}

export interface MergeLinkedAccountInfo {
  linkedAccountId: string;
  accountToken: string;
  providerSlug: string;
  providerDisplayName: string;
}

export interface MergeMetricRow {
  metricKey: string;
  value: unknown;
  unit?: string;
  asOfDate?: string;
  period?: {
    start: string;
    end: string;
    kind: "ytd" | "trailing_12" | "fiscal_year" | "calendar_year" | "quarter" | "month";
  };
  mergeSourceRef?: string;
}

export interface MergeClient {
  /**
   * Create a short-lived Merge Link token for a client org.
   * Called server-side; token passed to the frontend Merge Link widget.
   */
  createLinkToken(args: {
    endUserOriginId: string;  // clientOrgId
    endUserOrganizationName: string;
    category: MergeCategory;
  }): Promise<MergeLinkTokenResult>;

  /**
   * Exchange a public token (from Link callback) for an Account Token.
   * DEFERRED: in the live flow this is called from the webhook handler after
   * linked_account.created, not directly. Stub returns a fake token.
   */
  exchangePublicToken(publicToken: string): Promise<MergeLinkedAccountInfo>;

  /**
   * Delete a Linked Account on Merge's side.
   */
  deleteLinkedAccount(mergeLinkedAccountId: string): Promise<void>;

  /**
   * Fetch all metrics for a category from Common Models.
   * Returns normalized MergeMetricRow[] ready to upsert into integrationData.
   */
  fetchMetrics(args: {
    accountToken: string;
    category: MergeCategory;
  }): Promise<MergeMetricRow[]>;

  /**
   * Fetch a single metric by key.
   */
  fetchMetric(args: {
    accountToken: string;
    metricKey: string;
  }): Promise<MergeMetricRow | null>;
}

// ── Stub implementation ────────────────────────────────────────────────────
// All methods return deterministic fake data. Safe for CI and dev without
// any Merge credentials.

let _stubLinkTokenCounter = 0;

export const stubMergeClient: MergeClient = {
  async createLinkToken({ endUserOriginId, category }) {
    return {
      linkToken: `stub_link_${category}_${endUserOriginId}_${++_stubLinkTokenCounter}`,
    };
  },

  async exchangePublicToken(publicToken) {
    const slug = publicToken.includes("xero") ? "xero" : "quickbooks_online";
    return {
      linkedAccountId: `stub_la_${publicToken}`,
      accountToken: `stub_at_${publicToken}`,
      providerSlug: slug,
      providerDisplayName: slug === "xero" ? "Xero" : "QuickBooks Online",
    };
  },

  async deleteLinkedAccount(_mergeLinkedAccountId) {
    // no-op in stub
  },

  async fetchMetrics({ category }) {
    const now = new Date().toISOString().slice(0, 10);
    const fy = new Date().getFullYear().toString();

    const stubs: Record<MergeCategory, MergeMetricRow[]> = {
      accounting: [
        {
          metricKey: "accounting.annual_revenue",
          value: 2_400_000,
          unit: "USD",
          asOfDate: `${fy}-12-31`,
          period: { start: `${fy}-01-01`, end: `${fy}-12-31`, kind: "fiscal_year" },
          mergeSourceRef: "stub_income_stmt_fy",
        },
        {
          metricKey: "accounting.prior_year_revenue",
          value: 1_900_000,
          unit: "USD",
          asOfDate: `${Number(fy) - 1}-12-31`,
          period: {
            start: `${Number(fy) - 1}-01-01`,
            end: `${Number(fy) - 1}-12-31`,
            kind: "fiscal_year",
          },
          mergeSourceRef: "stub_income_stmt_prior",
        },
        {
          metricKey: "accounting.company_legal_name",
          value: "Stub Company Inc.",
          asOfDate: now,
        },
        {
          metricKey: "accounting.company_ein",
          value: "12-3456789",
          asOfDate: now,
        },
      ],
      hris: [
        {
          metricKey: "hris.headcount",
          value: 42,
          unit: "count",
          asOfDate: now,
        },
        {
          metricKey: "hris.company_address",
          value: {
            street1: "123 Main St",
            city: "San Francisco",
            state: "CA",
            zip: "94105",
            country: "US",
          },
          asOfDate: now,
        },
      ],
      payroll: [
        {
          metricKey: "payroll.total_payroll_ytd",
          value: 1_200_000,
          unit: "USD",
          asOfDate: now,
          period: { start: `${fy}-01-01`, end: now, kind: "ytd" },
          mergeSourceRef: "stub_payroll_ytd",
        },
        {
          metricKey: "payroll.total_payroll_trailing_12",
          value: 2_100_000,
          unit: "USD",
          asOfDate: now,
          period: {
            start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            end: now,
            kind: "trailing_12",
          },
          mergeSourceRef: "stub_payroll_t12",
        },
      ],
    };

    return stubs[category] ?? [];
  },

  async fetchMetric({ metricKey, accountToken }) {
    const category = metricKey.split(".")[0] as MergeCategory;
    const all = await stubMergeClient.fetchMetrics({ accountToken, category });
    return all.find((r) => r.metricKey === metricKey) ?? null;
  },
};

/**
 * Returns the active MergeClient.
 * DEFERRED: switch to real client when credentials are available.
 */
export function getMergeClient(): MergeClient {
  return stubMergeClient;
}
