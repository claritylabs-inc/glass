import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  lookupConnectedVendors,
  lookupVendorCompliance,
  lookupVendorPolicies,
} from "./chatTools";
import { policyLobCodes } from "./linesOfBusiness";

type RunQueryCtx = {
  // Convex action contexts expose a generic runQuery signature. Keep this loose
  // so the shared executable tools can be reused from every channel action.
  runQuery: (fn: any, args: any) => Promise<any>;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesQuery(row: unknown, query: string | undefined) {
  if (!query?.trim()) return true;
  const haystack = normalize(JSON.stringify(row));
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function vendorName(row: Record<string, unknown>) {
  const vendorOrg = row.vendorOrg as Record<string, unknown> | null | undefined;
  return String(vendorOrg?.name ?? row.vendorOrgId ?? "Unknown vendor");
}

function vendorOrgId(row: Record<string, unknown>) {
  const vendorOrg = row.vendorOrg as Record<string, unknown> | null | undefined;
  return String(vendorOrg?._id ?? row.vendorOrgId ?? "");
}

function complianceStatus(row: Record<string, unknown>) {
  const policyCount = Number(row.policyCount ?? 0);
  if (policyCount === 0) return "waiting_on_policies";
  const status = String(row.status ?? "");
  if (status === "compliant") return "compliant";
  return "non_compliant";
}

function mapPolicy(policy: Record<string, unknown>) {
  return {
    id: policy._id,
    carrier: policy.carrier,
    policyNumber: policy.policyNumber,
    insuredName: policy.insuredName,
    linesOfBusiness: policyLobCodes(policy),
    policyTypes: policyLobCodes(policy),
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    extractionStatus: policy.pipelineStatus,
    dataStage: policy.extractionDataStage,
    provisional: policy.extractionDataStage === "preview",
    coverages: Array.isArray(policy.coverages)
      ? policy.coverages.map((coverage) => {
          const c = coverage as Record<string, unknown>;
          return {
            name: c.name,
            limit: c.limit,
            limitAmount: c.limitAmount,
            deductible: c.deductible,
          };
        })
      : [],
  };
}

async function vendorComplianceRows(ctx: RunQueryCtx, clientOrgIds: string[]) {
  const chunks = await Promise.all(
    clientOrgIds.map((clientOrgId) =>
      ctx
        .runQuery((internal as any).compliance.listVendorComplianceInternal, {
          clientOrgId,
        })
        .catch(() => []),
    ),
  );
  return chunks.flat() as Record<string, unknown>[];
}

function findVendorRows(
  rows: Record<string, unknown>[],
  params: { vendorOrgId?: string; vendorName?: string; query?: string },
) {
  return rows.filter((row) => {
    if (params.vendorOrgId && vendorOrgId(row) !== params.vendorOrgId) {
      return false;
    }
    const nameQuery = params.vendorName ?? params.query;
    return includesQuery(row, nameQuery);
  });
}

export function buildVendorComplianceTools(
  ctx: RunQueryCtx,
  clientOrgIds: string[],
) {
  return {
    lookup_connected_vendors: {
      ...lookupConnectedVendors,
      execute: async (params: {
        query?: string;
        status?:
          | "all"
          | "compliant"
          | "non_compliant"
          | "attention"
          | "waiting_on_policies";
      }) => {
        const rows = await vendorComplianceRows(ctx, clientOrgIds);
        const filtered = rows
          .filter((row) => includesQuery(row, params.query))
          .filter((row) => {
            if (!params.status || params.status === "all") return true;
            if (params.status === "attention") {
              return String(row.status) === "attention";
            }
            return complianceStatus(row) === params.status;
          });
        return filtered.map((row) => ({
          vendorOrgId: vendorOrgId(row),
          name: vendorName(row),
          status: complianceStatus(row),
          requirementCount: row.requirementCount,
          policyCount: row.policyCount,
          metCount: row.metCount,
          missingCount: row.missingCount,
          expiringSoonCount: row.expiringSoonCount,
        }));
      },
    },
    lookup_vendor_policies: {
      ...lookupVendorPolicies,
      execute: async (params: {
        vendorOrgId?: string;
        vendorName?: string;
        query?: string;
      }) => {
        const rows = await vendorComplianceRows(ctx, clientOrgIds);
        const matches = findVendorRows(rows, params);
        if (matches.length === 0) return "Connected vendor not found.";
        if (matches.length > 1 && !params.vendorOrgId) {
          return {
            needsDisambiguation: true,
            vendors: matches.map((row) => ({
              vendorOrgId: vendorOrgId(row),
              name: vendorName(row),
              status: complianceStatus(row),
            })),
          };
        }
        const id = vendorOrgId(matches[0]);
        const policies = await ctx.runQuery(internal.policies.listAllPreviewReadableInternal, {
          orgId: id as Id<"organizations">,
        });
        const mapped = (Array.isArray(policies) ? policies : [])
          .map((policy) => mapPolicy(policy as Record<string, unknown>))
          .filter((policy) => includesQuery(policy, params.query));
        return {
          vendorOrgId: id,
          vendorName: vendorName(matches[0]),
          policies: mapped,
        };
      },
    },
    lookup_vendor_compliance: {
      ...lookupVendorCompliance,
      execute: async (params: {
        vendorOrgId?: string;
        vendorName?: string;
        includeCompliant?: boolean;
      }) => {
        const rows = await vendorComplianceRows(ctx, clientOrgIds);
        const matches =
          params.vendorOrgId || params.vendorName
            ? findVendorRows(rows, params)
            : rows;
        if (matches.length === 0) return "Connected vendor not found.";
        const includeCompliant =
          params.includeCompliant ?? Boolean(params.vendorOrgId || params.vendorName);
        return matches.map((row) => {
          const checks = Array.isArray(row.checks) ? row.checks : [];
          return {
            vendorOrgId: vendorOrgId(row),
            name: vendorName(row),
            status: complianceStatus(row),
            requirementCount: row.requirementCount,
            policyCount: row.policyCount,
            checks: checks
              .filter((check) => {
                const c = check as Record<string, unknown>;
                return includeCompliant || c.status !== "met";
              })
              .map((check) => {
                const c = check as Record<string, unknown>;
                const requirement = c.requirement as Record<string, unknown> | undefined;
                return {
                  requirementId: c.requirementId,
                  title: requirement?.title ?? c.requirementTitle,
                  appliesTo: requirement?.appliesTo,
                  evaluationTarget: requirement?.evaluationTarget,
                  evaluationReason: requirement?.evaluationReason,
                  status: c.status,
                  requiredLimit: requirement?.limit,
                  matchedPolicy: c.matchedPolicy,
                  expiresAt: c.expiresAt,
                  daysUntilExpiration: c.daysUntilExpiration,
                  notes: c.notes,
                };
              }),
          };
        });
      },
    },
  };
}
