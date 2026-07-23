"use node";

import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const REQUEST_TIMEOUT_MS = 15_000;

function configuredEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function routerUrl() {
  return configuredEnv(process.env.CL_ROUTER_URL)?.replace(/\/+$/, "");
}

async function fetchJson(
  url: string,
  secret?: string,
): Promise<{ data: unknown | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).trim();
      return {
        data: null,
        error: `HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
      };
    }
    return { data: await response.json(), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const getDashboard = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId,
    });

    const url = routerUrl();
    const adminSecret = configuredEnv(process.env.CL_ROUTER_ADMIN_SECRET);
    if (!url) {
      return {
        configured: false,
        fetchedAt: dayjs().valueOf(),
        health: { data: null, error: "CL_ROUTER_URL is not configured" },
        policy: { data: null, error: "CL_ROUTER_URL is not configured" },
        rollups: { data: null, error: "CL_ROUTER_URL is not configured" },
      };
    }

    const [health, policy, rollups] = await Promise.all([
      fetchJson(`${url}/health`),
      adminSecret
        ? fetchJson(`${url}/admin/policy?tenantId=glass`, adminSecret)
        : Promise.resolve({
            data: null,
            error: "CL_ROUTER_ADMIN_SECRET is not configured",
          }),
      adminSecret
        ? fetchJson(`${url}/admin/rollups?tenantId=glass`, adminSecret)
        : Promise.resolve({
            data: null,
            error: "CL_ROUTER_ADMIN_SECRET is not configured",
          }),
    ]);

    return {
      configured: true,
      fetchedAt: dayjs().valueOf(),
      health,
      policy,
      rollups,
    };
  },
});
