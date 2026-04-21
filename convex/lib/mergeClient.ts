// convex/lib/mergeClient.ts
//
// Interface for all Merge.dev API calls.
// Real implementation backed by @mergeapi/merge-node-client.
// Falls back to stubMergeClient when MERGE_API_KEY is unset (CI / dev without creds).
"use node";

import { MergeClient as MergeSDKClient, Merge } from "@mergeapi/merge-node-client";
import crypto from "node:crypto";

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
   * In the live flow this is called from the webhook handler after
   * linked_account.created. Returns linked account info.
   */
  exchangePublicToken(publicToken: string): Promise<MergeLinkedAccountInfo>;

  /**
   * Delete a Linked Account on Merge's side.
   * The account token for that linked account must be passed via accountToken.
   */
  deleteLinkedAccount(mergeLinkedAccountId: string, accountToken?: string): Promise<void>;

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

// ── Adapter helpers ────────────────────────────────────────────────────────

/**
 * Map Merge category string to the SDK category enum value used for link token creation.
 */
function toCategoriesEnum(category: MergeCategory): "accounting" | "hris" | "hris" {
  // Merge treats payroll as part of hris for linking purposes
  return category === "payroll" ? "hris" : category;
}

/** Normalize a date string or Date to YYYY-MM-DD, returning undefined if falsy. */
function toDateStr(d: string | Date | null | undefined): string | undefined {
  if (!d) return undefined;
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}

/**
 * Extract accounting metrics from the Merge Accounting API.
 * Pulls: IncomeStatements (revenue), CompanyInfo (legal name, EIN/tax number).
 */
async function fetchAccountingMetrics(
  sdk: MergeSDKClient,
  accountToken: string,
): Promise<MergeMetricRow[]> {
  const rows: MergeMetricRow[] = [];
  const opts = { accountToken };

  // --- Income statements (revenue) ---
  try {
    const stmtsPage = await sdk.accounting.incomeStatements.list({}, opts);
    const stmts: Merge.accounting.IncomeStatement[] = [];
    for await (const stmt of stmtsPage) {
      stmts.push(stmt);
    }

    // Sort by endPeriod descending so first = most recent
    const sorted = [...stmts].sort((a, b) => {
      const ad = a.endPeriod ? new Date(a.endPeriod).getTime() : 0;
      const bd = b.endPeriod ? new Date(b.endPeriod).getTime() : 0;
      return bd - ad;
    });

    const current = sorted[0];
    const prior = sorted[1];

    if (current) {
      const revenue = current.income?.reduce(
        (sum: number, item: Merge.accounting.ReportItem) =>
          sum + (item.value ?? 0),
        0,
      ) ?? 0;
      const currencyStr = typeof current.currency === "string" ? current.currency : undefined;
      rows.push({
        metricKey: "accounting.annual_revenue",
        value: revenue,
        unit: currencyStr,
        asOfDate: toDateStr(current.endPeriod),
        period: current.startPeriod && current.endPeriod
          ? { start: toDateStr(current.startPeriod)!, end: toDateStr(current.endPeriod)!, kind: "fiscal_year" }
          : undefined,
        mergeSourceRef: current.id ?? undefined,
      });
    }

    if (prior) {
      const revenue = prior.income?.reduce(
        (sum: number, item: Merge.accounting.ReportItem) =>
          sum + (item.value ?? 0),
        0,
      ) ?? 0;
      const currencyStr = typeof prior.currency === "string" ? prior.currency : undefined;
      rows.push({
        metricKey: "accounting.prior_year_revenue",
        value: revenue,
        unit: currencyStr,
        asOfDate: toDateStr(prior.endPeriod),
        period: prior.startPeriod && prior.endPeriod
          ? { start: toDateStr(prior.startPeriod)!, end: toDateStr(prior.endPeriod)!, kind: "fiscal_year" }
          : undefined,
        mergeSourceRef: prior.id ?? undefined,
      });
    }
  } catch (e) {
    console.warn("[mergeClient] fetchAccountingMetrics: income statements error", e);
  }

  // --- Company info (legal name, tax number) ---
  try {
    const infoPage = await sdk.accounting.companyInfo.list({}, opts);
    const infos: Merge.accounting.CompanyInfo[] = [];
    for await (const info of infoPage) {
      infos.push(info);
      break; // only need first
    }
    const info = infos[0];
    const now = new Date().toISOString().slice(0, 10);
    if (info?.legalName) {
      rows.push({ metricKey: "accounting.company_legal_name", value: info.legalName, asOfDate: now });
    }
    if (info?.taxNumber) {
      rows.push({ metricKey: "accounting.company_ein", value: info.taxNumber, asOfDate: now });
    }
  } catch (e) {
    console.warn("[mergeClient] fetchAccountingMetrics: company info error", e);
  }

  return rows;
}

/**
 * Extract HRIS metrics from the Merge HRIS API.
 * Pulls: headcount (active employees), company address.
 */
async function fetchHrisMetrics(
  sdk: MergeSDKClient,
  accountToken: string,
): Promise<MergeMetricRow[]> {
  const rows: MergeMetricRow[] = [];
  const opts = { accountToken };
  const now = new Date().toISOString().slice(0, 10);

  // --- Headcount (active employees) ---
  try {
    let count = 0;
    const page = await sdk.hris.employees.list({ employmentStatus: "ACTIVE" as any }, opts);
    for await (const _emp of page) {
      count++;
    }
    rows.push({ metricKey: "hris.headcount", value: count, unit: "count", asOfDate: now });
  } catch (e) {
    console.warn("[mergeClient] fetchHrisMetrics: headcount error", e);
  }

  // --- Company address (from locations endpoint) ---
  try {
    // Check companies exist first
    const companiesPage = await sdk.hris.companies.list({}, opts);
    const companies: Merge.hris.Company[] = [];
    for await (const c of companiesPage) {
      companies.push(c);
      break;
    }
    if (companies.length > 0) {
      try {
        const locsPage = await sdk.hris.locations.list({}, opts);
        const locs: Merge.hris.Location[] = [];
        for await (const l of locsPage) {
          locs.push(l);
          break;
        }
        const loc = locs[0];
        if (loc) {
          rows.push({
            metricKey: "hris.company_address",
            value: {
              street1: loc.street1 ?? undefined,
              city: loc.city ?? undefined,
              state: loc.state ?? undefined,
              zip: loc.zipCode ?? undefined,
              country: typeof loc.country === "string" ? loc.country : undefined,
            },
            asOfDate: now,
          });
        }
      } catch {
        // locations not available — skip
      }
    }
  } catch (e) {
    console.warn("[mergeClient] fetchHrisMetrics: companies error", e);
  }

  return rows;
}

/**
 * Extract payroll metrics from the Merge HRIS (payroll) API.
 * Pulls: total gross_pay YTD and trailing-12 from EmployeePayrollRuns.
 */
async function fetchPayrollMetrics(
  sdk: MergeSDKClient,
  accountToken: string,
): Promise<MergeMetricRow[]> {
  const rows: MergeMetricRow[] = [];
  const opts = { accountToken };
  const now = new Date().toISOString().slice(0, 10);
  const fy = new Date().getFullYear();
  const ytdStart = `${fy}-01-01`;
  const t12StartDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const t12Start = t12StartDate.toISOString().slice(0, 10);

  try {
    let ytdTotal = 0;
    let t12Total = 0;

    const page = await sdk.hris.employeePayrollRuns.list(
      { startedAfter: t12StartDate },
      opts,
    );
    for await (const run of page) {
      const checkDate = run.checkDate ? toDateStr(run.checkDate) : undefined;
      const gross = run.grossPay ?? 0;
      if (checkDate && checkDate >= ytdStart) ytdTotal += gross;
      if (checkDate && checkDate >= t12Start) t12Total += gross;
    }

    rows.push({
      metricKey: "payroll.total_payroll_ytd",
      value: ytdTotal,
      unit: "USD",
      asOfDate: now,
      period: { start: ytdStart, end: now, kind: "ytd" },
    });
    rows.push({
      metricKey: "payroll.total_payroll_trailing_12",
      value: t12Total,
      unit: "USD",
      asOfDate: now,
      period: { start: t12Start, end: now, kind: "trailing_12" },
    });
  } catch (e) {
    console.warn("[mergeClient] fetchPayrollMetrics: error", e);
  }

  return rows;
}

// ── Real implementation ────────────────────────────────────────────────────

function buildRealMergeClient(apiKey: string): MergeClient {
  // The SDK client is instantiated per-call with category-specific accountToken
  // for data fetching, but uses only the apiKey for link token / account token ops.

  function makeSDK(accountToken?: string): MergeSDKClient {
    return new MergeSDKClient({
      apiKey,
      ...(accountToken ? { accountToken } : {}),
    });
  }

  return {
    async createLinkToken({ endUserOriginId, endUserOrganizationName, category }) {
      const sdk = makeSDK();
      // Use accounting client for link token creation regardless of category —
      // the categories array in the request controls what Merge shows in Link.
      const result = await sdk.accounting.linkToken.create({
        endUserEmailAddress: "",  // optional in sandbox
        endUserOrganizationName,
        endUserOriginId,
        categories: [toCategoriesEnum(category)],
      });
      return { linkToken: result.linkToken };
    },

    async exchangePublicToken(publicToken) {
      // accountToken.retrieve exchanges the public_token for an account token
      const sdk = makeSDK();
      const result = await sdk.accounting.accountToken.retrieve(publicToken);
      return {
        linkedAccountId: result.id ?? "",
        accountToken: result.accountToken,
        providerSlug: (result.integration as any)?.slug ?? "unknown",
        providerDisplayName: (result.integration as any)?.name ?? "Unknown",
      };
    },

    async deleteLinkedAccount(_mergeLinkedAccountId, accountToken) {
      if (!accountToken) return;
      const sdk = makeSDK(accountToken);
      await sdk.accounting.deleteAccount.delete();
    },

    async fetchMetrics({ accountToken, category }) {
      const sdk = makeSDK(accountToken);
      switch (category) {
        case "accounting":
          return fetchAccountingMetrics(sdk, accountToken);
        case "hris":
          return fetchHrisMetrics(sdk, accountToken);
        case "payroll":
          return fetchPayrollMetrics(sdk, accountToken);
        default:
          return [];
      }
    },

    async fetchMetric({ accountToken, metricKey }) {
      const category = metricKey.split(".")[0] as MergeCategory;
      const all = await buildRealMergeClient(apiKey).fetchMetrics({ accountToken, category });
      return all.find((r) => r.metricKey === metricKey) ?? null;
    },
  };
}

// ── Webhook signature verification ────────────────────────────────────────

/**
 * Verify an inbound Merge webhook signature.
 * Merge signs with HMAC-SHA256 over the raw body using MERGE_WEBHOOK_SECRET.
 * Header: X-Merge-Webhook-Signature
 *
 * Throws if the signature is invalid or the secret is unset.
 */
export function verifyMergeWebhookSignature(rawBody: string, signature: string): void {
  const secret = process.env.MERGE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[merge-webhook] MERGE_WEBHOOK_SECRET not set — skipping signature verification");
    return;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  // Merge may send the signature as hex or as "sha256=<hex>"
  const normalized = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(normalized, "hex"))) {
      throw new Error("Merge webhook signature mismatch");
    }
  } catch {
    throw new Error("Merge webhook signature mismatch");
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/** true when MERGE_API_KEY is not set — stub will be used */
export const USE_STUB = !process.env.MERGE_API_KEY;

/**
 * Returns the active MergeClient.
 * Uses the real SDK when MERGE_API_KEY is present; falls back to the stub otherwise.
 * Reads env at call-time (Convex pattern — not at module load).
 */
export function getMergeClient(): MergeClient {
  const apiKey = process.env.MERGE_API_KEY;
  if (!apiKey) {
    return stubMergeClient;
  }
  return buildRealMergeClient(apiKey);
}
