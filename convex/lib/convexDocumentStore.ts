"use node";

/**
 * Implements cl-sdk's DocumentStore interface on top of Convex's policies table.
 * Used by the query agent and application pipeline.
 */

import type { DocumentStore, DocumentFilters, InsuranceDocument } from "@claritylabs/cl-sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { insuranceDocToPolicy, policyToInsuranceDoc } from "./documentMapping";

/**
 * Create a DocumentStore backed by Convex's policies table.
 * Must be called from an action context (not query/mutation).
 */
export function createConvexDocumentStore(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): DocumentStore {
  return {
    async save(doc: InsuranceDocument): Promise<void> {
      const d = doc as unknown as { id: string };
      const fields = insuranceDocToPolicy(doc);
      // Check if document already exists (by SDK id which maps to _id)
      const existing = await ctx.runQuery(internal.policies.getInternal, {
        id: d.id as Id<"policies">,
      });
      if (existing) {
        await ctx.runMutation(internal.policies.updateExtractionInternal, {
          id: d.id as Id<"policies">,
          fields,
        });
      }
      // If it doesn't exist, skip — policies are created by the extraction flow
      // before the DocumentStore.save is called
    },

    async get(id: string): Promise<InsuranceDocument | null> {
      const policy = await ctx.runQuery(internal.policies.getInternal, {
        id: id as Id<"policies">,
      });
      if (!policy || policy.deletedAt) return null;
      return policyToInsuranceDoc(policy);
    },

    async query(filters: DocumentFilters): Promise<InsuranceDocument[]> {
      const policies = await ctx.runQuery(internal.policies.listByOrgInternal, {
        orgId,
      });
      // Apply filters in memory (Convex queries are index-based)
      type PolicyRecord = { deletedAt?: number; documentType?: string; carrier?: string; security?: string; insuredName?: string; policyNumber?: string; quoteNumber?: string };
      let filtered = (policies as PolicyRecord[]).filter((p) => !p.deletedAt);

      if (filters.type) {
        filtered = filtered.filter((p) =>
          filters.type === "quote"
            ? p.documentType === "quote"
            : p.documentType !== "quote",
        );
      }
      if (filters.carrier) {
        const carrier = filters.carrier.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.carrier?.toLowerCase().includes(carrier) ||
            p.security?.toLowerCase().includes(carrier),
        );
      }
      if (filters.insuredName) {
        const name = filters.insuredName.toLowerCase();
        filtered = filtered.filter((p) =>
          p.insuredName?.toLowerCase().includes(name),
        );
      }
      if (filters.policyNumber) {
        filtered = filtered.filter(
          (p) => p.policyNumber === filters.policyNumber,
        );
      }
      if (filters.quoteNumber) {
        filtered = filtered.filter(
          (p) => p.quoteNumber === filters.quoteNumber,
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return filtered.map((p) => policyToInsuranceDoc(p as any));
    },

    async delete(id: string): Promise<void> {
      await ctx.runMutation(internal.policies.softDeleteInternal, {
        id: id as Id<"policies">,
      });
    },
  };
}
