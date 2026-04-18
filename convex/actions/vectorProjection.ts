"use node";

/**
 * Project high-dimensional embeddings to 3D via PCA for visualization.
 * Runs server-side to avoid sending ~12MB of raw embeddings to the client.
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Simple PCA: find top-3 principal components via power iteration.
 * Input: N vectors of D dimensions. Output: N points in 3D.
 */
function pca3(vectors: number[][]): number[][] {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0].length;

  // Compute mean
  const mean = new Float64Array(d);
  for (const v of vectors) {
    for (let j = 0; j < d; j++) mean[j] += v[j];
  }
  for (let j = 0; j < d; j++) mean[j] /= n;

  // Center the data
  const centered = vectors.map((v) => {
    const c = new Float64Array(d);
    for (let j = 0; j < d; j++) c[j] = v[j] - mean[j];
    return c;
  });

  // Power iteration to find top-k eigenvectors of the covariance matrix
  // Instead of forming D×D covariance, use the data matrix directly
  const components: Float64Array[] = [];

  for (let k = 0; k < 3; k++) {
    // Random initial vector
    let w = new Float64Array(d);
    for (let j = 0; j < d; j++) w[j] = Math.random() - 0.5;

    // Power iteration: w = X^T * X * w (normalized)
    for (let iter = 0; iter < 50; iter++) {
      // Project data onto w: scores = X * w
      const scores = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let dot = 0;
        for (let j = 0; j < d; j++) dot += centered[i][j] * w[j];
        scores[i] = dot;
      }

      // New w = X^T * scores
      const newW = new Float64Array(d);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < d; j++) newW[j] += centered[i][j] * scores[i];
      }

      // Subtract projections onto previous components (deflation)
      for (const prev of components) {
        let dot = 0;
        for (let j = 0; j < d; j++) dot += newW[j] * prev[j];
        for (let j = 0; j < d; j++) newW[j] -= dot * prev[j];
      }

      // Normalize
      let norm = 0;
      for (let j = 0; j < d; j++) norm += newW[j] * newW[j];
      norm = Math.sqrt(norm);
      if (norm < 1e-10) break;
      for (let j = 0; j < d; j++) newW[j] /= norm;

      w = newW;
    }

    components.push(w);
  }

  // Project all vectors onto the 3 components
  return centered.map((v) => {
    const point = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      let dot = 0;
      for (let j = 0; j < d; j++) dot += v[j] * components[k][j];
      point[k] = dot;
    }
    return point;
  });
}

type OrgData = { membership: { orgId: string } };
type IntelligenceEntry = { _id: string; embedding?: number[]; category: string; content: string; source: string; confidence: string };
type DocumentChunk = { _id: string; embedding?: number[]; chunkType: string; policyId: string; text: string };
type PolicyRecord = { carrier?: string; policyNumber?: string };

export const projectIntelligence = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };
    const orgData = await ctx.runQuery(api.orgs.viewerOrg) as OrgData | null;
    if (!orgData) return { error: "No organization" };

    const orgId = orgData.membership.orgId as Id<"organizations">;
    const entries = await ctx.runQuery(internal.intelligence.listByOrg, { orgId }) as IntelligenceEntry[];

    if (entries.length === 0) return { points: [], totalEntries: 0 };

    // Extract embeddings and metadata
    const embeddings: number[][] = [];
    const meta: { id: string; category: string; content: string; source: string; confidence: string }[] = [];

    for (const entry of entries) {
      if (entry.embedding?.length) {
        embeddings.push(entry.embedding);
        meta.push({
          id: entry._id,
          category: entry.category,
          content: entry.content,
          source: entry.source,
          confidence: entry.confidence,
        });
      }
    }

    if (embeddings.length === 0) return { points: [], totalEntries: entries.length };

    // Run PCA
    const projected = pca3(embeddings);

    // Normalize to [-1, 1] range for the scene
    let maxAbs = 0;
    for (const p of projected) {
      for (const v of p) {
        if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
      }
    }
    const scale = maxAbs > 0 ? 1 / maxAbs : 1;

    // Map to VectorPoint shape for reuse with VectorSpace component
    const points = projected.map((p, i) => ({
      x: p[0] * scale * 5,
      y: p[1] * scale * 5,
      z: p[2] * scale * 5,
      chunkType: meta[i].category,
      policyId: meta[i].id,
      carrier: meta[i].source,
      policyNumber: meta[i].confidence,
      text: meta[i].content,
    }));

    return { points, totalEntries: entries.length };
  },
});

export const project = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };
    const orgData = await ctx.runQuery(api.orgs.viewerOrg) as OrgData | null;
    if (!orgData) return { error: "No organization" };

    const orgId = orgData.membership.orgId as Id<"organizations">;
    const chunks = await ctx.runQuery(internal.documentChunks.listAllForOrg, { orgId }) as DocumentChunk[];

    if (chunks.length === 0) return { points: [] };

    // Extract embeddings and metadata
    const embeddings: number[][] = [];
    const meta: { id: string; chunkType: string; policyId: string; text: string }[] = [];

    for (const chunk of chunks) {
      if (chunk.embedding?.length) {
        embeddings.push(chunk.embedding);
        meta.push({
          id: chunk._id,
          chunkType: chunk.chunkType,
          policyId: chunk.policyId,
          text: chunk.text,
        });
      }
    }

    // Run PCA
    const projected = pca3(embeddings);

    // Normalize to [-1, 1] range for the scene
    let maxAbs = 0;
    for (const p of projected) {
      for (const v of p) {
        if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
      }
    }
    const scale = maxAbs > 0 ? 1 / maxAbs : 1;

    // Hydrate policy info
    const policyCache: Record<string, { carrier: string; policyNumber: string }> = {};
    for (const m of meta) {
      if (!policyCache[m.policyId]) {
        const policy = await ctx.runQuery(internal.policies.getInternal, { id: m.policyId as string & { __tableName: "policies" } }) as PolicyRecord | null;
        policyCache[m.policyId] = {
          carrier: policy?.carrier ?? "Unknown",
          policyNumber: policy?.policyNumber ?? "Unknown",
        };
      }
    }

    const points = projected.map((p, i) => ({
      x: p[0] * scale * 5,
      y: p[1] * scale * 5,
      z: p[2] * scale * 5,
      chunkType: meta[i].chunkType,
      policyId: meta[i].policyId,
      carrier: policyCache[meta[i].policyId].carrier,
      policyNumber: policyCache[meta[i].policyId].policyNumber,
      text: meta[i].text,
    }));

    return { points, totalChunks: chunks.length };
  },
});
